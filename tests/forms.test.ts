import { describe, expect, it } from "vitest";
import {
  buildPostBody,
  buildSubmitUrl,
  isSubmittable,
  parseFormSpec,
  submissionWarning,
  type FormSpec,
} from "../src/lib/forms";

const GET_SPEC: FormSpec = {
  v: 1,
  action: "https://example.com/search",
  method: "get",
  fields: [{ kind: "text", name: "q" }, { kind: "submit", label: "Go" }],
};

describe("parseFormSpec", () => {
  it("round-trips a valid spec", () => {
    expect(parseFormSpec(JSON.stringify(GET_SPEC))).toEqual(GET_SPEC);
  });

  it("rejects non-JSON and non-spec JSON", () => {
    expect(parseFormSpec("not json")).toBeNull();
    expect(parseFormSpec('"just a string"')).toBeNull();
    expect(parseFormSpec("{}")).toBeNull();
    expect(parseFormSpec('{"v":2,"action":"https://x.com","method":"get","fields":[]}')).toBeNull();
  });

  it("rejects specs with a non-http action (e.g. javascript:)", () => {
    expect(
      parseFormSpec(
        JSON.stringify({ ...GET_SPEC, action: "javascript:alert(1)" }),
      ),
    ).toBeNull();
  });

  it("rejects unknown field kinds", () => {
    expect(
      parseFormSpec(JSON.stringify({ ...GET_SPEC, fields: [{ kind: "file" }] })),
    ).toBeNull();
  });
});

describe("isSubmittable", () => {
  it("allows GET forms with http(s) actions", () => {
    expect(isSubmittable(GET_SPEC)).toBe(true);
  });

  it("allows POST forms (submitted as an urlencoded body)", () => {
    expect(isSubmittable({ ...GET_SPEC, method: "post" })).toBe(true);
  });
});

describe("buildPostBody", () => {
  it("urlencodes entries, preserving repeats and special chars", () => {
    expect(
      buildPostBody([
        ["acct", "user name"],
        ["pw", "a&b=c"],
        ["tag", "x"],
        ["tag", "y"],
      ]),
    ).toBe("acct=user+name&pw=a%26b%3Dc&tag=x&tag=y");
  });
});

describe("buildSubmitUrl", () => {
  it("encodes the entries as the query string", () => {
    expect(
      buildSubmitUrl("https://example.com/search", [
        ["q", "hello world"],
        ["lang", "en"],
      ]),
    ).toBe("https://example.com/search?q=hello+world&lang=en");
  });

  it("replaces the action's existing query and drops fragments (HTML GET semantics)", () => {
    expect(
      buildSubmitUrl("https://example.com/search?old=1#frag", [["q", "x"]]),
    ).toBe("https://example.com/search?q=x");
  });

  it("keeps repeated names (multi-select, checkbox groups)", () => {
    expect(
      buildSubmitUrl("https://example.com/f", [
        ["tag", "a"],
        ["tag", "b"],
      ]),
    ).toBe("https://example.com/f?tag=a&tag=b");
  });
});

describe("submissionWarning", () => {
  const spec = (over: Partial<FormSpec> = {}): FormSpec => ({
    v: 1,
    action: "https://example.com/f",
    method: "post",
    fields: [{ kind: "text", name: "q" }],
    ...over,
  });

  it("allows a same-origin https submission with no warning", () => {
    expect(submissionWarning(spec(), "https://example.com/page")).toBeNull();
  });

  it("warns on a cross-site submission (CSRF surface)", () => {
    const w = submissionWarning(
      spec({ action: "https://bank.example/transfer" }),
      "https://evil.example/page",
    );
    expect(w).toContain("bank.example");
    expect(w).toContain("different site");
  });

  it("warns when a password would go over plaintext HTTP", () => {
    const w = submissionWarning(
      spec({
        action: "http://site.example/login",
        fields: [{ kind: "text", name: "pw", inputType: "password" }],
      }),
      "http://site.example/login",
    );
    expect(w).toContain("unencrypted");
  });
});
