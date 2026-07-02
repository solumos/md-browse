import { resolveUrl } from "./url";

/**
 * Form preservation.
 *
 * The HTML→markdown pipeline used to drop <form>/<input>/<button> entirely,
 * which made search boxes and other form-driven pages dead ends. Instead, each
 * form is serialized to a small JSON spec and carried through the markdown as a
 * fenced ```md-form code block; the renderer turns that block back into a real,
 * working form (GET forms submit in-app — see MarkdownForm.tsx).
 *
 * Mechanically: before Readability/Turndown run, every preservable form is
 * replaced in the DOM by a plain-text placeholder token (which survives both
 * pipelines untouched), and after conversion the tokens are swapped for the
 * fenced blocks.
 */

export type FormFieldKind =
  | "text"
  | "hidden"
  | "checkbox"
  | "radio"
  | "select"
  | "textarea"
  | "submit"
  | "button";

export interface FormOption {
  value: string;
  label: string;
  selected?: boolean;
}

export interface FormField {
  kind: FormFieldKind;
  /** Submission name; absent for purely decorative controls (inert buttons). */
  name?: string;
  /** Human label, from an associated <label> or aria-label. */
  label?: string;
  /** Default value (or button caption source). */
  value?: string;
  placeholder?: string;
  /** Original input type for text-like inputs (search, email, password, …). */
  inputType?: string;
  required?: boolean;
  checked?: boolean;
  multiple?: boolean;
  options?: FormOption[];
}

export interface FormSpec {
  v: 1;
  /** Absolute submission URL. */
  action: string;
  method: "get" | "post";
  fields: FormField[];
}

/** Fence language identifying serialized forms inside markdown. */
export const FORM_FENCE_LANG = "md-form";

const TOKEN_RE = /@@MD-FORM-(\d+)@@/g;
const token = (i: number) => `@@MD-FORM-${i}@@`;

/** Sanity caps so a pathological page can't bloat the markdown. */
const MAX_FIELDS = 32;
const MAX_OPTIONS = 150;
const MAX_SPEC_JSON = 12_000;
const MAX_LABEL_CHARS = 120;

const TEXTLIKE_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

/**
 * Replace every preservable <form> in the document with a placeholder token
 * (inserted where the form's first control was) and strip the captured
 * controls, keeping the form's other content in place. Returns the serialized
 * specs; `restoreFormBlocks` swaps the tokens for fenced blocks after
 * conversion. Forms with nothing worth rendering (e.g. hidden-only trackers)
 * are left alone for the existing noise-stripping to remove.
 */
export function preserveForms(doc: Document, baseUrl: string): string[] {
  const specs: string[] = [];
  const labelByControl = mapLabels(doc);

  for (const form of Array.from(doc.querySelectorAll("form"))) {
    const controls = Array.from(
      form.querySelectorAll<HTMLElement>("input, select, textarea, button"),
    );
    const spec = buildFormSpec(form, controls, baseUrl, labelByControl);
    if (!spec) continue;
    const json = JSON.stringify(spec);
    if (json.length > MAX_SPEC_JSON) continue;

    // Labels are captured in the spec; drop them so their text isn't duplicated.
    form.querySelectorAll("label").forEach((l) => l.remove());

    // Drop the captured controls, placing the token where the first one lived
    // so the rendered form appears where the original UI was.
    let marker: HTMLElement | null = null;
    for (const control of controls) {
      if (!control.parentNode) continue; // removed with its label above
      if (!marker) {
        marker = doc.createElement("p");
        marker.textContent = token(specs.length);
        control.parentNode.insertBefore(marker, control);
      }
      control.remove();
    }
    if (!marker) {
      marker = doc.createElement("p");
      marker.textContent = token(specs.length);
      form.insertBefore(marker, form.firstChild);
    }

    // Unwrap the form so any surrounding content it carried (some sites wrap
    // the whole page in one <form>) survives conversion.
    form.replaceWith(...Array.from(form.childNodes));

    specs.push(json);
  }

  return specs;
}

/** At most this many dropped-but-submittable forms get re-appended per page. */
const MAX_APPENDED_FORMS = 2;

/**
 * Swap placeholder tokens for fenced md-form blocks in converted markdown.
 *
 * Readability (or noise-stripping) sometimes discards the region a form lived
 * in — e.g. a portal's search box when a banner wins article extraction, or a
 * header search form on article pages. A lost GET form is a lost capability,
 * so submittable forms whose token didn't survive are appended at the end.
 */
