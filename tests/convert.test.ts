import { describe, expect, it } from "vitest";
import { buildPage, htmlToMarkdown } from "../src/lib/convert";
import { parseFormSpec, type FormSpec } from "../src/lib/forms";
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

  it("flattens an infobox (th + images) into blocks + key/value, not a 1-col table", () => {
    const html =
      '<html><body><table class="infobox">' +
      '<tr><th colspan="2">Manhattan</th></tr>' +
      '<tr><td colspan="2"><img src="/pic.jpg" alt="View"></td></tr>' +
      "<tr><th>Country</th><td>United States</td></tr>" +
      "<tr><th>Founded</th><td>1624</td></tr>" +
      "</table></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://example.com/");
    expect(markdown).not.toContain("| --- |"); // not a garbled GFM table
    expect(markdown).toContain("![View](https://example.com/pic.jpg)"); // image kept
    expect(markdown).toContain("**Country**: United States"); // key/value row
    expect(markdown).toContain("**Founded**: 1624");
  });

  it("keeps the submit button on a 32-control form (field-cap boundary)", () => {
    const inputs = Array.from(
      { length: 32 },
      (_, i) => `<input type="text" name="f${i}">`,
    ).join("");
    const html = `<html><body><form action="/big" method="post">${inputs}</form></body></html>`;
    const { markdown } = htmlToMarkdown(html, "https://example.com/");
    const [spec] = formSpecsIn(markdown);
    expect(spec).toBeDefined();
    expect(spec.fields.some((f) => f.kind === "submit")).toBe(true);
  });

  it("does not delete a content-bearing <header> (article title/byline)", () => {
    const html =
      "<html><body>" +
      '<nav><a href="/">Home</a> <a href="/about">About</a></nav>' +
      "<article><header><h1>My Post Title</h1><p>By Jane Doe</p></header>" +
      `<p>${"Real article body text to satisfy readability extraction. ".repeat(10)}</p>` +
      "</article></body></html>";
    const { markdown, title } = htmlToMarkdown(html, "https://example.com/");
    // Site nav is still hoisted...
    expect(markdown).toContain("[About](https://example.com/about)");
    // ...but the article's own header content must NOT be deleted (the h1 may be
    // folded into the title by Readability; the byline stays in the body).
    expect(`${title}\n${markdown}`).toContain("My Post Title");
    expect(markdown).toContain("Jane Doe");
  });
});

describe("htmlToMarkdown — navigation & icon links", () => {
  it("preserves the site's top navigation as a header link row", () => {
    const html = `<html><body>
      <div class="pagetop"><a href="/news">Hacker News</a> <a href="/newest">new</a> | <a href="/login">login</a></div>
      <article><h1>Headline</h1><p>${"Plenty of real article body text here. ".repeat(12)}</p></article>
    </body></html>`;
    const { markdown } = htmlToMarkdown(html, "https://news.ycombinator.com/");
    // Readability would normally strip the nav; we prepend it back as a link row.
    expect(markdown).toContain("[new](https://news.ycombinator.com/newest)");
    expect(markdown).toContain("[login](https://news.ycombinator.com/login)");
    expect(markdown).toContain("---"); // separated from the content
  });

  it("recovers icon-only links (e.g. vote arrows) from their title", () => {
    const html =
      "<html><body><div><span>1.</span>" +
      '<a href="/vote?id=1"><div class="votearrow" title="upvote"></div></a> ' +
      '<a href="https://ex.com/s">A story</a></div></body></html>';
    const { markdown } = htmlToMarkdown(html, "https://news.example.com/");
    expect(markdown).toContain("[upvote](https://news.example.com/vote?id=1)");
  });

  it("keeps a linked image as an image, not a bare text link", () => {
    const html =
      '<html><body><article><p>Intro text long enough for readability to keep it. ' +
      "It needs a fair amount of prose so the article extracts cleanly and we are " +
      'well past the minimum length threshold used by the converter here.</p>' +
      '<a href="/photos/1"><img src="/thumbs/1.jpg" alt="Sunset over the bay"></a>' +
      "</article></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://example.com/");
    // The <img> must survive (linked image), not be flattened to a text link.
    expect(markdown).toContain(
      "![Sunset over the bay](https://example.com/thumbs/1.jpg)",
    );
  });

  it("keeps icon-only links through Readability's article extraction", () => {
    // Enough text that Readability extracts an article; the vote arrow must
    // survive inside it (it's materialized to a text link before extraction).
    const story = `<a href="/vote?id=7"><div class="votearrow" title="upvote"></div></a>
      <a href="https://ex.com/s7">Story seven</a>
      <p>${"Body text for the story list page so extraction has something. ".repeat(10)}</p>`;
    const html = `<html><body><article>${story}</article></body></html>`;
    const { markdown } = htmlToMarkdown(html, "https://news.example.com/");
    expect(markdown).toContain("[upvote](https://news.example.com/vote?id=7)");
  });
});

/** Pull the parsed specs of every md-form block out of converted markdown. */
function formSpecsIn(markdown: string): FormSpec[] {
  const specs: FormSpec[] = [];
  for (const m of markdown.matchAll(/```md-form\n([\s\S]*?)\n```/g)) {
    const spec = parseFormSpec(m[1]);
    expect(spec, `md-form block should parse: ${m[1]}`).not.toBeNull();
    specs.push(spec!);
  }
  return specs;
}

