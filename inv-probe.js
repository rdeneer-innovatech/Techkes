// Temporary: proves a fresh order session starts with an empty cart.
const { app, BrowserWindow, session } = require('electron');
const MENU = 'https://www.thuisbezorgd.nl/menu/bufkes-plein-1992';
const PARTITION = 'persist:techkes-order-test';
app.on('window-all-closed', () => {});

const open = () => new Promise(resolve => {
  const win = new BrowserWindow({ width: 1280, height: 900, show: false,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.once('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 5000));
    resolve(win);
  });
  win.loadURL(MENU);
});

// Reuse the runner's own helpers shape: dismiss what blocks, add one item.
const ADD_ONE = `
  (async () => {
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const vis = e => { const s = getComputedStyle(e);
      if (s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0) return false;
      const b = e.getBoundingClientRect(); return b.width>0||b.height>0; };
    const log = [];
    // dismiss cookie wall / promo
    for (let r=0;r<4;r+=1){
      const n=[...document.querySelectorAll('*')].filter(e=>e.children.length===0
        && /^(alles accepteren|accepteren)$/i.test((e.textContent||'').trim()) && vis(e))[0];
      if(!n) break;
      (n.closest('button, a, [role="button"]')||n.parentElement).click();
      log.push('dismissed'); await pause(2000);
    }
    for (let r=0;r<3;r+=1){
      const c=[...document.querySelectorAll('[role="dialog"]')].filter(vis)
        .map(d=>d.querySelector('button[aria-label*="sluiten" i], button[aria-label*="close" i]')).filter(Boolean)[0];
      if(!c) break; c.click(); log.push('promo'); await pause(2000);
    }
    const nameOf = el => { const ids=(el.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean);
      const parts=ids.map(id=>document.getElementById(id)).filter(Boolean)
        .filter(n=>!/price|prijs/i.test(n.id)).map(n=>n.innerText);
      if(!parts.length) parts.push((el.closest('[data-qa="card-element"]')||{}).innerText||'');
      return parts.join(' ').toLowerCase(); };
    let o = null;
    for (let r=0;r<20 && !o;r+=1){
      o = [...document.querySelectorAll('[class*="clickableCardOverlay" i]')].filter(vis)
        .find(e => nameOf(e).includes('broodje werrem sjink'));
      if(!o){ window.scrollTo(0, document.body.scrollHeight*r/20); await pause(600); }
    }
    log.push('overlay=' + !!o);
    if(!o) return { units: -1, log: log.join(',') };
    (o.closest('[data-qa="card-element"], li')||o).scrollIntoView({block:'center'});
    await pause(800); o.click(); await pause(3500);
    log.push('modal=' + !!document.querySelector('[data-qa="item-modal"]'));
    const sub='[data-qa="item-choices-action-submit"]';
    for (let i=0;i<20 && !document.querySelector(sub);i+=1){
      const opt=[...document.querySelectorAll('[data-qa^="item-choices-options-single-element-"]')]
        .filter(vis).find(x=>!x.querySelector('input:checked'));
      if (opt){opt.click();await pause(400);} else await pause(400);
    }
    const b=document.querySelector(sub);
    log.push('submit=' + !!b);
    if(b){b.click();await pause(4500);}
    log.push('cart=' + document.querySelectorAll('[data-qa="cart-item"]').length);
    return { units: document.querySelectorAll('[data-qa="cart-item"]').length, log: log.join(',') };
  })()`;

const CART = `JSON.stringify([...document.querySelectorAll('[data-qa="cart-item"]')].map(l=>({
  n:(l.querySelector('[data-qa="cart-item-name"]')||{}).innerText,
  a:(l.querySelector('[data-qa="cart-item-amount-value"]')||{}).innerText})))`;

app.whenReady().then(async () => {
  const a = await open();
  console.log('PASS 1: ' + JSON.stringify(await a.win.webContents.executeJavaScript(ADD_ONE, true)
    .catch(e => ({ error: e.message }))));
  console.log('PASS 1 cart: ' + await a.win.webContents.executeJavaScript(CART));
  a.destroy();

  await session.fromPartition(PARTITION).clearData();
  console.log('--- cleared partition, reopening ---');
  const b = await open();
  console.log('PASS 2 cart on open: ' + await b.win.webContents.executeJavaScript(CART));
  b.destroy();
  app.exit(0);
});
