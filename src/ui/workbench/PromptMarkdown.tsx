import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];
const components: Components = {
  a: ({ children }) => <span>{children}</span>,
  img: ({ alt }) => <span>{alt}</span>,
  table: ({ children }) => (
    <div className="prompt-markdown-table">
      <table>{children}</table>
    </div>
  ),
};

export const PromptMarkdown = memo(function PromptMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <div className="prompt-markdown">
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