export function restoreFormBlocks(markdown: string, specs: string[]): string {
  const used = new Set<number>();
  let out = markdown.replace(TOKEN_RE, (_m, i: string) => {
    const idx = Number(i);
    const json = specs[idx];
    if (!json) return "";
    used.add(idx);
    return fenceBlock(json);
  });

  const dropped = specs
    .filter((json, i) => {
      if (used.has(i)) return false;
      const spec = parseFormSpec(json);
      return !!spec && isSubmittable(spec);
    })
    .slice(0, MAX_APPENDED_FORMS);
  if (dropped.length) {
    out = out.trimEnd() + "\n\n---\n" + dropped.map(fenceBlock).join("");
  }
  return out;
}

function fenceBlock(json: string): string {
  return `\n\n\`\`\`${FORM_FENCE_LANG}\n${json}\n\`\`\`\n\n`;
}

/**
 * Parse the JSON body of an md-form block back into a FormSpec.
 * Returns null (→ the block renders as a plain code block) for anything that
 * isn't a well-formed spec with an http(s) action.
 */
export function parseFormSpec(text: string): FormSpec | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const spec = data as Record<string, unknown>;
  if (spec.v !== 1) return null;
  if (typeof spec.action !== "string" || !/^https?:\/\//i.test(spec.action)) {
    return null;
  }
  if (spec.method !== "get" && spec.method !== "post") return null;
  if (!Array.isArray(spec.fields)) return null;

  const kinds: FormFieldKind[] = [
    "text",
    "hidden",
    "checkbox",
    "radio",
    "select",
    "textarea",
    "submit",
    "button",
  ];
  const fields: FormField[] = [];
  // +1 leaves room for the implicit submit buildFormSpec appends past the cap,
  // so a 32-control form doesn't lose its (only) submit button on the way back.
  for (const raw of spec.fields.slice(0, MAX_FIELDS + 1)) {
    if (typeof raw !== "object" || raw === null) return null;
    const f = raw as Record<string, unknown>;
    if (!kinds.includes(f.kind as FormFieldKind)) return null;
    fields.push({
      kind: f.kind as FormFieldKind,
      name: optionalString(f.name),
      label: optionalString(f.label),
      value: optionalString(f.value),
      placeholder: optionalString(f.placeholder),
      inputType: optionalString(f.inputType),
      required: f.required === true || undefined,
      checked: f.checked === true || undefined,
      multiple: f.multiple === true || undefined,
      options: parseOptions(f.options),
    });
  }
  return { v: 1, action: spec.action, method: spec.method, fields };
}

/**
 * Forms with an http(s) action can be submitted: GET as a query-string
 * navigation, POST as an urlencoded body (the HTTP layer carries a persistent
 * cookie jar, so logins establish real sessions).
 */
