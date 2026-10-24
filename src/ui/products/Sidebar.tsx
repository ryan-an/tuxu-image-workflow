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

export function ProductThumbnail({
  product,
  size = 42,
}: {
  product: Product;
  size?: number;
}) {
  const source = thumbnailSource(product);
  return source ? (
    <img
      src={source}
      alt={`${product.name}实拍缩略图`}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <span className="thumbnail-placeholder" aria-label="暂无实拍缩略图">
      ◇
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
        action="open-product"
        data={{ id: product.id }}
      >
        <span className="product-thumbnail" data-thumbnail-for={product.id}>
          <ProductThumbnail product={product} />
        </span>
        <span className="product-list-info">
          <span className="product-code">{product.code}</span>
          <strong title={product.name}>{product.name}</strong>
          <span className="product-completion">
            <ProductStatusBadge label={info.label} tone={info.tone} />
            <small
              title={`已勾选 ${info.picked} / ${product.tasks.length} 个图片位置`}
            >
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
    <aside className="sidebar">
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
        >
          ＋
        </ActionButton>
      </div>
      <div className="mobile-product-pagination">
        <ProductPagination />
      </div>
      <div id="sidebar-content">
        <div className="side-heading">
          <span>产品集合</span>
          <span>{state.products.length}</span>
          <ActionButton
            className="icon-button"
            action="new-product"
            aria-label="添加产品"
          >
            ＋
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
          {!products.length && <div className="empty-small">没有匹配产品</div>}
        </div>
        <ProductPagination />
        <div className="side-bottom">
          <span className="local-dot" />{" "}
          {isRemote ? "服务端工作区" : "本机工作区"} <small>自动保存</small>
        </div>
      </div>
    </aside>
  );
}
