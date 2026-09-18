const jsQR = require('jsqr');
const { makeMatrix } = require('./electron/qr.cjs');

// Rasterise the module grid straight to RGBA, with a quiet zone, so jsQR sees
// exactly the modules the encoder produced.
function rasterise(text, scale = 6) {
  const modules = makeMatrix(text);
  const n = modules.length;
  const margin = 4;
  const size = (n + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (modules[r][c] !== 1) continue;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const py = (r + margin) * scale + y;
          const px = (c + margin) * scale + x;
          const i = (py * size + px) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, size };
}

const cases = [
  'HELLO',
  '1',
  'https://example.com/',
  'BCD\n001\n1\nSCT\nINGBNL2A\nTechkes\nNL00BANK0123456789\nEUR7.50\n\n\nLunch\n',
  'BCD\n001\n1\nSCT\nABNANL2A\nInnovatest Europe BV\nNL91ABNA0417164300\nEUR1234.56\n\n\nLunch\n',
  'BCD\n001\n1\nSCT\nRABONL2U\nA name with accented chars: Hawaï\nNL00RABO0123456789\nEUR0.01\n\n\nLunch\n',
  'x'.repeat(300)
];

let pass = 0;
for (const text of cases) {
  const { data, size } = rasterise(text);
  const res = jsQR(data, size, size);
  const ok = res && res.data === text;
  if (ok) pass += 1;
  const label = JSON.stringify(text.length > 40 ? text.slice(0, 40) + '…' : text);
  console.log((ok ? 'PASS' : 'FAIL') + ' len=' + Buffer.byteLength(text) + ' ' + label
    + (ok ? '' : '   got=' + JSON.stringify(res ? res.data.slice(0, 60) : null)));
}
console.log('---');
console.log(pass + '/' + cases.length + ' decoded correctly');