export function isSubmittable(spec: FormSpec): boolean {
  try {
    const { protocol } = new URL(spec.action);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Build the navigation URL for a GET form submission: per HTML semantics the
 * action's existing query string is replaced by the form data.
 */
export function buildSubmitUrl(
  action: string,
  entries: Array<[string, string]>,
): string {
  const url = new URL(action);
  url.hash = "";
  url.search = new URLSearchParams(entries).toString();
  return url.toString();
}

/** Build the urlencoded request body for a POST form submission. */
export function buildPostBody(entries: Array<[string, string]>): string {
  return new URLSearchParams(entries).toString();
}

/**
 * The reason to warn before submitting this form, or null if it's safe. The
 * shared cookie jar enforces neither SameSite nor mixed-content, so we flag the
 * two things a real browser blocks/warns on: cross-site submissions (CSRF) and
 * passwords sent over plaintext HTTP.
 */
export function submissionWarning(
  spec: FormSpec,
  pageUrl: string,
): string | null {
  let action: URL;
  try {
    action = new URL(spec.action);
  } catch {
    return null;
  }
  const hasPassword = spec.fields.some((f) => f.inputType === "password");
  if (hasPassword && action.protocol === "http:") {
    return `This form would send your password to ${action.host} over an unencrypted (HTTP) connection, where others on the network could read it.`;
  }
  try {
    const page = new URL(pageUrl);
    if (page.origin !== action.origin) {
      return `This form sends data to ${action.host}, a different site than the page you're viewing (${page.host}).`;
    }
  } catch {
    /* page origin unknown — skip the cross-site check */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extraction internals
// ---------------------------------------------------------------------------

function buildFormSpec(
  form: HTMLElement,
  controls: HTMLElement[],
  baseUrl: string,
  labelByControl: Map<Element, string>,
): FormSpec | null {
  // Empty action means "submit to the current page" per HTML.
  const action = resolveUrl(form.getAttribute("action") || "", baseUrl);
  if (!action || !/^https?:\/\//i.test(action)) return null;
  const method =
    (form.getAttribute("method") || "get").trim().toLowerCase() === "post"
      ? ("post" as const)
      : ("get" as const);

  const fields: FormField[] = [];
  for (const control of controls) {
    if (fields.length >= MAX_FIELDS) break;
    const field = extractField(control, labelByControl);
    if (field) fields.push(field);
  }

  // Only preserve forms with something visible to interact with; hidden-only
  // trackers and empty shells stay in the DOM and get stripped as noise.
  const hasVisible = fields.some(
    (f) => f.kind !== "hidden" && f.kind !== "button" && f.kind !== "submit",
  );
  const hasLabeledSubmit = fields.some(
    (f) => f.kind === "submit" && !!f.label && f.label !== "Submit",
  );
  if (!hasVisible && !hasLabeledSubmit) return null;

  // Forms submit on Enter even without an explicit button — always render one.
  if (!fields.some((f) => f.kind === "submit")) {
    fields.push({ kind: "submit", label: "Submit" });
  }

  return { v: 1, action, method, fields };
}

function extractField(
  el: HTMLElement,
  labelByControl: Map<Element, string>,
): FormField | null {
  const label = labelByControl.get(el) || attr(el, "aria-label");
  const name = attr(el, "name");
  const value = attr(el, "value");

  switch (el.tagName) {
    case "INPUT": {
      const type = (attr(el, "type") || "text").toLowerCase();
      if (type === "hidden") {
        return name ? { kind: "hidden", name, value: value ?? "" } : null;
      }
      if (type === "checkbox" || type === "radio") {
        if (!name) return null;
        return {
          kind: type,
          name,
          value: value ?? "on",
          checked: el.hasAttribute("checked") || undefined,
          label,
        };
      }
      if (type === "submit" || type === "image") {
        const caption = type === "image" ? attr(el, "alt") : value;
        return { kind: "submit", name, value, label: caption || "Submit" };
      }
      if (type === "button" || type === "reset") {
        return value ? { kind: "button", label: value } : null;
      }
      if (type === "file") return null; // uploads need POST; not supported
      if (!name) return null;
      return {
        kind: "text",
        inputType: TEXTLIKE_INPUT_TYPES.has(type) ? type : "text",
        name,
        value,
        placeholder: attr(el, "placeholder"),
        required: el.hasAttribute("required") || undefined,
        label,
      };
    }
    case "SELECT": {
      if (!name) return null;
      const options = Array.from(el.querySelectorAll("option"))
        .slice(0, MAX_OPTIONS)
        .map((opt) => ({
          value: opt.getAttribute("value") ?? opt.textContent ?? "",
          label: collapse(opt.textContent ?? "") || "—",
          selected: opt.hasAttribute("selected") || undefined,
        }));
      if (!options.length) return null;
      return {
        kind: "select",
        name,
        label,
        multiple: el.hasAttribute("multiple") || undefined,
        options,
      };
    }
    case "TEXTAREA": {
      if (!name) return null;
      return {
        kind: "textarea",
        name,
        value: el.textContent?.trim() || undefined,
        placeholder: attr(el, "placeholder"),
        required: el.hasAttribute("required") || undefined,
        label,
      };
    }
    case "BUTTON": {
      const caption = collapse(el.textContent ?? "") || value || label;
      const type = (attr(el, "type") || "submit").toLowerCase();
      if (type === "submit") {
        return { kind: "submit", name, value, label: caption || "Submit" };
      }
      return caption ? { kind: "button", label: caption } : null;
    }
    default:
      return null;
  }
}

/** Map each labelled control to its label text (both for="" and wrapping labels). */
function mapLabels(doc: Document): Map<Element, string> {
  const map = new Map<Element, string>();
  for (const labelEl of Array.from(doc.querySelectorAll("label"))) {
    const text = labelText(labelEl);
    if (!text) continue;
    const forId = labelEl.getAttribute("for");
    if (forId) {
      const target = doc.getElementById(forId);
      if (target && !map.has(target)) map.set(target, text);
    }
    const wrapped = labelEl.querySelector("input, select, textarea");
    if (wrapped && !map.has(wrapped)) map.set(wrapped, text);
  }
  return map;
}

/** A label's text with any nested controls' text (e.g. option lists) excluded. */
function labelText(labelEl: Element): string {
  const clone = labelEl.cloneNode(true) as Element;
  clone.querySelectorAll("input, select, textarea, button").forEach((el) => el.remove());
  return collapse(clone.textContent ?? "");
}

function attr(el: Element, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v == null ? undefined : v;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_CHARS);
}

function optionalString(v: unknown): string | undefined {
  return typeof v === "string" ? v.slice(0, 2000) : undefined;
}

function parseOptions(v: unknown): FormOption[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: FormOption[] = [];
  for (const raw of v.slice(0, MAX_OPTIONS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const o = raw as Record<string, unknown>;
    out.push({
      value: typeof o.value === "string" ? o.value : "",
      label: typeof o.label === "string" ? o.label : "",
      selected: o.selected === true || undefined,
    });
  }
  return out.length ? out : undefined;
}
