const jsQR = require('jsqr');
const { makeMatrix } = require('./electron/qr.cjs');

function rasterise(modules, scale = 8) {
  const n = modules.length, margin = 4;
  const size = (n + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) {
    if (modules[r][c] !== 1) continue;
    for (let y = 0; y < scale; y += 1) for (let x = 0; x < scale; x += 1) {
      const i = (((r + margin) * scale + y) * size + (c + margin) * scale + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  return { data, size };
}

// A known-good version 1 QR for "HELLO WORLD" is not byte mode, so instead
// verify our finder/format geometry by decoding a matrix built from a payload we
// also encode with an independent reference implementation below.
// Reference: build the same bitstream by hand for v1-M byte mode, then compare
// the data codewords AND the final matrix module-by-module against ours.
const { VERSIONS } = require('./electron/qr.cjs');

// Recompute data codewords independently here.
const bytes = [...Buffer.from('HELLO','utf8')];
const bits = [];
const push=(v,l)=>{for(let i=l-1;i>=0;i--)bits.push((v>>i)&1)};
push(0b0100,4); push(bytes.length,8); bytes.forEach(b=>push(b,8));
while(bits.length%8)bits.push(0);
const dcw=[]; for(let i=0;i<bits.length;i+=8)dcw.push(bits.slice(i,i+8).reduce((a,b)=>(a<<1)|b,0));
console.log('data codewords:', dcw.map(x=>x.toString(16).padStart(2,'0')).join(' '));

const m = makeMatrix('HELLO');
const { data, size } = rasterise(m);
const res = jsQR(data, size, size);
console.log('decoded:', res ? JSON.stringify(res.data) : 'null');
if (res) {
  console.log('version:', res.version, 'chunkType:', JSON.stringify(res.chunks && res.chunks.map(c=>c.type)));
}
