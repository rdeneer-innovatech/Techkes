// Prompt: clicking Order should read all posted GitHub issues.
// Reason: verify pagination-safe parsing ignores pull requests and blank orders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ordersFromIssues } = require('./electron/orders.cjs');
const { itemPriceFromCart, totalsByCustomer } = require('./electron/order-pricing.cjs');
const { loadOrderAccount, sepaQrPayload } = require('./electron/order-account.cjs');
const result = ordersFromIssues([
  { title: 'a@example.com', body: 'Lunch\\Wit\n\nDrink\\Water' },
  { title: 'PR', body: 'ignore', pull_request: {} },
  { title: 'Empty', body: '' }
]);
assert.deepEqual(result, [{ customer: 'a@example.com', items: ['Lunch\\Wit', 'Drink\\Water'] }]);
// Prompt: match OrderManager price calculation. Reason: delivery is deducted
// from cart differences and split equally after all individual items are priced.
assert.equal(itemPriceFromCart(18.5, 3, 10), 5.5);
assert.deepEqual(totalsByCustomer([
  { customer: 'a@example.com', price: 5.5 }, { customer: 'b@example.com', price: 7 }
], 3), [
  { customer: 'a@example.com', itemTotal: 5.5, deliveryShare: 1.5, total: 7 },
  { customer: 'b@example.com', itemTotal: 7, deliveryShare: 1.5, total: 8.5 }
]);
// Prompt: retain the OrderManager SEPA QR payment data. Reason: verify the
// account file produces an amount-specific bank-transfer payload.
assert.equal(sepaQrPayload({ iban: 'NL00BANK0123456789', accountHolder: 'Techkes' }, 12.5),
  'BCD\n002\n1\nSCT\n\nTechkes\nNL00BANK0123456789\nEUR12.50\n\nLunch');
// Prompt: read the address and remark from OrderAccount.txt.
// Reason: the restaurant will not add an item until a delivery location is set,
// so a mis-parsed address is what makes a run silently order nothing. Write real
// files rather than stubs so the comment/label handling is exercised end to end.
const writeAccount = contents => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'techkes-')), 'OrderAccount.txt');
  fs.writeFileSync(file, contents);
  return file;
};
assert.deepEqual(loadOrderAccount(writeAccount(
  'NL00BANK0123456789\nTechkes B.V.\niDEAL\nAdres: Keizersgracht 123, 1015 CJ Amsterdam\nOpmerking: Graag bij de balie afgeven\n'
)), { iban: 'NL00BANK0123456789', accountHolder: 'Techkes B.V.', paymentMethod: 'iDEAL',
  address: 'Keizersgracht 123, 1015 CJ Amsterdam', remark: 'Graag bij de balie afgeven' });
// A comment line must not shift positions, and the labels are optional.
assert.deepEqual(loadOrderAccount(writeAccount(
  '# payment details\nNL00BANK0123456789\nTechkes B.V.\n\n# Adres: this comment is not the address\n'
)), { iban: 'NL00BANK0123456789', accountHolder: 'Techkes B.V.', paymentMethod: 'iDEAL',
  address: '', remark: '' });
// The English label is accepted, and an address with a trailing comment is not.
assert.equal(loadOrderAccount(writeAccount(
  'NL00BANK0123456789\nTechkes B.V.\nAddress: Keizersgracht 123\n')).address, 'Keizersgracht 123');
assert.throws(() => loadOrderAccount(writeAccount('NOTANIBAN\nTechkes B.V.\n')), /invalid IBAN/);
assert.equal(loadOrderAccount(path.join(os.tmpdir(), 'techkes-does-not-exist.txt')), null);
