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

describe("buildPage — JS-fallback trigger (empty detection)", () => {
  // loadPage re-renders with JavaScript exactly when buildPage throws "empty".
  it("throws kind 'empty' for a client-rendered shell (→ triggers JS render)", () => {
    const shell = raw({
      body:
        '<html><head><title>App</title></head><body>' +
        '<div id="root"></div><script src="/app.js"></script></body></html>',
      contentType: "text/html; charset=utf-8",
    });
    expect(() => buildPage(shell, BASE)).toThrow(PageError);
    try {
      buildPage(shell, BASE);
    } catch (e) {
      expect((e as PageError).kind).toBe("empty");
    }
  });

  it("does NOT throw for a real article (no needless JS render)", () => {
    const page = buildPage(
      raw({
        body:
          "<html><body><article><h1>Real Title</h1><p>" +
          "Plenty of genuine article text that converts cleanly. ".repeat(8) +
          "</p></article></body></html>",
        contentType: "text/html; charset=utf-8",
      }),
      BASE,
    );
    expect(page.source).toBe("converted");
    expect(page.markdown).toContain("Real Title");
  });
});

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

  it("renders a direct image URL as an inline image (not an error)", () => {
    const page = buildPage(
      raw({
        body: "",
        contentType: "image/jpeg",
        finalUrl: "https://i.redd.it/abc123.jpg",
      }),
      "https://i.redd.it/abc123.jpg",
    );
    expect(page.source).toBe("raw");
    expect(page.markdown).toBe("![abc123.jpg](https://i.redd.it/abc123.jpg)");
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

/** Blockquote depth of the line containing `needle` (Turndown uses "> > "). */
function bqDepth(markdown: string, needle: string): number {
  const line = markdown.split("\n").find((l) => l.includes(needle)) ?? "";
  return (line.match(/^((?:>\s*)+)/)?.[1].match(/>/g) ?? []).length;
}

describe("htmlToMarkdown — comment threads (nesting)", () => {
  it("nests Hacker News replies by their indent depth", () => {
    const row = (id: number, indent: number, user: string, text: string) =>
      `<tr class="athing comtr" id="${id}"><td><table><tbody><tr>` +
      `<td class="ind" indent="${indent}"><img src="s.gif" width="${indent * 40}"></td>` +
      `<td class="default"><div class="comhead"><a class="hnuser">${user}</a> <span class="age">1 hour ago</span></div>` +
      `<div class="comment"><div class="commtext">${text}</div></div></td></tr></tbody></table></td></tr>`;
    const html =
      '<html><body><table class="comment-tree"><tbody>' +
      row(1, 0, "alice", "top-level point") +
      row(2, 1, "bob", "a direct reply") +
      row(3, 2, "carol", "reply to the reply") +
      "</tbody></table></body></html>";
    const { markdown } = htmlToMarkdown(
      html,
      "https://news.ycombinator.com/item?id=1",
    );
    expect(markdown).toContain("**alice**");
    expect(markdown).toContain("a direct reply");
    // Depth strictly increases with reply nesting.
    expect(bqDepth(markdown, "alice")).toBe(1);
    expect(bqDepth(markdown, "bob")).toBe(2);
    expect(bqDepth(markdown, "carol")).toBe(3);
  });

  it("adds HN upvote links to comment headers", () => {
    const html =
      '<html><body><table class="comment-tree"><tbody>' +
      '<tr class="athing comtr" id="1"><td><table><tbody><tr>' +
      '<td class="ind" indent="0"><img width="0"></td>' +
      '<td class="votelinks"><a id="up_1" href="/vote?id=1&amp;how=up&amp;goto=item"><div class="votearrow" title="upvote"></div></a></td>' +
      '<td class="default"><div class="comhead"><a class="hnuser">alice</a> <span class="age">1 hour ago</span></div>' +
      '<div class="comment"><div class="commtext">a point</div></div></td>' +
      "</tr></tbody></table></td></tr></tbody></table></body></html>";
    const { markdown } = htmlToMarkdown(
      html,
      "https://news.ycombinator.com/item?id=1",
    );
    expect(markdown).toContain(
      "[▲](https://news.ycombinator.com/vote?id=1&how=up&goto=item)",
    );
    expect(markdown).toContain("**alice**");
  });

  it("adds a reply link to HN comments", () => {
    const html =
      '<html><body><table class="comment-tree"><tbody>' +
      '<tr class="athing comtr" id="9"><td><table><tbody><tr>' +
      '<td class="ind" indent="0"><img width="0"></td>' +
      '<td class="default"><div class="comhead"><a class="hnuser">alice</a> <span class="age">1 hour ago</span></div>' +
      '<div class="comment"><div class="commtext">a point</div>' +
      '<div class="reply"><p><font size="1"><u><a href="reply?id=9&amp;goto=item%3Fid%3D1%239">reply</a></u></font></p></div>' +
      "</div></td>" +
      "</tr></tbody></table></td></tr></tbody></table></body></html>";
    const { markdown } = htmlToMarkdown(
      html,
      "https://news.ycombinator.com/item?id=1",
    );
    expect(markdown).toContain(
      "[↳ reply](https://news.ycombinator.com/reply?id=9&goto=item%3Fid%3D1%239)",
    );
  });

  it("nests old.reddit replies by DOM structure", () => {
    const comment = (author: string, text: string, child = ""): string =>
      '<div class="thing comment"><div class="entry">' +
      `<p class="tagline"><a class="author">${author}</a> <span class="score unvoted">5 points</span></p>` +
      `<div class="usertext-body"><div class="md"><p>${text}</p></div></div></div>` +
      (child
        ? `<div class="child"><div class="sitetable listing">${child}</div></div>`
        : "") +
      "</div>";
    const html =
      '<html><body><div class="commentarea"><div class="sitetable nestedlisting">' +
      comment("alice", "top", comment("bob", "reply", comment("carol", "deep"))) +
      "</div></div></body></html>";
    const { markdown } = htmlToMarkdown(
      html,
      "https://old.reddit.com/r/x/comments/y/",
    );
    expect(markdown).toContain("**alice**");
    expect(markdown).toContain("deep");
    expect(bqDepth(markdown, "alice")).toBe(1);
    expect(bqDepth(markdown, "bob")).toBe(2);
    expect(bqDepth(markdown, "carol")).toBe(3);
  });
});

describe("htmlToMarkdown — noise cleanup", () => {
  it("shows javascript:/data: links as plain text (not dead links)", () => {
    const html =
      "<html><body><article>" +
      `<p>${"Real article body text long enough to extract cleanly here. ".repeat(6)}</p>` +
      '<p>Click <a href="javascript:void(0)">share</a> or <a href="https://ok.com/go">go</a>.</p>' +
      "</article></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://example.com/");
    expect(markdown).not.toContain("javascript:");
    expect(markdown).not.toContain("[share]"); // rendered as plain text
    expect(markdown).toContain("[go](https://ok.com/go)");
  });

  it("keeps a link wrapping block content (image + caption) on one line", () => {
    // Video-grid tiles wrap a thumbnail image AND a caption in one <a>; if the
    // link text spans a blank line it isn't a valid markdown link and renders
    // as broken `](url)` text.
    const html =
      "<html><body><article>" +
      `<p>${"Filler body text so readability keeps the page. ".repeat(6)}</p>` +
      '<a href="/watch/1"><div><img src="/t.jpg" alt="Clip"></div><div>added today</div></a>' +
      "</article></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://ex.com/");
    expect(markdown).toContain(
      "[![Clip](https://ex.com/t.jpg) added today](https://ex.com/watch/1)",
    );
    // No line that is just a dangling link tail.
    expect(markdown).not.toMatch(/^\]\(https/m);
  });

  it("strips reddit logged-out chrome on reddit hosts", () => {
    const html =
      '<html><body><div class="content" role="main">' +
      '<div class="listingsignupbar"><h2 class="listingsignupbar__title">Welcome to Reddit</h2><p>Become a Redditor</p></div>' +
      '<div class="sitetable"><div class="thing"><p class="title"><a href="https://ex.com/p">A real post title</a></p>' +
      `<p>${"Actual post content that should survive the cleanup here. ".repeat(5)}</p></div></div>` +
      "</div></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://old.reddit.com/r/x/");
    expect(markdown).not.toContain("Welcome to Reddit");
    expect(markdown).toContain("A real post title");
  });

  it("strips reddit listing noise (flair glue, thumbnail duration, loading)", () => {
    const html =
      '<html><body><div class="content" role="main"><div class="sitetable">' +
      '<div class="thing link"><span class="rank">1</span>' +
      '<a class="thumbnail"><span class="duration-overlay">0:21</span></a>' +
      '<div class="entry"><p class="title">' +
      '<a class="title" href="https://v.redd.it/abc">Dog defence was needed tbh</a>' +
      '<span class="linkflairlabel">SOCIETY</span></p>' +
      '<div class="expando expando-uninitialized">loading...</div>' +
      '<p class="tagline">submitted by <a class="author">Maleficent</a></p></div></div>' +
      "</div></div></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://old.reddit.com/r/interesting/");
    expect(markdown).toContain("Dog defence was needed tbh");
    expect(markdown).not.toContain("SOCIETY"); // flair no longer glued to title
    expect(markdown).not.toContain("loading"); // JS-only expando placeholder
    expect(markdown).not.toContain("0:21"); // thumbnail duration overlay
  });

  it("compacts reddit posts into a 2-line item and drops share/save/report", () => {
    const html =
      '<html><body><div class="content" role="main"><div class="sitetable">' +
      '<div class="thing link"><div class="midcol"><div class="score unvoted">30.1k</div></div>' +
      '<div class="entry"><p class="title"><a class="title" href="https://v.redd.it/x">Dog defence</a> ' +
      '<span class="domain">(<a href="/domain/v.redd.it/">v.redd.it</a>)</span></p>' +
      '<p class="tagline">submitted <time>12 hours ago</time> by <a class="author" href="/user/u">u</a></p>' +
      '<ul class="flat-list buttons"><li class="first"><a class="comments" href="/r/x/comments/1/">5512 comments</a></li>' +
      '<li><a href="javascript:void(0)">share</a></li><li><a href="javascript:void(0)">save</a></li>' +
      '<li><a href="javascript:void(0)">report</a></li></ul></div></div>' +
      "</div></div></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://old.reddit.com/r/x/");
    expect(markdown).toContain("**[Dog defence](https://v.redd.it/x)**");
    expect(markdown).toContain("30.1k");
    expect(markdown).toContain(
      "[5512 comments](https://old.reddit.com/r/x/comments/1/)",
    );
    expect(markdown).not.toContain("share");
    expect(markdown).not.toContain("report");
  });
});

