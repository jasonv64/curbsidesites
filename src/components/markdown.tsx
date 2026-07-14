import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders content bodies (D18). Bodies are stored as MDX-compatible markdown;
 * v1 renders the CommonMark+GFM subset (react-markdown is safe by default —
 * no dangerouslySetInnerHTML, raw HTML is ignored). If a post ever needs an
 * embedded component, this is the seam: swap in an MDX compiler here, keep
 * the prose-tenant wrapper.
 */
export function Markdown({ body }: { body: string }) {
  return (
    <div className="prose-tenant">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}
