import { PageError } from "./types";

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// Matches "scheme://" at the start (e.g. https://, ftp://).
const HAS_SCHEME_SEP = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
// Matches a bare "scheme:" prefix (e.g. javascript:, mailto:, data:).
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Normalize raw address-bar input into an absolute http(s) URL we can fetch.
 * Throws a PageError for empty input, unsupported schemes, or unparseable URLs.
 */
export function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new PageError("invalid-url", "Enter a URL to start browsing.");
  }

  let candidate = raw;
  if (!HAS_SCHEME_SEP.test(candidate)) {
    if (HAS_SCHEME.test(candidate)) {
      // Something like "javascript:" or "mailto:" — not browseable here.
      throw new PageError(
        "unsupported-scheme",
        "Only http and https addresses are supported.",
      );
    }
    // Bare host like "example.com" or "example.com/path" — default to https.
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new PageError("invalid-url", "That doesn't look like a valid URL.");
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new PageError(
      "unsupported-scheme",
      "Only http and https addresses are supported.",
    );
  }
  if (!url.hostname) {
    throw new PageError("invalid-url", "That URL is missing a host name.");
  }

  return url.toString();
}

/** Resolve a possibly-relative href against a base URL. Returns null if unparseable. */
export function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** True if a URL path looks like a markdown file. */
export function looksLikeMarkdownUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return /\.(md|markdown|mdx)$/i.test(pathname);
  } catch {
    return false;
  }
}
