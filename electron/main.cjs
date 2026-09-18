// Prompt: create an Electron app with Scrape/Scan, Order, Close.
// Reason: run the existing scraper and order page from a desktop launcher.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fetchOpenIssues } = require('./orders.cjs');
const { loadOrderAccount } = require('./order-account.cjs');
const root = path.resolve(__dirname, '..');
// Prompt: create a .icon for this project.
// Reason: use the generated multi-size icon on each Electron application window.
const appIcon = path.join(root, 'assets', 'techkes.ico');
const launcherURL = pathToFileURL(path.join(__dirname, 'launcher.html')).href;
let launcher;
let orderWindow;
let scan;
// Prompt: size the launcher for both the compact row and the open scan form.
// Reason: the scan panel needs enough height that Start scan clears the status bar.
const LAUNCHER_SHORT = 300;
// Prompt: allow room for the progress bars and menu preview.
// Reason: the scan panel now shows phases, a tree and a log together.
const LAUNCHER_TALL = 780;
// Must match EVENT_PREFIX in scrape_thuisbezorgd.py.
const EVENT_PREFIX = '@@TECHKES@@ ';
// Prompt: keep the ordering browser in a session of its own.
// Reason: a separate partition isolates the restaurant's cookies and cart from
// the launcher, and lets the whole thing be wiped before each run.
const ORDER_PARTITION = 'persist:techkes-order';

// Prompt: reopen the last scanned restaurant for the combined GitHub order.
// Reason: store only the menu URL and keep GitHub credentials outside the source tree.
const settingsPath = () => path.join(app.getPath('userData'), 'techkes-settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}
function saveSettings(settings) { fs.writeFileSync(settingsPath(), JSON.stringify(settings), 'utf8'); }

function secureWindow(options) {
  const window = new BrowserWindow({ ...options, icon: appIcon });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  return window;
}

function authorize(event) {
  if (!launcher || event.sender !== launcher.webContents ||
      event.senderFrame.url !== launcherURL) throw new Error('Unknown sender');
}

// Prompt: give every order run an empty cart and a clean browser session.
// Reason: the order window used the app's shared default session, so the cart
// the restaurant stores there survived between runs. A second order then began
// with the previous one's items still in the basket: the operator was shown a
// cart that was not theirs, and each item was priced from a line the earlier run
// had created, which reported one item at the price of several. A dedicated
// partition keeps this automation out of the launcher's session entirely, and
// wiping it before each run means nothing — cart, cookies, storage — is carried
// over. Errors are reported rather than thrown so a storage failure cannot
// leave the operator with no browser and no explanation.
async function freshOrderSession() {
  try {
    const orderSession = session.fromPartition(ORDER_PARTITION);
    // clearData is used rather than clearStorageData because the cart may be
    // keyed to a session cookie as well as to browser storage, and clearData
    // removes the wider set of data types that covers both.
    await orderSession.clearData();
    return orderSession;
  } catch (error) {
    if (launcher) {
      launcher.webContents.send('order-log',
        `Could not clear the previous session, so the cart may still hold earlier items: ${error.message}`);
    }
    return session.fromPartition(ORDER_PARTITION);
  }
}

app.whenReady().then(() => {
  // Prompt: make the Electron front end visible during F5 debugging.
  // Reason: explicitly present the launcher after its local page is available.
  // Prompt: make the window smaller for the three-column action row.
  // Reason: the compact icon controls need less screen space before Scan is opened.
  // Prompt: minimize the launcher window height.
  // Reason: the compact three-button layout fits comfortably in a shorter window.
  // Prompt: make the launcher height smaller.
  // Reason: the primary actions fit in a shorter, compact startup window.
  // Prompt: make the window movable by dragging the background like the original.
  // Reason: remove the native frame so the launcher background can become the drag area.
  launcher = secureWindow({ frame: false, show: false, width: 600, height: LAUNCHER_SHORT, minWidth: 500, minHeight: 280,
    title: 'Techkes', backgroundColor: '#111827',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true } });
  launcher.setMenuBarVisibility(false);
  launcher.once('ready-to-show', () => {
    launcher.center();
    // Prompt: make the front end appear when F5 starts the debugger.
    // Reason: raise the Electron window above VS Code and any stale launcher windows.
    launcher.setAlwaysOnTop(true);
    launcher.show();
    launcher.focus();
    setTimeout(() => launcher && !launcher.isDestroyed() && launcher.setAlwaysOnTop(false), 1000);
  });
  launcher.webContents.on('did-fail-load', (_event, code, description) => {
    console.error(`Launcher page failed to load (${code}): ${description}`);
  });
  launcher.loadFile(path.join(__dirname, 'launcher.html')).catch(error => console.error(error));
  launcher.on('closed', () => app.quit());
});

