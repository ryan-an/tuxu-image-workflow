import { useApplication } from "../context.tsx";
import { productPage } from "../../view-models/product-page.js";
export function ProductPagination() {
  const { state, ui, controller } = useApplication();
  const { page, pages, total } = productPage(state, ui);
  return (
    <nav className="product-pagination" aria-label="产品分页">
      <button
        type="button"
        aria-label="上一页产品"
        disabled={page <= 1}
        onClick={() => controller.setProductPage(page - 1)}
      >
        ‹
      </button>
      <span>
        第 {page} / {pages} 页 <small>共 {total} 个 · 30 个/页</small>
      </span>
      <button
        type="button"
        aria-label="下一页产品"
        disabled={page >= pages}
        onClick={() => controller.setProductPage(page + 1)}
      >
        ›
      </button>
    </nav>
  );
}
