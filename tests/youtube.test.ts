import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { youtubePage } from "../src/lib/youtube";
import { buildPage } from "../src/lib/convert";
import { parseEmbedSpec } from "../src/lib/embeds";
import { parseFormSpec } from "../src/lib/forms";

/**
 * Render markdown exactly as MarkdownView does for the injection tests: same
 * remark-gfm, rehype-raw OFF, and the same md-embed/md-form fence promotion —
 * so a forged fence would surface as a real player/form here.
 */
function renderHtml(markdown: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
        components: {
          a: ({ href, children }: any) =>
            createElement("a", { href, "data-link": "1" }, children),
          pre: ({ children, node }: any) => {
            const code = node?.children?.find((c: any) => c.tagName === "code");
            const cls = code?.properties?.className;
            const classes = Array.isArray(cls) ? cls : cls ? [cls] : [];
            const text = codeText(code);
            if (classes.includes("language-md-embed") && parseEmbedSpec(text)) {
              return createElement("video", { "data-forged-embed": "1" });
            }
            if (classes.includes("language-md-form") && parseFormSpec(text)) {
              return createElement("form", { "data-forged-form": "1" });
            }
            return createElement("pre", null, children);
          },
        },
      },
      markdown,
    ),
  );
}

function codeText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.value;
  return (node.children ?? []).map(codeText).join("");
}

const video = (id: string, title: string) => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: "ChannelName" }] },
    shortViewCountText: { simpleText: "1.2M views" },
    publishedTimeText: { simpleText: "3 years ago" },
    lengthText: { simpleText: "12:34" },
  },
});

// The (deep) shape YouTube actually serves for search results.
const searchData = (...videos: unknown[]) => ({
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [{ itemSectionRenderer: { contents: videos } }],
        },
      },
    },
  },
});

const pageHtml = (data: unknown) =>
  `<html><body><script>var ytInitialData = ${JSON.stringify(data)};</script></body></html>`;

describe("youtubePage", () => {
  it("gives the home page a working search form", () => {
    const page = youtubePage("<html></html>", "https://www.youtube.com/");
    expect(page?.title).toBe("YouTube");
    expect(page?.markdown).toContain("```md-form");
    expect(page?.markdown).toContain('"search_query"');
    expect(page?.markdown).toContain('"https://www.youtube.com/results"');
  });

  it("lists search results with playable /watch links and thumbs", () => {
    const html = pageHtml(
      searchData(video("dQw4w9WgXcQ", "Never Gonna"), video("abc123def45", "Second")),
    );
    const page = youtubePage(
      html,
      "https://www.youtube.com/results?search_query=rick",
    );
    expect(page?.title).toBe("rick — YouTube");
    expect(page?.markdown).toContain(
      "**[Never Gonna](https://www.youtube.com/watch?v=dQw4w9WgXcQ)**",
    );
    expect(page?.markdown).toContain(
      "![](https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg)",
    );
    // Escaping is applied in the markdown, but it renders back to clean text.
    expect(renderHtml(page!.markdown)).toContain(
      "ChannelName · 12:34 · 1.2M views · 3 years ago",
    );
    expect(page?.markdown).toContain("[Second]");
    // The search box comes back prefilled with the query.
    expect(page?.markdown).toContain('"value":"rick"');
  });

  it("dedupes repeated videos and tolerates junk data", () => {
    const dup = video("dQw4w9WgXcQ", "Never Gonna");
    const html = pageHtml(searchData(dup, dup, { adSlotRenderer: { x: 1 } }));
    const page = youtubePage(html, "https://www.youtube.com/results?search_query=x");
    expect(page?.markdown.split("watch?v=dQw4w9WgXcQ").length - 1).toBe(2); // thumb + title of ONE item
  });

  it("degrades gracefully when ytInitialData is missing or malformed", () => {
    for (const html of ["<html></html>", "<script>var ytInitialData = {broken;</script>"]) {
      const page = youtubePage(html, "https://www.youtube.com/results?search_query=x");
      expect(page?.markdown).toContain("No results found");
      expect(page?.markdown).toContain("```md-form"); // search still works
    }
  });

  it("passes through non-YouTube and non-home/search URLs", () => {
    expect(youtubePage("<html></html>", "https://example.com/")).toBeNull();
    expect(
      youtubePage("<html></html>", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBeNull();
    expect(youtubePage("<html></html>", "https://www.youtube.com/@somechannel")).toBeNull();
  });

  it("does not let a crafted search_query forge an md-embed player or block markdown", () => {
    // A newline+fence payload that, unescaped, becomes a real ```md-embed video.
    const evil =
      'cats\n\n~~~md-embed\n{"v":1,"kind":"video","src":"https://evil.example/beacon.mp4"}\n~~~';
    const page = youtubePage(
      "<html></html>",
      `https://www.youtube.com/results?search_query=${encodeURIComponent(evil)}`,
    );
    const html = renderHtml(page!.markdown);
    // The only md-embed present must be nothing (no search results here); the
    // forged one must NOT have become a player, and no block markdown injected.
    expect(html).not.toContain("data-forged-embed");
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("<table");
    // The legit search form still renders (its own md-form fence survives).
    expect(html).toContain("data-forged-form"); // = the real search box
  });

  it("does not autolink attacker URLs in the query heading or channel meta", () => {
    const page = youtubePage(
      "<html></html>",
      "https://www.youtube.com/results?search_query=" +
        encodeURIComponent("visit http://evil.example and www.evil.example"),
    );
    const html = renderHtml(page!.markdown);
    expect(html).not.toContain('href="http://evil.example"');
    expect(html).not.toContain('href="http://www.evil.example"');
  });

  it("keeps a malicious video title from breaking out of its link", () => {
    const data = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      {
                        videoRenderer: {
                          videoId: "dQw4w9WgXcQ",
                          title: {
                            runs: [
                              {
                                text:
                                  "pwn](https://youtube.com) [x\n\n~~~md-embed\n{\"v\":1,\"kind\":\"video\",\"src\":\"https://evil.example/x.mp4\"}\n~~~",
                              },
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };
    const html = renderHtml(
      youtubePage(
        `<script>var ytInitialData = ${JSON.stringify(data)};</script>`,
        "https://www.youtube.com/results?search_query=x",
      )!.markdown,
    );
    expect(html).not.toContain("data-forged-embed");
    // The title's fake "](url)" must not have produced a second/hijacked anchor
    // pointing anywhere but the real watch URL.
    expect(html).not.toContain('href="https://youtube.com"');
  });

  it("buildPage routes YouTube HTML to the synthesized page as converted source", () => {
    const raw = {
      body: pageHtml(searchData(video("dQw4w9WgXcQ", "Never Gonna"))),
      contentType: "text/html; charset=utf-8",
      finalUrl: "https://www.youtube.com/results?search_query=rick",
      status: 200,
    };
    const page = buildPage(raw, raw.finalUrl);
    expect(page.source).toBe("converted"); // md-form renders interactive
    expect(page.markdown).toContain("```md-form");
    expect(page.markdown).toContain("watch?v=dQw4w9WgXcQ");
  });
});
