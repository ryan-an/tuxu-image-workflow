import { useEffect, useRef, useState } from "react";
import { productPage } from "../../view-models/product-page.js";
import { ProductPagination } from "./ProductPagination.tsx";
import type { Product } from "../types";
import { ActionButton, useApplication } from "../context.tsx";
import { productQueueInfo } from "../../view-models/queue-view.js";
import { ProductStatusBadge } from "../ProductStatusBadge.tsx";
import { thumbnailSource } from "../../view-models/product-thumbnail.js";
import { WorkspaceSwitcher } from "../workspaces/WorkspaceSwitcher";
import type { WorkspaceDirectoryModel } from "../../application/use-workspaces";
import { PreviewImage } from "../PreviewImage";
import { Badge } from "../design-system/Badge";
import "./sidebar.css";
import { EmptyCollectionIcon } from "../WorkspaceEmpty";
import { Button } from "../design-system/Button";

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ProductCode({ code }: { code: string }) {
  const characters = Array.from(code);
  const suffix = characters.length > 18 ? characters.slice(-6).join("") : "";
  return (
    <span
      className="product-code"
      title={code}
      aria-label={`产品编号：${code}`}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="m6 2-2 12M12 2l-2 12M2 6h12M1 10h12" />
      </svg>
      <span className="product-code-prefix">
        {suffix ? characters.slice(0, -6).join("") : code}
      </span>
      {suffix && <span className="product-code-suffix">{suffix}</span>}
    </span>
  );
}

export function ProductThumbnail({
  product,
  size = 42,
}: {
  product: Product;
  size?: number;
}) {
  const source = thumbnailSource(product);
  return source ? (
    <PreviewImage
      src={source}
      alt={`${product.name}实拍缩略图`}
      width={size}
      height={size}
      decoding="async"
    />
  ) : (
    <span className="thumbnail-placeholder" aria-label="暂无实拍缩略图">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m4 17 5-5 4 4 3-3 5 5" />
      </svg>
    </span>
  );
}
function ProductListItem({
  product,
  active,
}: {
  product: Product;
  active: boolean;
}) {
  const { state } = useApplication();
  const info = productQueueInfo(state, product);
  return (
    <div className={`product-item ${active ? "active" : ""}`}>
      <ActionButton
        className="product-link"
        aria-current={active ? "true" : undefined}
        aria-label={`打开产品：${product.name}，编号：${product.code}`}
        action="open-product"
        data={{ id: product.id }}
      >
        <span className="product-thumbnail" data-thumbnail-for={product.id}>
          <ProductThumbnail product={product} />
        </span>
        <span className="product-list-info">
          <strong className="product-name" title={product.name}>
            {product.name}
          </strong>
          <ProductCode code={product.code} />
        </span>
        <span className="product-completion">
          <ProductStatusBadge label={info.label} tone={info.tone} />
          <small
            title={`已勾选 ${info.picked} / ${product.tasks.length} 个图片位置`}
          >
            <span>已选 </span>
            {info.picked}
            <span> / {product.tasks.length}</span>
          </small>
        </span>
        <span className="product-progress" aria-hidden="true">
          <i
            style={{
              width: `${product.tasks.length ? (info.picked / product.tasks.length) * 100 : 0}%`,
            }}
          />
        </span>
      </ActionButton>
    </div>
  );
}
export function Sidebar({
  workspaces,
  onCreateWorkspace,
}: {
  workspaces: WorkspaceDirectoryModel;
  onCreateWorkspace(): void;
}) {
  const { state, ui, controller, isRemote, user } = useApplication();
  const { products, page } = productPage(state, ui);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const rowHeight = 98;
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [page, ui.search]);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const end = Math.min(
    products.length,
    Math.ceil((scrollTop + height) / rowHeight) + 2,
  );
  return (
    <aside className="sidebar" aria-label="产品导航">
      <div className="brand">
        <span>图</span>
        <div>
          <strong>图序</strong>
          <small>批量生图工作台</small>
        </div>
      </div>
      {import.meta.env.MODE !== "demo" && (
        <WorkspaceSwitcher
          user={user}
          model={workspaces}
          flush={() => controller.flush()}
          onManage={() =>
            void controller.dispatch("view", { view: "workspaces" })
          }
          onCreate={onCreateWorkspace}
        />
      )}
      <div className="mobile-product-picker">
        <label htmlFor="mobile-product">产品 · {state.products.length}</label>
        <select
          id="mobile-product"
          value={state.activeProductId || state.products[0]?.id || ""}
          onChange={(event) =>
            void controller.dispatch("open-product", { id: event.target.value })
          }
        >
          {!state.products.length && <option value="">暂无产品</option>}
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.code} · {product.name}
            </option>
          ))}
        </select>
        <ActionButton
          className="icon-button"
          action="new-product"
          aria-label="添加产品"
          title="添加产品"
        >
          <PlusIcon />
        </ActionButton>
      </div>
      <div className="mobile-product-pagination">
        <ProductPagination />
      </div>
      <div id="sidebar-content">
        <div className="side-heading">
          <span>产品集合</span>
          <Badge tone="neutral">{state.products.length}</Badge>
          <ActionButton
            className="icon-button"
            variant="ghost"
            size="sm"
            action="new-product"
            aria-label="添加产品"
            title="添加产品"
          >
            <PlusIcon />
          </ActionButton>
        </div>
        <div className="side-search">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4.5 4.5" strokeLinecap="round" />
          </svg>
          <input
            id="product-search"
            className="search"
            placeholder="搜索编号或产品名称"
            aria-label="搜索产品"
            value={ui.search}
            onChange={(e) => controller.setSearch(e.target.value)}
          />
        </div>
        <div
          className="product-list virtual-product-list"
          ref={listRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div
            style={{
              height: products.length * rowHeight,
              position: "relative",
            }}
          >
            {products.slice(start, end).map((p, index) => (
              <div
                key={p.id}
                style={{
                  position: "absolute",
                  top: (start + index) * rowHeight,
                  left: 0,
                  right: 0,
                  height: rowHeight,
                }}
              >
                <ProductListItem
                  key={p.id}
                  product={p}
                  active={p.id === state.activeProductId}
                />
              </div>
            ))}
          </div>
          {!products.length && (
            <div className="sidebar-empty">
              <span className="sidebar-empty-icon">
                <EmptyCollectionIcon />
              </span>
              <span>{ui.search.trim() ? "没有匹配的产品" : "还没有产品"}</span>
              <small>
                {ui.search.trim()
                  ? "试试其他编号或名称"
                  : user.role === "viewer"
                    ? "成员添加产品后，将在这里展示"
                    : "为你的创作建立第一个产品档案"}
              </small>
              {ui.search.trim() ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => controller.setSearch("")}
                >
                  清除搜索
                </Button>
              ) : (
                <ActionButton action="new-product" variant="ghost" size="sm">
                  ＋ 添加产品
                </ActionButton>
              )}
            </div>
          )}
        </div>
        <ProductPagination />
        <div className="side-bottom">
          <span className="local-dot" aria-hidden="true" />{" "}
          {isRemote ? "服务端工作区" : "本机工作区"} <small>自动保存</small>
        </div>
      </div>
    </aside>
  );
}
