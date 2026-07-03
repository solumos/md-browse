import type { EmbedSpec } from "../lib/embeds";

/**
 * Renders a preserved video embed.
 *
 * Direct video files play inline in a native <video>, and Vimeo loads in a
 * sandboxed iframe. YouTube cannot be played inside this app at all: an inline
 * iframe fails with "Error 153" (a packaged Tauri app's tauri://localhost origin
 * sends no HTTP Referer, which YouTube's player now requires), and the
 * alternatives — a popup window or a native webview overlay — are worse than not
 * playing. So a YouTube video is shown as a static preview card (thumbnail +
 * title); it doesn't play in place.
 *
 * Allowed hosts are in the CSP (frame-src / media-src / img-src) in
 * tauri.conf.json.
 */
export function MarkdownEmbed({ spec }: { spec: EmbedSpec }) {
  if (spec.kind === "video") {
    return (
      <video
        src={spec.src}
        controls
        preload="metadata"
        className="not-prose my-5 w-full rounded-lg bg-black"
      />
    );
  }

  if (spec.kind === "youtube") {
    const id = spec.src.match(/\/embed\/([\w-]+)/)?.[1];
    if (id) {
      const poster = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      return (
        <figure className="not-prose my-5">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
            <img
              src={poster}
              alt={spec.title || "YouTube video"}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-red-500" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              YouTube
            </span>
          </div>
          {spec.title && (
            <figcaption className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {spec.title}
            </figcaption>
          )}
        </figure>
      );
    }
  }

  return (
    <div className="not-prose my-5 aspect-video w-full overflow-hidden rounded-lg bg-black">
      <iframe
        src={spec.src}
        title={spec.title || "Embedded video"}
        className="h-full w-full"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-presentation allow-fullscreen"
      />
    </div>
  );
}
