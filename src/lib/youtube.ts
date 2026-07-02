import { FORM_FENCE_LANG } from "./forms";

/**
 * YouTube page synthesis.
 *
 * youtube.com is a JavaScript app — its served HTML is an empty shell that
 * converts to nothing — but each page's data rides along in a `ytInitialData`
 * JSON blob. For the pages a markdown browser can meaningfully show, build
 * markdown straight from that JSON instead of running the HTML pipeline: the
 * home page becomes a search page, /results lists the actual search results,
 * and result links lead to /watch URLs that play as inline embeds (browser.ts).
 */

interface YtVideo {
  id: string;
  title: string;
  channel?: string;
  views?: string;
  published?: string;
  length?: string;
}

const MAX_RESULTS = 30;

/** Synthesized markdown for a YouTube page, or null to use the normal pipeline. */
export function youtubePage(
  html: string,
  finalUrl: string,
): { markdown: string; title: string } | null {
  let url: URL;
  try {
    url = new URL(finalUrl);
  } catch {
    return null;
  }
  if (!/^(www\.|m\.)?youtube\.com$/i.test(url.hostname)) return null;

  if (url.pathname === "/") {
    return {
      title: "YouTube",
      markdown:
        "# YouTube\n\n" +
        searchForm("") +
        "\n\n_YouTube's home feed needs JavaScript, which this browser doesn't" +
        " run — but search works: results and playback render right here._",
    };
  }

  if (url.pathname === "/results") {
    const query = url.searchParams.get("search_query") ?? "";
    const items = videosIn(html).map(videoItem);
    return {
      title: query ? `${collapseWs(query)} — YouTube` : "YouTube search",
      markdown:
        `# YouTube${query ? `: ${inlineText(query)}` : " search"}\n\n` +
        searchForm(query) +
        "\n\n" +
        (items.length
          ? items.join("\n\n")
          : "_No results found (or YouTube changed its page format)._"),
    };
  }

  return null;
}

/** One search result: linked thumb + bold title, then a metadata line. */
function videoItem(v: YtVideo): string {
  const url = `https://www.youtube.com/watch?v=${v.id}`;
  const meta = [v.channel, v.length, v.views, v.published]
    .filter(Boolean)
    .join(" · ");
  const line =
    `[![](https://i.ytimg.com/vi/${v.id}/default.jpg)](${url}) ` +
    `**[${inlineText(v.title)}](${url})**`;
  return meta ? `${line}  \n${inlineText(meta)}` : line;
}

/** A working YouTube search box, as the md-form fence MarkdownForm renders. */
function searchForm(query: string): string {
  const spec = {
    v: 1,
    action: "https://www.youtube.com/results",
    method: "get",
    fields: [
      {
        kind: "text",
        inputType: "search",
        name: "search_query",
        value: query || undefined,
        placeholder: "Search YouTube",
      },
      { kind: "submit", label: "Search" },
    ],
  };
  return `\`\`\`${FORM_FENCE_LANG}\n${JSON.stringify(spec)}\n\`\`\``;
}

/** All videoRenderer entries in the page's ytInitialData blob, deduped. */
function videosIn(html: string): YtVideo[] {
  const at = html.indexOf("ytInitialData");
  if (at < 0) return [];
  const start = html.indexOf("{", at);
  const end = html.indexOf(";</script>", start);
  if (start < 0 || end < 0) return [];
  let data: unknown;
  try {
    data = JSON.parse(html.slice(start, end));
  } catch {
    return [];
  }
  const out: YtVideo[] = [];
  collectVideos(data, out, 0);
  const seen = new Set<string>();
  return out.filter((v) => !seen.has(v.id) && (seen.add(v.id), true));
}

// Walk the whole blob rather than hardcoding YouTube's deeply nested (and
// shifting) renderer paths; videoRenderer nodes are the stable unit.
function collectVideos(node: unknown, out: YtVideo[], depth: number): void {
  if (out.length >= MAX_RESULTS || depth > 24) return;
  if (Array.isArray(node)) {
    for (const item of node) collectVideos(item, out, depth + 1);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const obj = node as Record<string, unknown>;
  const video = parseVideo(obj.videoRenderer);
  if (video) out.push(video);
  for (const key of Object.keys(obj)) {
    if (key !== "videoRenderer") collectVideos(obj[key], out, depth + 1);
  }
}

function parseVideo(v: unknown): YtVideo | null {
  if (typeof v !== "object" || v === null) return null;
  const vr = v as Record<string, unknown>;
  const id = vr.videoId;
  if (typeof id !== "string" || !/^[\w-]{6,15}$/.test(id)) return null;
  const title = text(vr.title);
  if (!title) return null;
  return {
    id,
    title,
    channel: text(vr.ownerText) ?? text(vr.longBylineText),
    views: text(vr.shortViewCountText) ?? text(vr.viewCountText),
    published: text(vr.publishedTimeText),
    length: text(vr.lengthText),
  };
}

/** YouTube's two text encodings: {simpleText} or {runs: [{text}, …]}. */
function text(v: unknown): string | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.simpleText === "string" && o.simpleText) return o.simpleText;
  if (!Array.isArray(o.runs)) return undefined;
  const joined = o.runs
    .map((r) =>
      r && typeof r === "object" && typeof (r as { text?: unknown }).text === "string"
        ? (r as { text: string }).text
        : "",
    )
    .join("");
  return joined || undefined;
}

/** Collapse all whitespace (incl. newlines) to single spaces. */
function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Render an untrusted string (search query, video title, channel name — all
 * attacker-influenced) as literal inline markdown text. Three jobs, each closing
 * a real injection vector, since these values are interpolated straight into
 * hand-built markdown that renders with rehype-raw OFF but our own md-embed /
 * md-form fences honored:
 *  1. collapse whitespace incl. newlines — a fenced ```/~~~ block, heading, or
 *     table can only begin at a line start, so single-lining kills block-level
 *     injection (notably a forged ```md-embed player that would auto-fetch a
 *     cross-origin <video> beacon);
 *  2. backslash-escape markdown punctuation so [ ] ( ) * _ ` ~ # | < > stay
 *     literal and can't break out of link text or forge a fence inline;
 *  3. defuse GFM autolink literals (http://, www., email) with a word joiner so
 *     attacker text can't surface as a clickable link under youtube.com's origin.
 */
function inlineText(s: string): string {
  const JOIN = "⁠"; // word joiner: zero-width, breaks the autolink token
  return collapseWs(s)
    .replace(/[\\`*_{}[\]()#+.!~|<>&]/g, "\\$&")
    .replace(/(https?|ftp|mailto|www)/gi, `$1${JOIN}`)
    .replace(/@/g, `@${JOIN}`);
}
