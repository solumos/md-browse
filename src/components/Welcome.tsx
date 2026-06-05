interface Props {
  onNavigate: (url: string) => void;
}

const EXAMPLES: { label: string; url: string; note: string }[] = [
  {
    label: "A raw Markdown file",
    url: "https://raw.githubusercontent.com/mixmark-io/turndown/master/README.md",
    note: "served as markdown — rendered as-is",
  },
  {
    label: "Wikipedia: Markdown",
    url: "https://en.wikipedia.org/wiki/Markdown",
    note: "HTML — converted to markdown",
  },
  {
    label: "The original Markdown spec",
    url: "https://daringfireball.net/projects/markdown/syntax",
    note: "HTML — converted to markdown",
  },
  {
    label: "Hacker News",
    url: "https://news.ycombinator.com",
    note: "HTML — converted to markdown",
  },
];

export function Welcome({ onNavigate }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col px-6 py-16">
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
        Markdown Browser
      </h1>
      <p className="mb-8 text-slate-600 dark:text-slate-400">
        Enter a URL above to browse the web as clean markdown. Pages are requested
        with{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm dark:bg-slate-800">
          Accept: text/markdown
        </code>
        ; if the site doesn&rsquo;t serve markdown, the page is converted from HTML
        automatically.
      </p>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Try one
      </h2>
      <ul className="flex flex-col gap-2">
        {EXAMPLES.map((ex) => (
          <li key={ex.url}>
            <button
              type="button"
              onClick={() => onNavigate(ex.url)}
              className="group flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-sky-300 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-700 dark:hover:bg-slate-700"
            >
              <span>
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                  {ex.label}
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {ex.note}
                </span>
              </span>
              <span className="text-slate-300 transition group-hover:text-sky-400">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
