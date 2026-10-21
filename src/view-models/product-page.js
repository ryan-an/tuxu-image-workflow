export const PRODUCT_PAGE_SIZE = 30;
/** @param {import("../ui/types.ts").Workspace} state
 * @param {import("../ui/types.ts").UIState} ui */
export function productPage(state, ui) {
  const query = ui.search.trim().toLowerCase();
  const filtered = query
    ? state.products.filter((p) =>
        `${p.code} ${p.name}`.toLowerCase().includes(query),
      )
    : state.products;
  const pages = Math.max(1, Math.ceil(filtered.length / PRODUCT_PAGE_SIZE));
  const page = Math.max(1, Math.min(ui.productPage || 1, pages));
  return {
    page,
    pages,
    total: filtered.length,
    products: filtered.slice(
      (page - 1) * PRODUCT_PAGE_SIZE,
      page * PRODUCT_PAGE_SIZE,
    ),
  };
}
