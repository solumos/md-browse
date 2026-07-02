import { buildPage } from "./convert";
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
  const raw = await fetchRaw(url, req.post);
  return buildPage(raw, url);
}
