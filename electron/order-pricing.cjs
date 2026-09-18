// Prompt: calculate prices like the OrderManager application.
// Reason: assign each newly added item the cart-total difference, excluding
// delivery until the final per-person totals are calculated.
function itemPriceFromCart(cartTotal, deliveryFee, completedItemsTotal) {
  const price = Number(cartTotal) - Number(deliveryFee) - Number(completedItemsTotal);
  return Math.round(price * 100) / 100;
}

function totalsByCustomer(lines, deliveryFee) {
  const customers = new Map();
  for (const line of lines) {
    customers.set(line.customer, (customers.get(line.customer) || 0) + line.price);
  }
  const share = customers.size ? Number(deliveryFee) / customers.size : 0;
  return [...customers].map(([customer, itemTotal]) => ({
    customer,
    itemTotal: Math.round(itemTotal * 100) / 100,
    deliveryShare: Math.round(share * 100) / 100,
    total: Math.round((itemTotal + share) * 100) / 100
  }));
}

module.exports = { itemPriceFromCart, totalsByCustomer };
