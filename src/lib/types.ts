/** The raw result of fetching a URL, before content negotiation/conversion. */
export interface RawResponse {
  /** Response body as text. */
  body: string;
  /** Lower-cased Content-Type header (may be empty). */
  contentType: string;
  /** Final URL after redirects. */
  finalUrl: string;
  /** HTTP status code. */
  status: number;
}

/** How the markdown for a page was obtained. */
export type PageSource = "native" | "converted" | "raw";

/** A successfully loaded page, ready to render. */
export interface PageResult {
  /** The normalized URL we requested. */
  requestedUrl: string;
  /** The final URL after redirects — used as the base for resolving links/images. */
  finalUrl: string;
  /** A human-friendly title for the page. */
  title: string;
  /** The markdown to render. */
  markdown: string;
  /** Whether the origin served markdown ("native"), we converted HTML ("converted"),
   *  or we're showing other text verbatim ("raw"). */
  source: PageSource;
  /** HTTP status code. */
  status: number;
}

export type FetchErrorKind =
  | "invalid-url"
  | "unsupported-scheme"
  | "network"
  | "timeout"
  | "http-status"
  | "unsupported-content"
  | "too-large"
  | "empty"
  | "unknown";

/** A typed, user-presentable error for any failure while loading a page. */
export class PageError extends Error {
  readonly kind: FetchErrorKind;
  readonly status?: number;
  readonly url?: string;

  constructor(
    kind: FetchErrorKind,
    message: string,
    opts?: { status?: number; url?: string },
  ) {
    super(message);
    this.name = "PageError";
    this.kind = kind;
    this.status = opts?.status;
    this.url = opts?.url;
    // Ensure `instanceof PageError` works across transpilation targets.
    Object.setPrototypeOf(this, PageError.prototype);
  }
}

/** Coerce an unknown thrown value into a PageError. */
export function toPageError(e: unknown): PageError {
  if (e instanceof PageError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new PageError("unknown", message);
}
