import type { ReactNode } from "react";
import type { ImageTask, ImageVersion, Product } from "../types";
import { ProductThumbnail } from "../products/Sidebar";
import { productPhotos } from "../../../shared/prompt-suite.js";
import { Badge, type BadgeTone } from "../design-system/Badge";

const contextTones: Record<string, BadgeTone> = {
  info: "neutral",
  media: "info",
  prompt: "brand",
  result: "success",
};

const iconPaths = {
  product: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.25l8 4.5" />
    </>
  ),
  info: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8" cy="9" r="1" />
      <path d="m3 17 6-5 4 4 3-3 5 4" />
    </>
  ),
  reference: (
    <>
      <rect x="7" y="7" width="14" height="14" rx="2" />
      <path d="M17 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2m0 0 4-4 3 3 3-3 4 4" />
    </>
  ),
  prompt: (
    <>
      <path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h3" />
    </>
  ),
  result: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
};

function ContextIcon({ name }: { name: keyof typeof iconPaths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}

function ContextTag({
  icon,
  tone,
  available = true,
  title,
  children,
}: {
  icon: keyof typeof iconPaths;
  tone: "info" | "media" | "prompt" | "result";
  available?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <Badge
      className="assistant-context-tag"
      tone={contextTones[tone]}
      unavailable={!available}
      icon={<ContextIcon name={icon} />}
      data-tone={tone}
      data-available={available}
      title={title}
    >
      {children}
    </Badge>
  );
}

export function AssistantContext({
  product,
  task,
  result,
}: {
  product?: Product;
  task?: ImageTask;
  result?: ImageVersion;
}) {
  const photos = product ? productPhotos(product).length : 0;
  const references = task?.references.length || 0;
  const prompts =
    product?.tasks.filter((item) => item.prompt.trim()).length || 0;
  return (
    <section className="assistant-context" aria-label="豆包当前上下文">
      <div className="assistant-context-main">
        <div className="assistant-context-preview">
          {result ? (
            <img
              src={result.source}
              alt={`${task?.role}生成结果 V${result.number}`}
            />
          ) : product ? (
            <ProductThumbnail product={product} size={44} />
          ) : (
            <ContextIcon name="product" />
          )}
          {result && (
            <span className="assistant-preview-version">V{result.number}</span>
          )}
        </div>
        <div className="assistant-context-summary">
          <div className="assistant-context-name">
            <strong title={product?.name}>
              {product?.name || "通用图片咨询"}
            </strong>
          </div>
          <div className="assistant-context-meta">
            {product?.code && (
              <span className="assistant-context-code" title={product.code}>
                {product.code}
              </span>
            )}
            <Badge tone="brand" className="assistant-context-scope">
              {task?.role || (product ? "产品咨询" : "未选择产品")}
            </Badge>
          </div>
        </div>
        {product && (
          <Badge tone="info" className="assistant-context-label">
            当前咨询
          </Badge>
        )}
      </div>
      {product ? (
        <div className="assistant-context-tags" aria-label="随对话附带的资料">
          <ContextTag
            icon="info"
            tone="info"
            title={product.facts || "附带产品名称和编号，尚未填写详细产品资料"}
          >
            产品资料
          </ContextTag>
          <ContextTag
            icon="photo"
            tone="media"
            available={photos > 0}
            title={
              photos
                ? `附带 ${Math.min(photos, 4)} 张产品实拍，共 ${photos} 张`
                : "尚未上传产品实拍图"
            }
          >
            实拍 <b>{Math.min(photos, 4)}</b>
          </ContextTag>
          {task ? (
            <>
              <ContextTag
                icon="reference"
                tone="media"
                available={references > 0}
                title={
                  references
                    ? `附带 ${Math.min(references, 4)} 张当前卡片对标图，共 ${references} 张`
                    : "当前卡片尚未上传对标图"
                }
              >
                对标图 <b>{Math.min(references, 4)}</b>
              </ContextTag>
              <ContextTag
                icon="prompt"
                tone="prompt"
                available={!!task.prompt.trim()}
                title={
                  task.prompt.trim()
                    ? "附带当前卡片的完整提示词"
                    : "当前卡片尚未填写提示词"
                }
              >
                当前提示词
              </ContextTag>
              <ContextTag
                icon="result"
                tone="result"
                available={!!result}
                title={
                  result
                    ? `附带当前卡片结果 V${result.number} 及生成该结果时的提示词`
                    : "当前卡片暂无生成结果"
                }
              >
                {result ? (
                  <>
                    结果 <b>V{result.number}</b>
                  </>
                ) : (
                  "暂无结果"
                )}
              </ContextTag>
            </>
          ) : (
            <ContextTag
              icon="prompt"
              tone="prompt"
              available={prompts > 0}
              title={`附带本产品 ${product.tasks.length} 张卡片的提示词，其中 ${prompts} 张已填写`}
            >
              整套提示词 <b>{prompts}</b>
            </ContextTag>
          )}
        </div>
      ) : (
        <p className="assistant-context-hint">
          从卡片点击「问豆包」，带上图片一起聊
        </p>
      )}
    </section>
  );
}
