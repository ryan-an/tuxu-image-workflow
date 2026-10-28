import {
  memo,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { presentationAssetUrl } from "../../services/session-scope.js";

const plugins = [remarkGfm];
function AssistantCodeBlock({
  node: _node,
  children,
  ...props
}: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
  const code = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    setStatus("idle");
  }, [children]);
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  return (
    <div className="assistant-code-block">
      <div className="assistant-code-toolbar">
        <span>代码 / 提示词</span>
        <button
          type="button"
          className="assistant-code-copy"
          aria-live="polite"
          title={
            status === "failed"
              ? "复制失败，请选中代码块文字手动复制"
              : "只复制此代码块的内容"
          }
          onClick={async () => {
            try {
              const text = code.current?.textContent;
              if (text === undefined || text === null) return;
              await navigator.clipboard.writeText(text);
              setStatus("copied");
            } catch {
              setStatus("failed");
            }
          }}
        >
          {status === "copied"
            ? "已复制"
            : status === "failed"
              ? "复制失败"
              : "复制代码"}
        </button>
      </div>
      <pre {...props} ref={code}>
        {children}
      </pre>
    </div>
  );
}
const components: Components = {
  pre: AssistantCodeBlock,
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      href={presentationAssetUrl(props.href)}
      target="_blank"
      rel="noopener noreferrer"
    />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="assistant-table-scroll">
      <table {...props} />
    </div>
  ),
  img: ({ node: _node, ...props }) => (
    <img
      {...props}
      src={presentationAssetUrl(props.src)}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ),
};
export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <div className="assistant-markdown">
      <ReactMarkdown remarkPlugins={plugins} skipHtml components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
