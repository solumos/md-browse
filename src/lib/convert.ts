import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
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
  flattenLayoutTables(doc);
  const docTitle = doc.title?.trim() ?? "";

  let articleHtml: string | null = null;
  let articleTitle = "";
  try {
    // Readability mutates the document it's given, so hand it a clone.
    const clone = doc.cloneNode(true) as Document;
    const article = new Readability(clone).parse();
    const textLen = article?.textContent?.trim().length ?? 0;
    if (article?.content && textLen >= MIN_ARTICLE_CHARS) {
      articleHtml = article.content;
      articleTitle = article.title?.trim() ?? "";
    }
  } catch {
    // fall through to full-body conversion
  }

  const td = makeTurndown(finalUrl);
  let markdown: string;
  if (articleHtml) {
    markdown = td.turndown(articleHtml);
  } else {
    const root = doc.body ?? doc.documentElement;
    stripNoise(root);
    markdown = td.turndown(root.innerHTML);
  }

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
      const text = content.trim();
      if (!text) return ""; // icon/vote/empty anchors are just noise
      if (!href || href.startsWith("#")) return text; // no target / in-page anchor
      const abs = resolveUrl(href, baseUrl);
      if (!abs) return text;
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

  return td;
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
 * Many sites (Hacker News, old-school layouts) use <table> purely for layout.
 * Turndown's GFM plugin only converts tables with header cells and *keeps the
 * rest as raw HTML* — which our renderer (rehype-raw off) can't display. So we
 * unwrap every header-less table into plain block <div>s, preserving its links
 * and text in reading order. Real data tables (with <th>) are left for GFM.
 */
function flattenLayoutTables(root: Document): void {
  const doc = root;
  // Process innermost-first so nested layout tables unwrap cleanly.
  const tables = Array.from(doc.querySelectorAll("table")).reverse();
  for (const table of tables) {
    if (table.querySelector("th")) continue; // genuine data table — keep for GFM
    const container = doc.createElement("div");
    for (const row of Array.from(table.querySelectorAll("tr"))) {
      const rowDiv = doc.createElement("div");
      for (const cell of Array.from(row.children)) {
        const cellDiv = doc.createElement("div");
        while (cell.firstChild) cellDiv.appendChild(cell.firstChild);
        rowDiv.appendChild(cellDiv);
      }
      if (rowDiv.childNodes.length) container.appendChild(rowDiv);
    }
    table.replaceWith(container);
  }
}

/** Remove non-content elements before a full-body fallback conversion. */
function stripNoise(root: Element): void {
  root
    .querySelectorAll(
      "script, style, noscript, template, iframe, svg, canvas, nav, footer, header, aside, form, button, input, select",
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
