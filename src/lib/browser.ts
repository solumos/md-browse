import { buildPage } from "./convert";
import { embedBlock, videoEmbedFor } from "./embeds";
import { fetchRaw } from "./fetchPage";
import { normalizeUrl } from "./url";
import type { NavRequest, PageResult } from "./types";

/**
 * The full load pipeline for one navigation: normalize the address, fetch it
 * natively (asking for markdown; as a POST when the request carries a form
 * body), then negotiate/convert into renderable markdown.
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
  return buildPage(raw, url);
}