describe("htmlToMarkdown — reddit media", () => {
  const listing = (post: string) =>
    `<html><body><div class="content" role="main"><div class="sitetable">${post}</div></div></body></html>`;

  it("keeps listing thumbnails as small linked images", () => {
    const html = listing(
      '<div class="thing link">' +
        '<a class="thumbnail may-blank outbound" href="https://i.redd.it/full.jpeg">' +
        '<img src="//preview.redd.it/full.jpeg?width=140&amp;height=140&amp;crop=1:1,smart&amp;s=sig"></a>' +
        '<div class="entry"><p class="title"><a class="title" href="https://i.redd.it/full.jpeg">Rolex for sale</a></p>' +
        '<p class="tagline">submitted <time>2 hours ago</time> by <a class="author" href="/user/u">u</a></p></div></div>',
    );
    const { markdown } = htmlToMarkdown(
      html,
      "https://old.reddit.com/r/Watchexchange/",
    );
    expect(markdown).toContain(
      "[![](https://preview.redd.it/full.jpeg?width=140&height=140&crop=1:1,smart&s=sig)](https://i.redd.it/full.jpeg)",
    );
    expect(markdown).toContain("**[Rolex for sale](https://i.redd.it/full.jpeg)**");
  });

  it("renders nothing for a self post's imageless thumbnail placeholder", () => {
    const html = listing(
      '<div class="thing link">' +
        '<a class="thumbnail self may-blank"></a>' +
        '<div class="entry"><p class="title"><a class="title" href="/r/x/comments/1/">Rules update</a></p></div></div>',
    );
    const { markdown } = htmlToMarkdown(html, "https://old.reddit.com/r/x/");
    expect(markdown).not.toContain("![");
  });

  it("inlines every gallery image on a gallery post's own page (no thumb dupe)", () => {
    const html = listing(
      '<div class="thing link">' +
        '<a class="thumbnail may-blank outbound" href="https://www.reddit.com/gallery/1">' +
        '<img src="//preview.redd.it/t.jpg?width=140&amp;height=140"></a>' +
        '<div class="entry"><p class="title"><a class="title" href="https://www.reddit.com/gallery/1">[WTS] AP Royal Oak</a></p>' +
        '<div class="expando expando-uninitialized"><div class="media-preview"><div class="media-gallery">' +
        '<div class="gallery-tiles"><img class="preview" src="https://preview.redd.it/a.jpg?width=108&amp;s=1"></div>' +
        '<div class="gallery-preview"><div class="media-preview-content">' +
        '<a class="gallery-item-thumbnail-link" href="https://preview.redd.it/a.jpg?width=1080&amp;s=2"><img class="preview" src="https://preview.redd.it/a.jpg?width=1080&amp;s=2"></a></div></div>' +
        '<div class="gallery-preview"><div class="media-preview-content">' +
        '<a class="gallery-item-thumbnail-link" href="https://preview.redd.it/b.jpg?width=1080&amp;s=3"><img class="preview" src="https://preview.redd.it/b.jpg?width=1080&amp;s=3"></a></div></div>' +
        "</div></div></div></div></div>",
    );
    const { markdown } = htmlToMarkdown(
      html,
      "https://old.reddit.com/r/Watchexchange/comments/1/wts/",
    );
    expect(markdown).toContain("![](https://preview.redd.it/a.jpg?width=1080&s=2)");
    expect(markdown).toContain("![](https://preview.redd.it/b.jpg?width=1080&s=3)");
    // The 108px grid tiles and the 140px thumbnail must not duplicate the media.
    expect(markdown).not.toContain("width=140");
    expect(markdown).not.toContain("a.jpg?width=108&s=1");
  });

  it("inlines a single-image post's preview linked to the original", () => {
    const html = listing(
      '<div class="thing link">' +
        '<div class="entry"><p class="title"><a class="title" href="https://i.redd.it/x.jpeg">Datejust</a></p>' +
        '<div class="expando expando-uninitialized"><div class="media-preview"><div class="media-preview-content">' +
        '<a href="https://i.redd.it/x.jpeg" class="may-blank post-link">' +
        '<img class="preview" src="https://preview.redd.it/x.jpeg?width=672&amp;s=9"></a>' +
        "</div></div></div></div></div>",
    );
    const { markdown } = htmlToMarkdown(
      html,
      "https://old.reddit.com/r/Watchexchange/comments/2/wts/",
    );
    expect(markdown).toContain(
      "[![](https://preview.redd.it/x.jpeg?width=672&s=9)](https://i.redd.it/x.jpeg)",
    );
  });

  it("keeps selftext that lives inside an uninitialized expando", () => {
    const html = listing(
      '<div class="thing link">' +
        '<div class="entry"><p class="title"><a class="title" href="/r/x/comments/3/">Announcement</a></p>' +
        '<div class="expando expando-uninitialized"><form action="#" class="usertext">' +
        '<div class="usertext-body"><div class="md"><p>The original announcement text survives.</p></div></div>' +
        "</form></div></div></div>",
    );
    const { markdown } = htmlToMarkdown(
      html,
      "https://old.reddit.com/r/x/comments/3/announcement/",
    );
    expect(markdown).toContain("The original announcement text survives.");
  });
});
