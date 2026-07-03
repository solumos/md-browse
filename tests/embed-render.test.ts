import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownEmbed } from "../src/components/MarkdownEmbed";
import type { EmbedSpec } from "../src/lib/embeds";

const render = (spec: EmbedSpec) =>
  renderToStaticMarkup(createElement(MarkdownEmbed, { spec }));

describe("MarkdownEmbed", () => {
  it("renders YouTube as a static preview card (thumbnail + title, no iframe)", () => {
    const html = render({
      v: 1,
      kind: "youtube",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
    });
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<button"); // no popup/overlay trigger
    expect(html).toContain("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(html).toContain("Never Gonna Give You Up");
    expect(html).toContain("YouTube");
  });

  it("plays a direct video file inline in a <video>", () => {
    const html = render({
      v: 1,
      kind: "video",
      src: "https://cdn.example.com/clip.mp4",
    });
    expect(html).toContain("<video");
    expect(html).toContain("https://cdn.example.com/clip.mp4");
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
