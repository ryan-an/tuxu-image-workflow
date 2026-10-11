import type { Product } from "../types";
import { ActionButton, useApplication } from "../context.tsx";
import { productStats } from "../selectors";
import { thumbnailSource } from "../../product-thumbnail.js";

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
  const stats = productStats(product);
  return (
    <div className={`product-item ${active ? "active" : ""}`}>
      <ActionButton
        className="product-link"
        action="open-product"
        data={{ id: product.id }}
      >
        <span className="product-thumbnail" data-thumbnail-for={product.id}>
          <ProductThumbnail product={product} />
        </span>
        <span className="product-list-info">
          <span className="product-code">{product.code}</span>
          <strong title={product.name}>{product.name}</strong>
          <span className="product-progress">
            <i
              style={{ width: `${(stats.done / product.tasks.length) * 100}%` }}
            />
          </span>
          <small>
            {stats.done} / {product.tasks.length} 已选结果
          </small>
        </span>
      </ActionButton>
    </div>
  );
}
export function Sidebar() {
  const { state, ui, controller, isRemote } = useApplication();
  const products = state.products.filter((p) =>
    `${p.code} ${p.name}`.toLowerCase().includes(ui.search.toLowerCase()),
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
        <input
          id="product-search"
          className="search"
          placeholder="搜索编号或产品名称"
          value={ui.search}
          onChange={(e) => controller.setSearch(e.target.value)}
        />
        <div className="side-browse-hint">点击产品打开工作台</div>
        <div className="product-list">
          {products.map((p) => (
            <ProductListItem
              key={p.id}
              product={p}
              active={p.id === state.activeProductId}
            />
          ))}
          {!products.length && <div className="empty-small">没有匹配产品</div>}
        </div>
        <div className="side-bottom">
          <span className="local-dot" />{" "}
          {isRemote ? "服务端工作区" : "本机工作区"} <small>自动保存</small>
        </div>
      </div>
    </aside>
  );
}
