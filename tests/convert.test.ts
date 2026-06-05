import { describe, expect, it } from "vitest";
import { buildPage, htmlToMarkdown } from "../src/lib/convert";
import { PageError, type RawResponse } from "../src/lib/types";

const BASE = "https://example.com/blog/post";

function raw(partial: Partial<RawResponse>): RawResponse {
  return {
    body: "",
    contentType: "",
    finalUrl: BASE,
    status: 200,
    ...partial,
  };
}

const ARTICLE_HTML = `<!doctype html><html><head><title>Hello World</title></head>
<body>
  <nav>site nav that should be dropped</nav>
  <article>
    <h1>Hello World</h1>
    <p>This is a reasonably long paragraph of article content so that Readability
    treats it as the main body of the document and extracts it cleanly. We need a
    fair amount of text here to clear the minimum-length threshold used by the
    converter, otherwise it would fall back to converting the whole body instead.</p>
    <p>Here is a <a href="/relative/link">relative link</a> and an
    <a href="https://other.example.org/abs">absolute link</a>.</p>
    <p>An image: <img src="/img/photo.png" alt="A photo"></p>
    <pre><code>const x = 1;</code></pre>
    <table>
      <thead><tr><th>Name</th><th>Age</th></tr></thead>
      <tbody><tr><td>Ann</td><td>30</td></tr></tbody>
    </table>
  </article>
  <footer>footer junk</footer>
</body></html>`;

describe("buildPage — content negotiation", () => {
  it("passes through native markdown unchanged", () => {
    const page = buildPage(
      raw({
        body: "# Title\n\nSome **markdown** body.",
        contentType: "text/markdown; charset=utf-8",
      }),
      BASE,
    );
    expect(page.source).toBe("native");
    expect(page.markdown).toContain("# Title");
    expect(page.markdown).toContain("**markdown**");
    expect(page.title).toBe("Title");
  });

  it("treats a .md URL as native markdown even with text/plain", () => {
    const page = buildPage(
      raw({
        body: "# Readme\n\nhello",
        contentType: "text/plain",
        finalUrl: "https://raw.example.com/README.md",
      }),
      "https://raw.example.com/README.md",
    );
    expect(page.source).toBe("native");
    expect(page.title).toBe("Readme");
  });

  it("converts HTML to markdown", () => {
    const page = buildPage(
      raw({ body: ARTICLE_HTML, contentType: "text/html; charset=utf-8" }),
      BASE,
    );
    expect(page.source).toBe("converted");
    // Readability extracts the <h1> as the title and removes it from the body.
    expect(page.title).toBe("Hello World");
    expect(page.markdown).toContain("reasonably long paragraph");
  });

  it("shows JSON as a fenced code block (raw)", () => {
    const page = buildPage(
      raw({ body: '{"a":1}', contentType: "application/json" }),
      BASE,
    );
    expect(page.source).toBe("raw");
    expect(page.markdown).toContain("```json");
    expect(page.markdown).toContain('{"a":1}');
  });

  it("throws an empty PageError for blank markdown", () => {
    expect(() =>
      buildPage(raw({ body: "   ", contentType: "text/markdown" }), BASE),
    ).toThrowError(PageError);
  });
});

describe("htmlToMarkdown — fidelity", () => {
  const { markdown } = htmlToMarkdown(ARTICLE_HTML, BASE);

  it("resolves relative links to absolute against the page URL", () => {
    expect(markdown).toContain("https://example.com/relative/link");
  });

  it("keeps absolute links absolute", () => {
    expect(markdown).toContain("https://other.example.org/abs");
  });

  it("resolves relative image src and preserves alt text", () => {
    expect(markdown).toContain("![A photo](https://example.com/img/photo.png)");
  });

  it("emits fenced code blocks", () => {
    expect(markdown).toContain("```");
    expect(markdown).toContain("const x = 1;");
  });

  it("emits a GFM table", () => {
    expect(markdown).toContain("| Name | Age |");
  });

  it("drops obvious chrome like nav/footer", () => {
    expect(markdown).not.toContain("site nav that should be dropped");
    expect(markdown).not.toContain("footer junk");
  });
});

describe("htmlToMarkdown — layout tables (e.g. Hacker News)", () => {
  it("flattens header-less layout tables into readable links, not raw HTML", () => {
    const html = `<html><body>
      <table><tr>
        <td><span>1.</span></td>
        <td><a id="up_1" href="/vote?id=1"></a></td>
        <td><a href="https://example.com/story">A Great Story</a> (<a href="/from?site=example.com">example.com</a>)</td>
      </tr></table>
    </body></html>`;
    const { markdown } = htmlToMarkdown(html, "https://news.example.com/");
    expect(markdown).not.toContain("<table");
    expect(markdown).not.toContain("<td");
    expect(markdown).toContain("[A Great Story](https://example.com/story)");
    // the empty vote-arrow anchor is dropped as noise
    expect(markdown).not.toContain("/vote?id=1");
  });

  it("still converts real data tables (with <th>) to GFM tables", () => {
    const html =
      "<html><body><table><thead><tr><th>Name</th><th>Age</th></tr></thead>" +
      "<tbody><tr><td>Ann</td><td>30</td></tr></tbody></table></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://example.com/");
    expect(markdown).toContain("| Name | Age |");
  });
});

describe("htmlToMarkdown — full-body fallback", () => {
  it("converts the whole body when there is no extractable article", () => {
    const html =
      "<html><body><div><p>Short note.</p>" +
      '<a href="/x">x</a></div></body></html>';
    const { markdown } = htmlToMarkdown(html, BASE);
    expect(markdown).toContain("Short note.");
    expect(markdown).toContain("https://example.com/x");
  });
});
