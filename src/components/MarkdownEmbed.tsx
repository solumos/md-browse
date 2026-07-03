import type { EmbedSpec } from "../lib/embeds";

/**
 * Renders a preserved video embed as an inline player.
 *
 * Direct video files play in a native <video>. Vimeo loads in a sandboxed
 * iframe (its player JS runs inside the frame, not our page). YouTube, however,
 * can't be embedded here: in a packaged Tauri app the webview origin is
 * `tauri://localhost`, which sends no HTTP Referer, and YouTube's player now
 * hard-requires one — so an inline YouTube iframe fails with "Error 153: Video
 * player configuration error" (tauri-apps/tauri#14422). Rather than show a
 * broken frame, YouTube renders as a poster (thumbnail + play button) that opens
 * the video in the user's real browser, where it plays normally.
 *
 * Allowed hosts are in the CSP (frame-src / media-src / img-src) in
 * tauri.conf.json.
 */
export function MarkdownEmbed({
  spec,
  onOpenExternal,
}: {
  spec: EmbedSpec;
  onOpenExternal: (url: string) => void;
}) {
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
      const watchUrl = `https://www.youtube.com/watch?v=${id}`;
      const poster = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      return (
        <button
          type="button"
          onClick={() => onOpenExternal(watchUrl)}
          title="Watch on YouTube"
          className="not-prose group relative my-5 block aspect-video w-full overflow-hidden rounded-lg bg-black"
        >
          <img
            src={poster}
            alt={spec.title || "YouTube video"}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-[74px] items-center justify-center rounded-xl bg-red-600 text-white shadow-lg transition group-hover:scale-110">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-left text-sm font-medium text-white">
            Watch on YouTube ↗
          </span>
        </button>
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
