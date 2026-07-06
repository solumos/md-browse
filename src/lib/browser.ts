import { invoke } from "@tauri-apps/api/core";
import { buildPage } from "./convert";
import { embedBlock, videoEmbedFor } from "./embeds";
import { fetchRaw } from "./fetchPage";
import { normalizeUrl } from "./url";
import { PageError, type NavRequest, type PageResult } from "./types";

/**
 * The full load pipeline for one navigation: normalize the address, fetch it
 * natively (asking for markdown; as a POST when the request carries a form
 * body), then negotiate/convert into renderable markdown.
 *
 * When the no-JavaScript fetch yields a near-empty page (a client-rendered SPA
 * shell), fall back to rendering it with JavaScript in an offscreen webview and
 * converting the settled DOM instead.
 */
export async function loadPage(req: NavRequest): Promise<PageResult> {
  const url = normalizeUrl(req.url);

  // A direct YouTube/Vimeo video URL: render the inline player instead of
  // fetching the JavaScript site shell (which this browser can't run).
  const embed = req.post == null ? videoEmbedFor(url) : null;
  if (embed) {
    const label = embed.kind === "youtube" ? "YouTube" : "Vimeo";
    return {
      requestedUrl: url,
      finalUrl: url,
      title: `${label} video`,
      markdown: `# ${label} video\n\n${embedBlock(embed)}`,
      source: "native",
      status: 200,
    };
  }

  const raw = await fetchRaw(url, req.post);
  try {
    return buildPage(raw, url);
  } catch (e) {
    // A GET that converted to nothing is likely a JS-only page; re-render it
    // with JavaScript and convert the resulting DOM. (POSTs aren't retried —
    // resubmitting a form body through a fresh webview isn't safe/meaningful.)
    if (req.post == null && e instanceof PageError && e.kind === "empty") {
      return renderWithJs(url, raw.finalUrl, raw.status);
    }
    throw e;
  }
}

/** Re-render a URL in an offscreen JS-enabled webview and convert the settled DOM. */
async function renderWithJs(
  url: string,
  finalUrl: string,
  status: number,
): Promise<PageResult> {
  const html = await invoke<string>("render_with_js", { url });
  const page = buildPage(
    { body: html, contentType: "text/html", finalUrl, status: status || 200 },
    url,
  );
  return { ...page, source: "js" };
}
