import { describe, expect, it } from "vitest";
import { parseEmbedSpec, videoEmbedFor } from "../src/lib/embeds";
import { htmlToMarkdown } from "../src/lib/convert";

const body = "Body text long enough for readability extraction to keep it. ".repeat(
  8,
);

function embedIn(markdown: string) {
  const json = markdown.match(/```md-embed\n([\s\S]*?)\n```/)?.[1];
  return json ? parseEmbedSpec(json) : null;
}

describe("video embeds", () => {
  it("turns a YouTube iframe into a nocookie /embed player", () => {
    const html =
      `<html><body><article><p>${body}</p>` +
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="clip"></iframe>' +
      "</article></body></html>";
    const spec = embedIn(htmlToMarkdown(html, "https://example.com/").markdown);
    expect(spec?.kind).toBe("youtube");
    expect(spec?.src).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

  it("handles youtu.be and watch?v= URLs", () => {
    for (const src of [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      const html = `<html><body><article><p>${body}</p><iframe src="${src}"></iframe></article></body></html>`;
      expect(embedIn(htmlToMarkdown(html, "https://example.com/").markdown)?.src).toBe(
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      );
    }
  });

  it("preserves a direct <video> as a video embed", () => {
    const html =
      `<html><body><article><p>${body}</p>` +
      '<video src="https://cdn.example.com/clip.mp4"></video></article></body></html>';
    const spec = embedIn(htmlToMarkdown(html, "https://example.com/").markdown);
    expect(spec?.kind).toBe("video");
    expect(spec?.src).toBe("https://cdn.example.com/clip.mp4");
  });

  it("ignores non-video iframes (ads, widgets)", () => {
    const html =
      `<html><body><article><p>${body}</p>` +
      '<iframe src="https://ads.example.com/banner"></iframe></article></body></html>';
    expect(htmlToMarkdown(html, "https://example.com/").markdown).not.toContain(
      "md-embed",
    );
  });

  it("resolves a direct YouTube/Vimeo video URL to an embed", () => {
    const embed = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    expect(videoEmbedFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.src).toBe(
      embed,
    );
    expect(videoEmbedFor("https://youtu.be/dQw4w9WgXcQ")?.src).toBe(embed);
    expect(videoEmbedFor("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.src).toBe(
      embed,
    );
    expect(videoEmbedFor("https://vimeo.com/123456789")?.kind).toBe("vimeo");
    // Not a video (homepage / unrelated) → no embed, fetch normally.
    expect(videoEmbedFor("https://www.youtube.com/")).toBeNull();
    expect(videoEmbedFor("https://example.com/watch?v=x")).toBeNull();
  });

  it("parseEmbedSpec rejects junk, non-https, and unknown kinds", () => {
    expect(parseEmbedSpec("not json")).toBeNull();
    expect(
      parseEmbedSpec(JSON.stringify({ v: 1, kind: "youtube", src: "http://x/e" })),
    ).toBeNull(); // must be https
    expect(
      parseEmbedSpec(JSON.stringify({ v: 1, kind: "evil", src: "https://x/e" })),
    ).toBeNull();
  });
});