describe("htmlToMarkdown — form preservation", () => {
  it("serializes a GET search form into an md-form block", () => {
    const html = `<html><body>
      <form action="/search" method="get">
        <input type="hidden" name="src" value="home">
        <label for="q">Search</label>
        <input type="search" id="q" name="q" placeholder="Search the site" required>
        <button type="submit">Go</button>
      </form>
    </body></html>`;
    const { markdown } = htmlToMarkdown(html, "https://example.com/portal/");
    expect(markdown).not.toContain("@@MD-FORM");

    const [spec] = formSpecsIn(markdown);
    expect(spec.action).toBe("https://example.com/search");
    expect(spec.method).toBe("get");
    expect(spec.fields).toEqual([
      { kind: "hidden", name: "src", value: "home" },
      {
        kind: "text",
        inputType: "search",
        name: "q",
        placeholder: "Search the site",
        required: true,
        label: "Search",
      },
      { kind: "submit", label: "Go" },
    ]);
  });

  it("defaults the action to the page URL and adds an implicit submit", () => {
    const html =
      '<html><body><form><input type="text" name="q"></form></body></html>';
    const { markdown } = htmlToMarkdown(html, "https://example.com/page");
    const [spec] = formSpecsIn(markdown);
    expect(spec.action).toBe("https://example.com/page");
    expect(spec.fields.at(-1)).toEqual({ kind: "submit", label: "Submit" });
  });

  it("captures selects, checkboxes, and textareas", () => {
    const html = `<html><body><form action="/go">
      <select name="lang">
        <option value="en" selected>English</option>
        <option value="de">Deutsch</option>
      </select>
      <label><input type="checkbox" name="strict" checked> Strict mode</label>
      <textarea name="notes" placeholder="Notes…">draft</textarea>
    </form></body></html>`;
    const [spec] = formSpecsIn(htmlToMarkdown(html, "https://example.com/").markdown);
    const byName = Object.fromEntries(spec.fields.map((f) => [f.name ?? f.kind, f]));
    expect(byName.lang.kind).toBe("select");
    expect(byName.lang.options).toEqual([
      { value: "en", label: "English", selected: true },
      { value: "de", label: "Deutsch" },
    ]);
    expect(byName.strict).toMatchObject({
      kind: "checkbox",
      checked: true,
      label: "Strict mode",
    });
    expect(byName.notes).toMatchObject({ kind: "textarea", value: "draft" });
  });

  it("marks POST forms as post", () => {
    const html = `<html><body><form action="/login" method="POST">
      <input type="text" name="user"><input type="password" name="pass">
    </form></body></html>`;
    const [spec] = formSpecsIn(htmlToMarkdown(html, "https://example.com/").markdown);
    expect(spec.method).toBe("post");
  });

  it("drops hidden-only tracker forms entirely", () => {
    const html = `<html><body>
      <p>Some visible content on the page.</p>
      <form action="/beacon"><input type="hidden" name="t" value="1"></form>
    </body></html>`;
    const { markdown } = htmlToMarkdown(html, "https://example.com/");
    expect(markdown).not.toContain("md-form");
    expect(markdown).toContain("Some visible content");
  });

  it("keeps page content when a form wraps the whole page (WebForms-style)", () => {
    const html = `<html><body><form action="/postback" method="post">
      <h1>Site Title</h1>
      <p>Important page content that must not vanish with the form wrapper.</p>
      <input type="text" name="q" placeholder="Search">
    </form></body></html>`;
    const { markdown } = htmlToMarkdown(html, "https://example.com/");
    expect(markdown).toContain("Important page content");
    expect(formSpecsIn(markdown)).toHaveLength(1);
  });

  it("re-appends a submittable GET form that article extraction dropped", () => {
    const html = ARTICLE_HTML.replace(
      "<nav>",
      `<div id="chrome"><form action="/search"><input type="search" name="q" placeholder="Search"></form></div><nav>`,
    );
    const { markdown } = htmlToMarkdown(html, BASE);
    expect(markdown).toContain("reasonably long paragraph"); // readability path
    const [spec] = formSpecsIn(markdown);
    expect(spec.action).toBe("https://example.com/search");
    // ...and a dropped POST form (e.g. a login) is re-appended too, now that
    // POST forms submit for real.
    const postHtml = ARTICLE_HTML.replace(
      "<nav>",
      `<div><form action="/login" method="post"><input type="text" name="user"></form></div><nav>`,
    );
    const [postSpec] = formSpecsIn(htmlToMarkdown(postHtml, BASE).markdown);
    expect(postSpec.action).toBe("https://example.com/login");
    expect(postSpec.method).toBe("post");
  });

  it("preserves a form inside a Readability-extracted article", () => {
    const html = ARTICLE_HTML.replace(
      "</article>",
      `<form action="/subscribe" method="get">
         <input type="email" name="email" placeholder="you@example.com">
         <button type="submit">Subscribe</button>
       </form></article>`,
    );
    const { markdown } = htmlToMarkdown(html, BASE);
    expect(markdown).toContain("reasonably long paragraph"); // readability path
    const [spec] = formSpecsIn(markdown);
    expect(spec.action).toBe("https://example.com/subscribe");
  });
});

describe("htmlToMarkdown — standalone controls", () => {
  it("shows orphan buttons and inputs as inline badges", () => {
    const html = `<html><body><div>
      <p>Short page.</p>
      <button onclick="menu()">Sign in</button>
      <input type="text" placeholder="Jump to…">
    </div></body></html>`;
    const { markdown } = htmlToMarkdown(html, BASE);
    expect(markdown).toContain("`[ Sign in ]`");
    expect(markdown).toContain("`[ Jump to… ]`");
  });

  it("drops unlabeled icon buttons and orphan selects as noise", () => {
    const html = `<html><body><div>
      <p>Short page.</p>
      <button></button>
      <select><option>en</option><option>de</option></select>
    </div></body></html>`;
    const { markdown } = htmlToMarkdown(html, BASE);
    expect(markdown).not.toContain("[  ]");
    expect(markdown).not.toContain("en");
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
