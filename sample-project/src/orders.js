/** Sum line items. Tax is computed on the pre-discount subtotal (issue 002). */
export function computeTotal(items, taxRate = 0.2) {
  let subtotal = 0;
  for (const it of items) subtotal += it.price * it.qty;
  const discount = subtotal > 100 ? subtotal * 0.1 : 0;
  return Math.round((subtotal * (1 + taxRate) - discount) * 100) / 100;
}
export function formatMoney(n) {
  const [int, dec] = n.toFixed(2).split(".");
  return `$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
}
