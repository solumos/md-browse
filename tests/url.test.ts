import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../src/lib/url";

describe("normalizeUrl — reddit → old.reddit", () => {
  it("rewrites the JS-shell reddit hosts to old.reddit", () => {
    expect(normalizeUrl("https://www.reddit.com/r/x/comments/y/")).toBe(
      "https://old.reddit.com/r/x/comments/y/",
    );
    expect(normalizeUrl("reddit.com/r/x")).toBe("https://old.reddit.com/r/x");
    expect(normalizeUrl("https://m.reddit.com/")).toBe(
      "https://old.reddit.com/",
    );
  });

  it("leaves old.reddit and unrelated hosts untouched", () => {
    expect(normalizeUrl("https://old.reddit.com/r/x")).toBe(
      "https://old.reddit.com/r/x",
    );
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
    // don't over-match: a look-alike host is left alone
    expect(normalizeUrl("https://notreddit.com/")).toBe(
      "https://notreddit.com/",
    );
  });
});
