import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { preserveForms, restoreFormBlocks } from "./forms";
import { preserveEmbeds, restoreEmbedBlocks } from "./embeds";
import { PageError, type PageResult, type RawResponse } from "./types";
import { looksLikeMarkdownUrl, resolveUrl } from "./url";

/** Below this many characters of extracted text, fall back to converting the whole body. */
const MIN_ARTICLE_CHARS = 200;

/**
 * Turn a raw HTTP response into a renderable PageResult, performing content
 * negotiation: native markdown passes through, HTML is converted, other text is
 * shown verbatim. Pure & synchronous so it can be unit-tested without a network.
 */
export function buildPage(raw: RawResponse, requestedUrl: string): PageResult {
  const ct = raw.contentType;

  // 0. A direct image URL — show the image in-app instead of a raw-bytes error.
  if (ct.startsWith("image/")) {
    const name = fileNameOf(raw.finalUrl);
    return {
      requestedUrl,
      finalUrl: raw.finalUrl,
      title: name || hostOf(raw.finalUrl),
      markdown: `![${name}](${raw.finalUrl})`,
      source: "raw",
      status: raw.status,
    };
  }

  // 1. Native markdown (the content-negotiation happy path).
  if (
    ct.includes("markdown") ||
    ct.includes("x-markdown") ||
    looksLikeMarkdownUrl(raw.finalUrl)
  ) {
    const markdown = raw.body.trim();
    if (!markdown) {
      throw new PageError("empty", "The page was empty.", { url: raw.finalUrl });
    }
    return {
      requestedUrl,
      finalUrl: raw.finalUrl,
      title: titleFromMarkdown(markdown) || hostOf(raw.finalUrl),
      markdown,
      source: "native",
      status: raw.status,
    };
  }

  // 2. HTML → convert to markdown.
  if (ct.includes("html") || (ct === "" && looksLikeHtml(raw.body))) {
    const { markdown, title } = htmlToMarkdown(raw.body, raw.finalUrl);
    if (!markdown.trim()) {
      throw new PageError(
        "empty",
        "Couldn't extract readable content. This page may rely on JavaScript or require a login, which this browser doesn't support yet.",
        { url: raw.finalUrl },
      );
    }
    return {
      requestedUrl,
      finalUrl: raw.finalUrl,
      title: title || hostOf(raw.finalUrl),
      markdown,
      source: "converted",
      status: raw.status,
    };
  }

  // 3. Other textual content — show verbatim (fenced for structured formats).
  const text = raw.body.trim();
  if (!text) {
    throw new PageError("empty", "The page was empty.", { url: raw.finalUrl });
  }
  const markdown = ct.includes("plain") ? text : fenced(text, langForType(ct));
  return {
    requestedUrl,
    finalUrl: raw.finalUrl,
    title: hostOf(raw.finalUrl),
    markdown,
    source: "raw",
    status: raw.status,
  };
}

/**
 * Convert an HTML document to markdown: extract the main content with Readability
 * (falling back to the full body when extraction is too thin), then run Turndown
 * with GFM support and rules that absolutize links/images against the page URL.
 */
