const timestamp = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function compareProductsNewestFirst(a, b) {
  return (
    timestamp(b.createdAt) - timestamp(a.createdAt) ||
    timestamp(b.createdOrder) - timestamp(a.createdOrder) ||
    b.id.localeCompare(a.id)
  );
}

/**
 * @template {{ id: string, createdAt?: number, createdOrder?: number }} T
 * @param {T[]} products
 * @returns {T[]}
 */
export function productsNewestFirst(products) {
  return [...products].sort(compareProductsNewestFirst);
}
