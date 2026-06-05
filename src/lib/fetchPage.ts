import { fetch } from "@tauri-apps/plugin-http";
import { PageError, type RawResponse } from "./types";

/** Abort a request that takes longer than this. */
const TIMEOUT_MS = 15_000;
/** Reject responses larger than this to avoid hangs / memory blowups. */
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

/** Content negotiation: prefer markdown, then HTML, then plain text. */
const ACCEPT_HEADER =
  "text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.1";

const USER_AGENT = "MarkdownBrowser/0.1 (Tauri; +markdown-first)";

/**
 * Fetch a URL natively through the Rust side (no CORS), asking for markdown via
 * the Accept header. Returns the raw body + content type + final URL, or throws
 * a typed PageError.
 */
export async function fetchRaw(url: string): Promise<RawResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: ACCEPT_HEADER,
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort|timed? ?out|deadline/i.test(msg)) {
      throw new PageError(
        "timeout",
        `The site took too long to respond (over ${TIMEOUT_MS / 1000}s).`,
        { url },
      );
    }
    throw new PageError("network", `Couldn't reach the site. (${msg})`, { url });
  }

  const finalUrl = res.url || url;
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

  if (!res.ok) {
    throw new PageError(
      "http-status",
      `The site returned HTTP ${res.status} (${res.statusText || "error"}).`,
      { status: res.status, url: finalUrl },
    );
  }

  // Reject obviously-binary content before reading the whole body as text.
  if (contentType && !isTextual(contentType)) {
    throw new PageError(
      "unsupported-content",
      `This page is "${contentType.split(";")[0]}", which can't be shown as markdown yet.`,
      { url: finalUrl },
    );
  }

  // Pre-check declared size.
  const declaredLen = Number(res.headers.get("content-length") ?? "0");
  if (declaredLen && declaredLen > MAX_BYTES) {
    throw new PageError(
      "too-large",
      `That page is too large to load (${(declaredLen / 1e6).toFixed(1)} MB).`,
      { url: finalUrl },
    );
  }

  const body = await res.text();
  if (body.length > MAX_BYTES) {
    throw new PageError("too-large", "That page is too large to load.", {
      url: finalUrl,
    });
  }

  return { body, contentType, finalUrl, status: res.status };
}

/** Content types we can render (as markdown, HTML→markdown, or raw text). */
function isTextual(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType.includes("markdown") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("x-sh")
  );
}