// Prompt: replace the local order page with a combined GitHub order browser.
// Reason: add every open issue to one cart and leave checkout for human review.
ipcMain.handle('order', async event => {
  authorize(event);
  if (scan) throw new Error('Wait for the scan to finish before ordering.');
  if (orderWindow && !orderWindow.isDestroyed()) { orderWindow.focus(); return; }
  const settings = readSettings();
  if (!settings.menuUrl) throw new Error('Scan a menu first so Techkes knows which restaurant to open.');
  const repository = process.env.GITHUB_REPOSITORY || 'rdeneer-innovatech/Techkes';
  const orders = await fetchOpenIssues(repository, process.env.GITHUB_TOKEN);
  if (!orders.length) throw new Error(`No open orders were found in ${repository}.`);
  // Prompt: read the legacy OrderAccount.txt configuration.
  // Reason: carry the configured payment method and IBAN into the final order report.
  const account = loadOrderAccount(path.join(root, 'OrderAccount.txt'));
  // Prompt: clear the previous order's cart before opening the browser.
  // Reason: the restaurant keeps the basket in browser storage, so without this
  // the new order starts on top of the old one and every price is wrong.
  await freshOrderSession();
  orderWindow = new BrowserWindow({ icon: appIcon, width: 1200, height: 850, title: 'Techkes - Combined order',
    webPreferences: { preload: path.join(__dirname, 'order-preload.cjs'),
      // Prompt: run the order in its own wiped session, never the shared one.
      // Reason: see freshOrderSession — a reused session is what left the previous
      // order's items in the cart at the start of the next run.
      partition: ORDER_PARTITION,
      contextIsolation: true, nodeIntegration: false, sandbox: true } });
  orderWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  orderWindow.webContents.on('will-navigate', (navigation, destination) => {
    if (!new URL(destination).hostname.endsWith('thuisbezorgd.nl')) navigation.preventDefault();
  });
  orderWindow.setMenuBarVisibility(false);
  orderWindow.webContents.once('did-finish-load', async () => {
    // Prompt: use the DeepSeek tool to fix issues for this chat session.
    // Reason: Thuisbezorgd may normalize menu URLs during navigation, so compare
    // stable URL parts before injecting the cart automation.
    const expectedUrl = new URL(settings.menuUrl);
    const loadedUrl = new URL(orderWindow?.webContents.getURL() || 'about:blank');
    if (!orderWindow || orderWindow.isDestroyed() ||
        loadedUrl.origin !== expectedUrl.origin || loadedUrl.pathname !== expectedUrl.pathname) return;
    const runner = fs.readFileSync(path.join(__dirname, 'order-runner.js'), 'utf8');
    try {
      // Prompt: use OrderManager-compatible delivery price calculation.
      // Reason: pass the fixed delivery fee to the cart price-difference logic.
      const deliveryFee = Number(process.env.ORDER_DELIVERY_FEE || 3);
      // Prompt: pass the configured address and remark to the page automation.
      // Reason: the address is required before the restaurant will add any item,
      // and the remark is entered on the cart, so both belong with the account.
      await orderWindow.webContents.executeJavaScript(
        `window.techkesOrderData = ${JSON.stringify({ orders, deliveryFee, account,
          address: account?.address || '', remark: account?.remark || '' })};\n${runner}`, true);
    } catch (error) {
      launcher?.webContents.send('order-log', `Could not start order navigation: ${error.message}`);
    }
  });
  await orderWindow.loadURL(settings.menuUrl);
  return `Loaded ${orders.length} customer orders from ${repository}. The browser is adding them to the cart.`;
});

