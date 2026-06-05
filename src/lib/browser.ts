import { buildPage } from "./convert";
import { fetchRaw } from "./fetchPage";
import { normalizeUrl } from "./url";
import type { PageResult } from "./types";

/**
 * The full load pipeline for one navigation: normalize the address, fetch it
 * natively (asking for markdown), then negotiate/convert into renderable markdown.
 */
export async function loadPage(input: string): Promise<PageResult> {
  const url = normalizeUrl(input);
  const raw = await fetchRaw(url);
  return buildPage(raw, url);
}
