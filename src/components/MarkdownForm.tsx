import { useState, type FormEvent } from "react";
import {
  buildPostBody,
  buildSubmitUrl,
  isSubmittable,
  submissionWarning,
  type FormField,
  type FormSpec,
} from "../lib/forms";

interface Props {
  spec: FormSpec;
  /** The current page's URL, for same-origin / mixed-content checks. */
  pageUrl: string;
  /** Navigate the browser to the form's submission (POST body via opts). */
  onNavigate: (url: string, opts?: { post?: string }) => void;
}

interface PendingSubmit {
  url: string;
  post?: string;
  warning: string;
}

/**
 * Renders an md-form block (a form preserved from the original page) as a real,
 * working form. GET forms submit as an in-app navigation with the field values
 * as the query string; POST forms submit an urlencoded body. The HTTP layer
 * keeps a persistent cookie jar, so logins establish real sessions.
 */
export function MarkdownForm({ spec, pageUrl, onNavigate }: Props) {
  const submittable = isSubmittable(spec);
  const host = hostOf(spec.action);
  const [pending, setPending] = useState<PendingSubmit | null>(null);

  const submit = (target: { url: string; post?: string }) => {
    if (target.post != null) onNavigate(target.url, { post: target.post });
    else onNavigate(target.url);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!submittable) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(e.currentTarget, submitter ?? undefined);
    const entries: Array<[string, string]> = [];
    data.forEach((value, key) => {
      if (typeof value === "string") entries.push([key, value]);
    });
    // Older WebKit ignores the submitter argument; add its pair manually.
    const submitterName = submitter?.getAttribute("name");
    if (submitterName && !entries.some(([k]) => k === submitterName)) {
      entries.push([submitterName, submitter?.getAttribute("value") ?? ""]);
    }

    const target =
      spec.method === "post"
        ? { url: spec.action, post: buildPostBody(entries) }
        : { url: buildSubmitUrl(spec.action, entries) };

    const warning = submissionWarning(spec, pageUrl);
    if (warning) setPending({ ...target, warning });
    else submit(target);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="not-prose my-6 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40"
    >
      <div className="mb-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="chrome-no-select">
          Form · {host}
          {spec.method === "post" && " · sends data"}
        </span>
        {!submittable && (
          <span
            className="chrome-no-select rounded-full bg-slate-200 px-2 py-0.5 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
            title="This form can't be submitted from here."
          >
            not submittable
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
        {spec.fields.map((field, i) => (
          <Field key={i} field={field} disabled={!submittable} />
        ))}
      </div>

      {pending && (
        <div
          role="alertdialog"
          aria-label="Confirm submission"
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40"
        >
          <p className="mb-3 text-amber-800 dark:text-amber-200">
            ⚠ {pending.warning} Send it anyway?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const t = pending;
                setPending(null);
                submit(t);
              }}
              className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-700"
            >
              Send anyway
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

const INPUT_CLS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-900";
const LABEL_CLS =
  "chrome-no-select text-xs font-medium text-slate-600 dark:text-slate-300";

function Field({ field, disabled }: { field: FormField; disabled: boolean }) {
  switch (field.kind) {
    case "hidden":
      return <input type="hidden" name={field.name} defaultValue={field.value ?? ""} />;

    case "text":
      return (
        <label className="flex min-w-44 flex-1 flex-col gap-1">
          {field.label && <span className={LABEL_CLS}>{field.label}</span>}
          <input
            type={safeInputType(field.inputType)}
            name={field.name}
            defaultValue={field.value}
            placeholder={field.placeholder}
            required={field.required}
            disabled={disabled}
            className={INPUT_CLS}
          />
        </label>
      );

    case "textarea":
      return (
        <label className="flex basis-full flex-col gap-1">
          {field.label && <span className={LABEL_CLS}>{field.label}</span>}
          <textarea
            name={field.name}
            defaultValue={field.value}
            placeholder={field.placeholder}
            required={field.required}
            disabled={disabled}
            rows={4}
            className={INPUT_CLS}
          />
        </label>
      );

    case "select": {
      const selected = (field.options ?? [])
        .filter((o) => o.selected)
        .map((o) => o.value);
      return (
        <label className="flex min-w-44 flex-col gap-1">
          {field.label && <span className={LABEL_CLS}>{field.label}</span>}
          <select
            name={field.name}
            multiple={field.multiple}
            defaultValue={field.multiple ? selected : selected[0]}
            disabled={disabled}
            className={INPUT_CLS}
          >
            {(field.options ?? []).map((o, i) => (
              <option key={i} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    case "checkbox":
    case "radio":
      return (
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type={field.kind}
            name={field.name}
            value={field.value}
            defaultChecked={field.checked}
            disabled={disabled}
            className="h-4 w-4 accent-sky-600"
          />
          <span>{field.label || field.value}</span>
        </label>
      );

    case "submit":
      return (
        <button
          type="submit"
          name={field.name || undefined}
          value={field.value}
          disabled={disabled}
          className="chrome-no-select rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {field.label || "Submit"}
        </button>
      );

    case "button":
      return (
        <button
          type="button"
          disabled
          title="This button needs JavaScript, which this browser doesn't run."
          className="chrome-no-select rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-500 opacity-70 dark:border-slate-600 dark:text-slate-400"
        >
          {field.label}
        </button>
      );
  }
}

/** Whitelist the input types we render; anything exotic falls back to text. */
function safeInputType(type: string | undefined): string {
  switch (type) {
    case "search":
    case "email":
    case "url":
    case "tel":
    case "password":
    case "number":
    case "date":
    case "time":
    case "month":
    case "week":
      return type;
    case "datetime-local":
      return "datetime-local";
    default:
      return "text";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
