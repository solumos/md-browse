import { resolveUrl } from "./url";

/**
 * Video embeds.
 *
 * Pages embed video as <iframe> (YouTube/Vimeo) or <video> elements, both of
 * which the strip/Readability passes would drop. So — like forms — each embed is
 * serialized to a small JSON spec, carried through the markdown as a fenced
 * ```md-embed block, and rendered back into a real inline player (MarkdownEmbed).
 */

export type EmbedKind = "youtube" | "vimeo" | "video";

export interface EmbedSpec {
  v: 1;
  kind: EmbedKind;
  /** The player URL (an /embed/ URL for iframes, the file URL for <video>). */
  src: string;
  title?: string;
}

export const EMBED_FENCE_LANG = "md-embed";

const TOKEN_RE = /@@MD-EMBED-(\d+)@@/g;
const token = (i: number) => `@@MD-EMBED-${i}@@`;
const MAX_EMBEDS = 24;

/**
 * Replace each supported <iframe>/<video> with a placeholder token (which
 * survives Readability/Turndown), returning the serialized specs. Non-video
 * iframes are left alone for the noise-stripping to remove.
 */
export function preserveEmbeds(doc: Document, baseUrl: string): string[] {
  const specs: string[] = [];
  for (const el of Array.from(doc.querySelectorAll("iframe[src], video"))) {
    if (specs.length >= MAX_EMBEDS) break;
    const spec = extractEmbed(el, baseUrl);
    if (!spec) continue;
    const marker = doc.createElement("p");
    marker.textContent = token(specs.length);
    el.replaceWith(marker);
    specs.push(JSON.stringify(spec));
  }
  return specs;
}

/** Swap placeholder tokens for fenced md-embed blocks in converted markdown. */
export function restoreEmbedBlocks(markdown: string, specs: string[]): string {
  return markdown.replace(TOKEN_RE, (_m, i: string) => {
    const json = specs[Number(i)];
    return json ? `\n\n\`\`\`${EMBED_FENCE_LANG}\n${json}\n\`\`\`\n\n` : "";
  });
}

/** Parse the JSON body of an md-embed block; null if it isn't a valid spec. */
export function parseEmbedSpec(text: string): EmbedSpec | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const spec = data as Record<string, unknown>;
  if (spec.v !== 1) return null;
  if (spec.kind !== "youtube" && spec.kind !== "vimeo" && spec.kind !== "video") {
    return null;
  }
  if (typeof spec.src !== "string" || !/^https:\/\//i.test(spec.src)) return null;
  return {
    v: 1,
    kind: spec.kind,
    src: spec.src,
    title: typeof spec.title === "string" ? spec.title.slice(0, 200) : undefined,
  };
}

/** The fenced md-embed block for a spec (what the renderer turns into a player). */
export function embedBlock(spec: EmbedSpec): string {
  return `\`\`\`${EMBED_FENCE_LANG}\n${JSON.stringify(spec)}\n\`\`\``;
}

/**
 * If a page URL is itself a YouTube/Vimeo video (e.g. youtube.com/watch?v=…,
 * youtu.be/…), return its embed spec — so navigating there shows the player
 * instead of the JavaScript site shell this browser can't render.
 */
export function videoEmbedFor(pageUrl: string): EmbedSpec | null {
  const yt = youtubeId(pageUrl);
  if (yt) {
    return {
      v: 1,
      kind: "youtube",
      src: `https://www.youtube-nocookie.com/embed/${yt}`,
    };
  }
  const vimeo = vimeoId(pageUrl);
  if (vimeo) {
    return { v: 1, kind: "vimeo", src: `https://player.vimeo.com/video/${vimeo}` };
  }
  return null;
}

function extractEmbed(el: Element, baseUrl: string): EmbedSpec | null {
  const title = el.getAttribute("title")?.trim() || undefined;

  if (el.tagName === "IFRAME") {
    const src = resolveUrl(el.getAttribute("src") ?? "", baseUrl);
    if (!src) return null;
    const yt = youtubeId(src);
    if (yt) {
      return {
        v: 1,
        kind: "youtube",
        src: `https://www.youtube-nocookie.com/embed/${yt}`,
        title,
      };
    }
    const vimeo = vimeoId(src);
    if (vimeo) {
      return {
        v: 1,
        kind: "vimeo",
        src: `https://player.vimeo.com/video/${vimeo}`,
        title,
      };
    }
    return null; // not a recognized video host — leave it to be stripped
  }

  // <video>: use its src (or first <source src>), if it's https.
  const raw =
    el.getAttribute("src") ||
    el.querySelector("source[src]")?.getAttribute("src") ||
    "";
  const src = resolveUrl(raw, baseUrl);
  if (!src || !/^https:\/\//i.test(src)) return null;
  return { v: 1, kind: "video", src, title };
}

/** YouTube video id from any youtube/youtu.be/embed URL, or null. */
function youtubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  const ok = (id: string | null) => (id && /^[\w-]{6,15}$/.test(id) ? id : null);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const embed = u.pathname.match(/^\/embed\/([\w-]+)/);
    if (embed) return ok(embed[1]);
    if (u.pathname === "/watch") return ok(u.searchParams.get("v"));
    const shorts = u.pathname.match(/^\/shorts\/([\w-]+)/);
    if (shorts) return ok(shorts[1]);
  }
  if (host === "youtu.be") return ok(u.pathname.slice(1));
  return null;
}

/** Vimeo video id from a vimeo.com or player.vimeo.com URL, or null. */
function vimeoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  const m = u.pathname.match(/(\d{6,})/);
  return m ? m[1] : null;
}
