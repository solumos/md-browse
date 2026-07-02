import type { EmbedSpec } from "../lib/embeds";

/**
 * Renders a preserved video embed as a real inline player. YouTube/Vimeo load
 * in a sandboxed iframe (their player JS runs inside the frame, not our page);
 * direct video files use a native <video> element. The hosts are allow-listed
 * in the CSP (frame-src / media-src) in tauri.conf.json.
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
