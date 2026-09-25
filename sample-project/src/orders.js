/** Sum line items. Known bug (issue 002): discount is applied before tax. */
export function computeTotal(items, taxRate = 0.2) {
  let subtotal = 0;
  for (const it of items) subtotal += it.price * it.qty;
  const discount = subtotal > 100 ? subtotal * 0.1 : 0;
  return Math.round(((subtotal - discount) * (1 + taxRate)) * 100) / 100;
}
export function formatMoney(n) { return `$${n.toFixed(2)}`; }
