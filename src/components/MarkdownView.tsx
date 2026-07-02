import { useEffect, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Element as HastElement, ElementContent } from "hast";
import { FORM_FENCE_LANG, parseFormSpec, type FormSpec } from "../lib/forms";
import { MarkdownForm } from "./MarkdownForm";
import "highlight.js/styles/github-dark.css";

interface Props {
  markdown: string;
  /** Base URL for resolving any still-relative links (defensive). */
  baseUrl: string;
  /**
   * Whether md-form blocks render as live forms. Only true for HTML we
   * converted ourselves — a page served AS markdown could hand-forge a
   * ```md-form block (our private syntax) to POST cross-site with the cookie
   * jar, so those render inert.
   */
  interactiveForms: boolean;
  /** Navigate within the app to an http(s) URL (optionally a POST submission). */
  onNavigate: (url: string, opts?: { post?: string }) => void;
  /** Open a URL in the OS default handler (mailto:, downloads, modifier-click…). */
  onOpenExternal: (url: string) => void;
}

// File extensions we can't render as markdown — open them in the OS instead.
const DOWNLOADABLE =
  /\.(pdf|zip|gz|tgz|tar|rar|7z|dmg|exe|msi|pkg|deb|apk|png|jpe?g|gif|webp|bmp|ico|tiff?|mp4|webm|mov|mkv|avi|mp3|wav|flac|ogg|woff2?|ttf|otf|csv|xlsx?|docx?|pptx?|epub)$/i;

export function MarkdownView({
  markdown,
  baseUrl,
  interactiveForms,
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
    // md-form code blocks are forms preserved from the original page — render
    // them as working forms (GET submits navigate in-app). Anything else stays
    // a normal <pre>.
    pre({ node, children, ...rest }) {
      const spec = interactiveForms ? mdFormSpec(node) : null;
      if (spec) {
        return (
          <MarkdownForm spec={spec} pageUrl={baseUrl} onNavigate={onNavigate} />
        );
      }
      return <pre {...rest}>{children}</pre>;
    },
  };

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <article className="prose prose-slate dark:prose-invert mx-auto max-w-3xl px-6 py-8 prose-pre:bg-[#0d1117] prose-pre:p-0 prose-img:rounded-lg prose-a:break-words">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[
            // plainText keeps md-form blocks un-highlighted so their JSON stays
            // a single text node for mdFormSpec to parse.
            [rehypeHighlight, { detect: true, plainText: [FORM_FENCE_LANG] }],
          ]}
          components={components}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}

/** Extract and parse an md-form spec from a <pre> hast node, if that's what it is. */
function mdFormSpec(node: HastElement | undefined): FormSpec | null {
  if (!node) return null;
  const code = node.children.find(
    (c): c is HastElement => c.type === "element" && c.tagName === "code",
  );
  if (!code) return null;
  const cls = code.properties?.className;
  const classes = Array.isArray(cls) ? cls : typeof cls === "string" ? [cls] : [];
  if (!classes.includes(`language-${FORM_FENCE_LANG}`)) return null;
  return parseFormSpec(hastText(code));
}

function hastText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(hastText).join("");
  return "";
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
