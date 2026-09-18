// Prompt: add OrderAccount.txt support from the OrderManager application.
// Reason: load the local IBAN, account-holder name, and payment method used
// for the order summary without committing payment details.
const fs = require('node:fs');

// Prompt: also read the delivery address and the general order remark.
// Reason: Thuisbezorgd refuses to add any item until a delivery location is set,
// so the office address is as required as the IBAN, and both are per-office
// values that belong in this same uncommitted file rather than in the code.
const labelled = (lines, label) => {
  const prefix = label.toLocaleLowerCase() + ':';
  const line = lines.find(entry => entry.toLocaleLowerCase().startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
};

function loadOrderAccount(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (lines.length < 2) throw new Error('OrderAccount.txt needs an IBAN and account-holder name.');
  const iban = lines[0].replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9A-Z]{13,32}$/.test(iban)) throw new Error('OrderAccount.txt contains an invalid IBAN.');
  // Prompt: keep the bare three-line file working.
  // Reason: existing OrderAccount.txt files have no labels, so only lines that
  // carry a "Adres:"/"Opmerking:" prefix are consumed; everything else stays
  // positional and the payment method still defaults to iDEAL.
  return { iban, accountHolder: lines[1], paymentMethod: lines[2] || 'iDEAL',
    address: labelled(lines, 'adres') || labelled(lines, 'address'),
    remark: labelled(lines, 'opmerking') };
}

function sepaQrPayload(account, amount, reference = 'Lunch') {
  return ['BCD', '002', '1', 'SCT', '', account.accountHolder, account.iban,
    `EUR${Number(amount).toFixed(2)}`, '', reference.slice(0, 35)].join('\n');
}

module.exports = { loadOrderAccount, sepaQrPayload };
