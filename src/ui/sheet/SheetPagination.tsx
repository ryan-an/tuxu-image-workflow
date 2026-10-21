import { useApplication } from "../context.tsx";
import { productPage } from "../../view-models/product-page.js";

export function SheetPagination() {
  const { state, ui, controller } = useApplication();
  const { page, pages, total } = productPage(state, ui);
  return (
    <nav className="sheet-pagination" aria-label="表格产品分页">
      <button
        type="button"
        aria-label="上一页产品"
        disabled={page <= 1}
        onClick={() => controller.setProductPage(page - 1)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m10 4-4 4 4 4" />
        </svg>
      </button>
      <span className="sheet-pagination-position" aria-live="polite">
        第 <strong>{page}</strong> / {pages} 页
      </span>
      <button
        type="button"
        aria-label="下一页产品"
        disabled={page >= pages}
        onClick={() => controller.setProductPage(page + 1)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 4 4 4-4 4" />
        </svg>
      </button>
      <span className="sheet-pagination-count">共 {total} 个产品</span>
    </nav>
  );
}
