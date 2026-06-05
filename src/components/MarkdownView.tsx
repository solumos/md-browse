import { useEffect, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

interface Props {
  markdown: string;
  /** Base URL for resolving any still-relative links (defensive). */
  baseUrl: string;
  /** Navigate within the app to an http(s) URL. */
  onNavigate: (url: string) => void;
  /** Open a URL in the OS default handler (mailto:, downloads, modifier-click…). */
  onOpenExternal: (url: string) => void;
}

// File extensions we can't render as markdown — open them in the OS instead.
const DOWNLOADABLE =
  /\.(pdf|zip|gz|tgz|tar|rar|7z|dmg|exe|msi|pkg|deb|apk|png|jpe?g|gif|webp|bmp|ico|tiff?|mp4|webm|mov|mkv|avi|mp3|wav|flac|ogg|woff2?|ttf|otf|csv|xlsx?|docx?|pptx?|epub)$/i;

export function MarkdownView({
  markdown,
  baseUrl,
  onNavigate,
  onOpenExternal,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll back to top whenever the content changes (new page loaded).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [markdown, baseUrl]);

  const components: Components = {
    a({ href, children, node: _node, ...rest }) {
      return (
        <a
          {...rest}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href) handleLink(e, href, baseUrl, onNavigate, onOpenExternal);
          }}
        >
          {children}
        </a>
      );
    },
    img({ node: _node, ...rest }) {
      return (
        // eslint-disable-next-line jsx-a11y/alt-text
        <img {...rest} loading="lazy" referrerPolicy="no-referrer" />
      );
    },
  };

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <article className="prose prose-slate dark:prose-invert mx-auto max-w-3xl px-6 py-8 prose-pre:bg-[#0d1117] prose-pre:p-0 prose-img:rounded-lg prose-a:break-words">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
          components={components}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}

function handleLink(
  e: { metaKey: boolean; ctrlKey: boolean },
  href: string,
  baseUrl: string,
  onNavigate: (url: string) => void,
  onOpenExternal: (url: string) => void,
) {
  if (href.startsWith("#")) return; // in-page anchor, no target yet
  let resolved: URL;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return;
  }
  const isWeb = resolved.protocol === "http:" || resolved.protocol === "https:";
  // Open externally for: non-web schemes, modifier-click ("open in real browser"),
  // and links to files we can't render (PDFs, archives, media, …).
  if (
    !isWeb ||
    e.metaKey ||
    e.ctrlKey ||
    DOWNLOADABLE.test(resolved.pathname)
  ) {
    onOpenExternal(resolved.toString());
    return;
  }
  onNavigate(resolved.toString());
}
