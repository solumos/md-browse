import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEmbed } from "../src/components/MarkdownEmbed";
import type { EmbedSpec } from "../src/lib/embeds";

const render = (spec: EmbedSpec, onOpen: (url: string) => void = () => {}) =>
  renderToStaticMarkup(
    createElement(MarkdownEmbed, { spec, onPlayVideo: onOpen }),
  );

describe("MarkdownEmbed", () => {
  it("renders YouTube as a poster (no iframe — Error 153 can't happen)", () => {
    const html = render({
      v: 1,
      kind: "youtube",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
    expect(html).not.toContain("<iframe");
    expect(html).toContain("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(html).toContain("Play video");
    expect(html).toContain("<button");
  });

  it("plays the YouTube watch URL in-app when clicked", () => {
    const onOpen = vi.fn();
    // renderToStaticMarkup can't fire events, so invoke the returned button's
    // onClick directly.
    const el = MarkdownEmbed({
      spec: {
        v: 1,
        kind: "youtube",
        src: "https://www.youtube-nocookie.com/embed/abc123DEF45",
      },
      onPlayVideo: onOpen,
    }) as { props: { onClick: () => void } };
    el.props.onClick();
    expect(onOpen).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abc123DEF45",
    );
  });

  it("plays a direct video file inline in a <video>", () => {
    const html = render({
      v: 1,
      kind: "video",
      src: "https://cdn.example.com/clip.mp4",
    });
    expect(html).toContain("<video");
    expect(html).toContain("https://cdn.example.com/clip.mp4");
    expect(html).not.toContain("Play video");
  });

  it("keeps Vimeo as a sandboxed iframe", () => {
    const html = render({
      v: 1,
      kind: "vimeo",
      src: "https://player.vimeo.com/video/123456789",
    });
    expect(html).toContain("<iframe");
    expect(html).toContain("https://player.vimeo.com/video/123456789");
    expect(html).toContain("sandbox=");
  });
});