export function htmlToMarkdown(
  html: string,
  finalUrl: string,
): { markdown: string; title: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  injectBase(doc, finalUrl);
  // Strip reddit's logged-out chrome (signup bars, action buttons, sort menu,
  // duplicate vote-state scores) before anything else runs.
  cleanRedditChrome(doc, finalUrl);
  // Capture the site's primary nav (header bar) before Readability strips it as
  // "chrome" — for a browser, links like HN's "new | past | … | login" matter.
  const navLine = extractNav(doc, finalUrl);
  // Give text-less icon links (vote arrows, icon buttons) their title/alt as
  // text now, or Readability discards them as empty and they become unclickable.
  materializeIconLinks(doc);
  // Preserve video embeds (<iframe>/<video>) before the strip/Readability passes
  // drop them; restored as md-embed blocks and rendered as real players.
  const embedSpecs = preserveEmbeds(doc, finalUrl);
  // Rebuild HN/reddit reply trees as nested blockquotes before the table/flatten
  // passes would collapse their structure into an undifferentiated wall of text.
  const hasCommentTree = preserveComments(doc);
  // Serialize forms into placeholder tokens before Readability/Turndown run,
  // so search boxes & co. survive conversion (restored as md-form blocks below).
  const formSpecs = preserveForms(doc, finalUrl);
  normalizeTables(doc);
  const docTitle = doc.title?.trim() ?? "";

  const bodyTextLen = (doc.body?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim().length;

  let articleHtml: string | null = null;
  let articleTitle = "";
  // A rebuilt comment tree IS the content; Readability would flatten its
  // nesting, so skip extraction and convert the full body in that case.
  if (!hasCommentTree) {
    try {
      // Readability mutates the document it's given, so hand it a clone.
      const clone = doc.cloneNode(true) as Document;
      const article = new Readability(clone).parse();
      const textLen = article?.textContent?.trim().length ?? 0;
      // On aggregator/index pages (old.reddit, forums) Readability sometimes
      // latches onto a small wrong region (a sidebar/search panel) that still
      // clears the length threshold, silently dropping the real content. If it
      // captured only a sliver of a large page, distrust it and use the full body.
      const capturedEnough =
        bodyTextLen < 4000 || textLen >= bodyTextLen * 0.25;
      if (article?.content && textLen >= MIN_ARTICLE_CHARS && capturedEnough) {
        articleHtml = article.content;
        articleTitle = article.title?.trim() ?? "";
      }
    } catch {
      // fall through to full-body conversion
    }
  }

  const td = makeTurndown(finalUrl);
  let markdown: string;
  if (articleHtml) {
    markdown = td.turndown(articleHtml);
  } else {
    // Prefer the semantic main region when present: it drops site chrome the
    // whole <body> would include (e.g. reddit's subreddit bar, sidebar, footer).
    const root =
      doc.querySelector("main, [role='main']") ??
      doc.body ??
      doc.documentElement;
    stripNoise(root);
    markdown = td.turndown(root.innerHTML);
  }

  if (navLine) markdown = `${navLine}\n\n---\n\n${markdown}`;
  markdown = restoreFormBlocks(markdown, formSpecs);
  markdown = restoreEmbedBlocks(markdown, embedSpecs);
  return { markdown: cleanupMarkdown(markdown), title: articleTitle || docTitle };
}

function makeTurndown(baseUrl: string): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
    linkStyle: "inlined",
  });
  td.use(gfm);

  // Resolve relative <a href> to absolute so links remain clickable/navigable.
  td.addRule("absolute-links", {
    filter: "a",
    replacement: (content, node) => {
      const el = node as unknown as HTMLAnchorElement;
      const href = el.getAttribute("href");
      // Icon-only links (e.g. HN's vote arrows) have no text — recover a label
      // from a title/aria-label/nested alt so they stay usable, not invisible.
      const text = content.trim() || iconLinkLabel(el);
      if (!text) return ""; // truly empty anchor — nothing to show
      if (!href || href.startsWith("#")) return text; // no target / in-page anchor
      const abs = resolveUrl(href, baseUrl);
      if (!abs) return text;
      // Only linkify real navigable/actionable schemes. javascript:/data: links
      // (e.g. reddit's vote/hide/save actions) are dead here — show plain text.
      if (!/^(https?|mailto|tel):/i.test(abs)) return text;
      const titleAttr = el.getAttribute("title");
      const titlePart = titleAttr ? ` "${escapeQuotes(titleAttr)}"` : "";
      return `[${text}](${abs}${titlePart})`;
    },
  });

  // Resolve relative <img src> to absolute and preserve alt text.
  td.addRule("absolute-images", {
    filter: "img",
    replacement: (_content, node) => {
      const el = node as unknown as HTMLImageElement;
      const src = el.getAttribute("src") || el.getAttribute("data-src");
      if (!src) return "";
      const abs = resolveUrl(src, baseUrl) ?? src;
      const alt = (el.getAttribute("alt") ?? "").replace(/\s+/g, " ").trim();
      const titleAttr = el.getAttribute("title");
      const titlePart = titleAttr ? ` "${escapeQuotes(titleAttr)}"` : "";
      return `![${alt}](${abs}${titlePart})`;
    },
  });

  // Standalone controls (outside any <form> — those were already serialized to
  // md-form blocks) can't work without JavaScript, but dropping them leaves
  // visible holes in the page. Show them as inline `[ label ]` badges instead.
  td.addRule("orphan-controls", {
    filter: (node) => node.nodeName === "BUTTON" || node.nodeName === "INPUT",
    replacement: (_content, node) => {
      const label = orphanControlLabel(node as unknown as HTMLElement);
      return label ? "`[ " + label + " ]`" : "";
    },
  });

  // Option lists and textareas outside forms are JS-driven noise; without this
  // rule their text content would leak into the output as run-on prose.
  td.addRule("drop-orphan-choice-controls", {
    filter: ["select", "textarea", "option", "optgroup", "datalist"],
    replacement: () => "",
  });

  return td;
}