// Prompt: show every cart automation result in the launcher.
// Reason: report failed selections before the operator reviews payment.
ipcMain.on('order-progress', (event, update) => {
  if (event.sender !== orderWindow?.webContents || !update || typeof update.detail !== 'string') return;
  launcher?.webContents.send('order-log', update.detail);
});

// Prompt: resize the launcher to fit the scan form when it opens.
// Reason: the compact 300px window puts Start scan behind the fixed status bar.
ipcMain.handle('scan-panel', (event, open) => {
  authorize(event);
  if (!launcher || launcher.isDestroyed()) return;
  const [width] = launcher.getSize();
  launcher.setSize(width, open ? LAUNCHER_TALL : LAUNCHER_SHORT, true);
});

ipcMain.handle('scan', async (event, input) => {
  authorize(event);
  if (scan) throw new Error('A scan is already running.');
  if (orderWindow && !orderWindow.isDestroyed()) {
    throw new Error('Close the order window before updating the menu.');
  }
  const url = new URL(input.url);
  if (url.protocol !== 'https:' ||
      !['thuisbezorgd.nl', 'www.thuisbezorgd.nl'].includes(url.hostname) ||
      !url.pathname.startsWith('/menu/') || url.username || url.password) {
    throw new Error('Enter an https://www.thuisbezorgd.nl/menu/... URL.');
  }
  const args = ['-u', path.join(root, 'scrape_thuisbezorgd.py'), url.href, '--out', root];
  if (!input.images) args.push('--no-images');
  return new Promise((resolve, reject) => {
    scan = spawn(process.platform === 'win32' ? 'py' : 'python3', args,
      { cwd: root, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    const child = scan;
    // Prompt: split scraper output into whole lines before routing it.
    // Reason: a single stdout chunk can split a JSON progress event in half (or
    // pack several lines together), so parsing raw chunks would corrupt events.
    const route = (stream, data) => {
      if (!launcher || launcher.isDestroyed()) return;
      stream.buffer += data.toString();
      const lines = stream.buffer.split('\n');
      stream.buffer = lines.pop() ?? '';
      for (const line of lines) {
        const text = line.replace(/\r$/, '');
        if (!text) continue;
        if (text.startsWith(EVENT_PREFIX)) {
          try {
            launcher.webContents.send('scan-progress', JSON.parse(text.slice(EVENT_PREFIX.length)));
            continue;
          } catch {
            // Malformed event: fall through and show it as plain output.
          }
        }
        launcher.webContents.send('scan-log', text + '\n');
      }
    };
    const stdout = { buffer: '' };
    const stderr = { buffer: '' };
    child.stdout.on('data', data => route(stdout, data));
    child.stderr.on('data', data => route(stderr, data));
    // Flush any trailing partial line once the process ends.
    child.once('close', () => {
      for (const [stream, channel] of [[stdout, 'scan-log'], [stderr, 'scan-log']]) {
        if (stream.buffer && launcher && !launcher.isDestroyed()) {
          launcher.webContents.send(channel, stream.buffer + '\n');
          stream.buffer = '';
        }
      }
    });
    child.once('error', error => {
      scan = null;
      reject(new Error(`Could not start Python: ${error.message}`));
    });
    child.once('close', code => {
      scan = null;
      // Prompt: Order should navigate to the same menu that was scanned.
      // Reason: retain the verified menu URL after a successful scrape.
      if (code === 0) {
        saveSettings({ ...readSettings(), menuUrl: url.href });
        resolve('Scan complete. The menu is ready in Order.');
      }
      else reject(new Error(`Scan failed (exit ${code}). See the output above.`));
    });
  });
});

ipcMain.handle('close', event => { authorize(event); app.quit(); });

app.on('before-quit', () => { if (scan) scan.kill(); });
app.on('window-all-closed', () => app.quit());