/** Visible caption for a standalone button/input, or "" when it's pure noise. */
function orphanControlLabel(el: HTMLElement): string {
  let label = "";
  if (el.nodeName === "BUTTON") {
    label =
      el.textContent || el.getAttribute("value") || el.getAttribute("aria-label") || "";
  } else {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "hidden" || type === "checkbox" || type === "radio") return "";
    if (["submit", "button", "reset", "image"].includes(type)) {
      label =
        el.getAttribute("value") ||
        el.getAttribute("alt") ||
        el.getAttribute("aria-label") ||
        "";
    } else {
      label = el.getAttribute("placeholder") || el.getAttribute("aria-label") || "";
    }
  }
  return label.replace(/`/g, "'").replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * Give every text-less link with a recoverable label (title/aria-label) that
 * label as literal text. Runs before Readability, which would otherwise drop
 * such links as empty — losing things like HN's up/down-vote arrows.
 *
 * Anchors that wrap real media (an <img> etc.) are left alone: they already
 * render as a linked image, and overwriting textContent would delete the image.
 */
function materializeIconLinks(doc: Document): void {
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    if (a.textContent?.trim()) continue;
    if (a.querySelector("img, svg, picture, video, audio, canvas")) continue;
    const label = iconLinkLabel(a);
    if (label) a.textContent = label;
  }
}

/** Reddit noise removed on reddit pages (logged-out CTAs, chrome, dupe scores). */
const REDDIT_CHROME = [
  ".listingsignupbar", // "Welcome to Reddit" CTA
  ".commentsignupbar", // "Want to add to the discussion?" CTA
  ".menuarea", // comment sort controls
  ".score.dislikes", // dupe vote-state scores (keep .unvoted)
  ".score.likes",
  ".commentarea > .panestack-title",
  ".infobar",
  ".rank", // listing rank numbers ("1", "2", …)
  ".thumbnail", // thumbnail link + duration overlay ("[0:21]")
  ".expando-uninitialized", // media that only loads via JS → "loading…" stub
  ".expando-button",
  ".linkflairlabel", // post flair badge (glues onto the title)
  ".flairrichtext",
].join(", ");

/** Strip reddit's UI chrome so pages are just the post + comments. */
function cleanRedditChrome(doc: Document, finalUrl: string): void {
  let host: string;
  try {
    host = new URL(finalUrl).hostname;
  } catch {
    return;
  }
  if (!/(^|\.)reddit\.com$/.test(host)) return;
  doc.querySelectorAll(REDDIT_CHROME).forEach((el) => el.remove());
}

/** Recover a label for a text-less anchor from its (or a child's) title/aria-label. */
function iconLinkLabel(el: Element): string {
  const own = el.getAttribute("title") || el.getAttribute("aria-label");
  if (own?.trim()) return own.trim();
  const nested =
    el.querySelector("[title]")?.getAttribute("title") ||
    el.querySelector("[aria-label]")?.getAttribute("aria-label");
  return nested?.trim() ?? "";
}

/**
 * Extract the page's primary navigation (site header / nav bar) as a compact
 * markdown link line, and remove it from the document so it isn't duplicated.
 * Readability discards these regions as "chrome", but for a *browser* the top
 * nav (e.g. Hacker News's "new | past | comments | … | login") is worth keeping.
 * Returns "" when there's no clear nav, or it's a huge mega-menu.
 */
function extractNav(doc: Document, baseUrl: string): string {
  const candidates = Array.from(
    doc.querySelectorAll(
      'nav, [role="navigation"], .pagetop, header, [role="banner"]',
    ),
  );
  if (!candidates.length) return "";

  const seen = new Set<string>();
  const links: string[] = [];
  const toRemove: Element[] = [];

  for (const c of candidates) {
    // Never touch content-bearing regions: an article/hero <header> with a
    // heading, or anything wrapping the main content, is NOT a nav bar.
    if (c.querySelector("h1, h2, h3, article, main")) continue;

    // A nav bar is mostly links. If most of the region's text isn't inside
    // links, it's prose we must not delete.
    const anchors = Array.from(c.querySelectorAll("a[href]"));
    const linkChars = anchors.reduce(
      (n, a) => n + (a.textContent ?? "").replace(/\s+/g, "").length,
      0,
    );
    const totalChars = (c.textContent ?? "").replace(/\s+/g, "").length;
    if (totalChars > 0 && linkChars / totalChars < 0.6) continue;

    let added = 0;
    for (const a of anchors) {
      const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
      const href = a.getAttribute("href");
      if (!text || text.length > 30 || !href || href.startsWith("#")) continue;
      const abs = resolveUrl(href, baseUrl);
      if (!abs || seen.has(abs)) continue;
      seen.add(abs);
      links.push(`[${text}](${abs})`);
      added++;
    }
    if (added > 0) toRemove.push(c);
  }

  // Too few links isn't a nav; too many is a mega-menu we'd rather not dump.
  if (links.length < 2 || links.length > 40) return "";

  // Remove only the regions we actually pulled links from, and never one
  // holding a <form> (e.g. a header search box) — that's for the form pipeline.
  for (const c of toRemove) {
    if (!c.querySelector("form")) c.remove();
  }
  return links.join(" · ");
}

/** Insert (or update) a <base href> so URL resolution has a reference point. */
function injectBase(doc: Document, url: string): void {
  const head = doc.head ?? doc.documentElement;
  let base = doc.querySelector("base");
  if (!base) {
    base = doc.createElement("base");
    head.insertBefore(base, head.firstChild);
  }
  base.setAttribute("href", url);
}

/**
 * HN and old.reddit render discussions as indented reply trees. Turndown would
 * flatten them into a structureless wall of text, so we rebuild the nesting as
 * nested <blockquote>s (which become "> ", ">> ", … in markdown) before the
 * table/Readability passes run.
 */
function preserveComments(doc: Document): boolean {
  // Either match transforms the tree in place; return whether we found one, so
  // the caller can skip Readability (which would flatten the nesting we built).
  const reddit = preserveRedditComments(doc);
  const hn = preserveHackerNewsComments(doc);
  return reddit || hn;
}

/** Build the "**author** · meta" header line for a comment blockquote. */
function commentHeader(
  doc: Document,
  author: string | null | undefined,
  meta: string,
): HTMLParagraphElement {
  const p = doc.createElement("p");
  const strong = doc.createElement("strong");
  strong.textContent = author?.trim() || "[deleted]";
  p.appendChild(strong);
  if (meta.trim()) p.appendChild(doc.createTextNode(` · ${meta.trim()}`));
  return p;
}

// old.reddit nests replies structurally: .comment > .child > … > .comment.
function preserveRedditComments(doc: Document): boolean {
  const listing = doc.querySelector(".commentarea .sitetable.nestedlisting");
  if (!listing) return false;
  const container = doc.createElement("div");
  for (const c of childComments(listing)) {
    container.appendChild(renderRedditComment(doc, c));
  }
  listing.replaceWith(container);
  return true;
}

function childComments(container: Element): Element[] {
  return Array.from(container.children).filter((c) =>
    c.classList.contains("comment"),
  );
}

function renderRedditComment(doc: Document, comment: Element): HTMLQuoteElement {
  const bq = doc.createElement("blockquote");
  const author = comment.querySelector(":scope > .entry .author")?.textContent;
  // reddit renders three .score spans (dislikes/unvoted/likes); .unvoted is the
  // real count. Fall back to the first for older/other markup.
  const score = (
    comment.querySelector(":scope > .entry .tagline .score.unvoted") ??
    comment.querySelector(":scope > .entry .tagline .score")
  )?.textContent;
  bq.appendChild(commentHeader(doc, author, score ?? ""));
  const body = comment.querySelector(":scope > .entry .usertext-body .md");
  if (body) bq.appendChild(body.cloneNode(true));
  const kids = comment.querySelector(":scope > .child > .sitetable");
  if (kids) {
    for (const child of childComments(kids)) {
      bq.appendChild(renderRedditComment(doc, child));
    }
  }
  return bq;
}

// HN lays comments out as a flat row list; depth is on <td class="ind" indent="N">.
function preserveHackerNewsComments(doc: Document): boolean {
  const rows = Array.from(doc.querySelectorAll("tr.athing.comtr"));
  if (!rows.length) return false;
  const tree = rows[0].closest("table");
  const container = doc.createElement("div");
  const stack: Element[] = []; // stack[d] = the blockquote currently open at depth d

  for (const row of rows) {
    const ind = row.querySelector("td.ind");
    const depth =
      Number(ind?.getAttribute("indent")) ||
      Math.round(Number(ind?.querySelector("img")?.getAttribute("width")) / 40) ||
      0;

    const bq = doc.createElement("blockquote");
    const author = row.querySelector(".hnuser")?.textContent;
    const age = row.querySelector(".age")?.textContent ?? "";
    bq.appendChild(commentHeader(doc, author, age));
    const text = row.querySelector(".commtext");
    if (text) bq.appendChild(text.cloneNode(true));

    const parent = depth > 0 ? stack[depth - 1] : undefined;
    (parent ?? container).appendChild(bq);
    stack[depth] = bq;
    stack.length = depth + 1;
  }

  (tree ?? rows[0]).replaceWith(container);
  return true;
}

// Block/media content that can't live inside a GFM (single-line) table cell.
const CELL_BLOCK_SELECTOR =
  "img, picture, video, audio, svg, figure, ul, ol, dl, blockquote, pre, h1, h2, h3, h4, h5, h6, hr";

/**
 * GFM markdown tables are flat grids of single-line cells. Lots of real HTML
 * tables aren't that: layout tables (Hacker News), and especially Wikipedia-style
 * *infoboxes* — vertical key/value panels full of images that happen to use <th>.
 * Turndown would turn those into a garbled one-column "table", and header-less
 * layout tables it keeps as raw HTML our renderer can't show.
 *
 * So we keep only genuine grid tables (header cells, ≥2 columns, simple inline
 * cells) for GFM, and unwrap everything else into readable blocks — rendering
 * 2-cell key/value rows as "**label:** value" so infoboxes read as a definition
 * list rather than a broken table.
 */
function normalizeTables(root: Document): void {
  const doc = root;
  // Innermost-first so nested tables unwrap before their parents are judged.
  const tables = Array.from(doc.querySelectorAll("table")).reverse();
  for (const table of tables) {
    if (isSimpleDataTable(table)) continue; // leave for the GFM plugin

    const container = doc.createElement("div");
    for (const row of Array.from(table.querySelectorAll("tr"))) {
      const cells = Array.from(row.children).filter(
        (c) => c.tagName === "TD" || c.tagName === "TH",
      );
      if (!cells.length) continue;

      if (
        cells.length === 2 &&
        cells[0].textContent?.trim() &&
        cells[1].textContent?.trim() &&
        !cells[0].querySelector(CELL_BLOCK_SELECTOR) &&
        !cells[1].querySelector(CELL_BLOCK_SELECTOR)
      ) {
        // Key/value row → "**label:** value".
        const p = doc.createElement("p");
        const strong = doc.createElement("strong");
        while (cells[0].firstChild) strong.appendChild(cells[0].firstChild);
        p.appendChild(strong);
        p.appendChild(doc.createTextNode(": "));
        while (cells[1].firstChild) p.appendChild(cells[1].firstChild);
        container.appendChild(p);
      } else {
        for (const cell of cells) {
          const div = doc.createElement("div");
          while (cell.firstChild) div.appendChild(cell.firstChild);
          if (div.childNodes.length) container.appendChild(div);
        }
      }
    }
    table.replaceWith(container);
  }
}

/** A table GFM can render well: has header cells, ≥2 columns, no block/media cells. */
function isSimpleDataTable(table: Element): boolean {
  if (!table.querySelector("th")) return false;
  if (table.querySelector(CELL_BLOCK_SELECTOR)) return false;
  const maxCols = Math.max(
    0,
    ...Array.from(table.querySelectorAll("tr")).map(
      (r) =>
        Array.from(r.children).filter(
          (c) => c.tagName === "TD" || c.tagName === "TH",
        ).length,
    ),
  );
  return maxCols >= 2;
}

/**
 * Remove non-content elements before a full-body fallback conversion.
 * `form` here only catches forms that preserveForms skipped as unrenderable
 * (hidden-only trackers); standalone buttons/inputs are kept so the Turndown
 * orphan-control rules can badge them.
 */
function stripNoise(root: Element): void {
  root
    .querySelectorAll(
      "script, style, noscript, template, iframe, svg, canvas, nav, footer, header, aside, form",
    )
    .forEach((el) => el.remove());
}

/** Collapse non-breaking spaces, trailing whitespace, and excess blank lines. */
function cleanupMarkdown(md: string): string {
  return md
    .replace(/ /g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleFromMarkdown(md: string): string {
  const m = md.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  return m ? m[1].trim() : "";
}

function looksLikeHtml(body: string): boolean {
  return /<!doctype html|<html[\s>]|<body[\s>]|<head[\s>]|<div[\s>]/i.test(
    body.slice(0, 2000),
  );
}

function fenced(text: string, lang: string): string {
  return "```" + lang + "\n" + text + "\n```";
}

function langForType(ct: string): string {
  if (ct.includes("json")) return "json";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("javascript")) return "javascript";
  return "";
}

function escapeQuotes(s: string): string {
  return s.replace(/"/g, '\\"');
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** The last path segment of a URL (e.g. an image's file name), decoded. */
function fileNameOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    const seg = path.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(seg);
  } catch {
    return "";
  }
}
