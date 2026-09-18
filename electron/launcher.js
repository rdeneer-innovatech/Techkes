// Prompt: create Scrape/Scan, Order, and Close options.
// Reason: connect the launcher controls and show scan progress and failures.
const byId = id => document.getElementById(id);
const status = byId('status');
// Prompt: keep the scan panel open while a scan runs.
// Reason: a submit resets the form, which re-runs this click handler and would
// toggle the panel shut again while the scan is still reporting progress.
byId('show-scan').onclick = () => {
  if (byId('start').disabled) return;
  const panel = byId('scan-panel');
  panel.hidden = !panel.hidden;
  // Prompt: give the scan form room to fit the whole button.
  // Reason: the compact launcher is too short to show Start scan without scrolling.
  window.techkes.setScanPanelOpen(!panel.hidden);
  if (!panel.hidden) byId('url').focus();
};
byId('order').onclick = async () => {
  try {
    byId('output').textContent = '';
    status.textContent = await window.techkes.order();
  }
  catch (error) { status.textContent = error.message; }
};
byId('close').onclick = () => window.techkes.close();
window.techkes.onLog(text => {
  const output = byId('output');
  output.textContent = (output.textContent + text).slice(-100000);
  output.scrollTop = output.scrollHeight;
});
// Prompt: display combined-order browser progress in the launcher.
// Reason: show which GitHub items were added and which need manual help.
window.techkes.onOrderLog(text => {
  const output = byId('output');
  output.textContent = (output.textContent + text + '\n').slice(-100000);
  output.scrollTop = output.scrollHeight;
});
// Prompt: draw scan phases as progress bars and preview the parsed menu.
// Reason: the scan previously showed nothing but a log line until it finished.
const phases = new Map();

function phaseRow(phase, label) {
  let row = phases.get(phase);
  if (!row) {
    row = document.createElement('div');
    row.className = 'phase';
    const head = document.createElement('div');
    head.className = 'phase-row';
    const name = document.createElement('span');
    const count = document.createElement('span');
    count.className = 'count';
    head.append(name, count);
    const bar = document.createElement('div');
    bar.className = 'phase-bar';
    const fill = document.createElement('div');
    fill.className = 'phase-fill';
    bar.append(fill);
    row.append(head, bar);
    byId('phases').append(row);
    row.parts = { name, count, fill };
    phases.set(phase, row);
  }
  if (label) row.parts.name.textContent = label;
  return row;
}

// Prompt: set bar width through the CSSOM rather than an inline style attribute.
// Reason: the page's CSP allows script-src 'self' but not inline style markup.
function setBar(row, done, total) {
  const pct = total ? Math.min(100, Math.round(done / total * 100)) : 100;
  row.parts.fill.style.width = pct + '%';
  row.parts.count.textContent = total ? `${done}/${total} · ${pct}%` : '';
}

function renderTree(categories) {
  const host = byId('tree');
  host.textContent = '';
  for (const category of categories) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-category';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tree-toggle';
    toggle.textContent = `${category.name} `;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `(${category.itemCount})`;
    toggle.append(count);

    const items = document.createElement('div');
    items.className = 'tree-items';
    items.hidden = true;
    for (const item of category.items) {
      const entry = document.createElement('div');
      entry.className = 'tree-item';
      const name = document.createElement('div');
      name.textContent = item.name;
      entry.append(name);
      if (item.optionGroups.length) {
        const groups = document.createElement('div');
        groups.className = 'tree-groups';
        for (const group of item.optionGroups) {
          const chip = document.createElement('span');
          chip.className = 'tree-group';
          chip.textContent = group;
          groups.append(chip);
        }
        entry.append(groups);
      } else {
        const none = document.createElement('div');
        none.className = 'tree-groups tree-none';
        none.textContent = 'no options';
        entry.append(none);
      }
      items.append(entry);
    }
    toggle.onclick = () => { items.hidden = !items.hidden; };
    wrap.append(toggle, items);
    host.append(wrap);
  }
  byId('tree-panel').hidden = categories.length === 0;
}

window.techkes.onProgress(update => {
  switch (update.event) {
    case 'phase_start': {
      byId('progress').hidden = false;
      const row = phaseRow(update.phase, update.label);
      row.parts.count.textContent = '…';
      break;
    }
    case 'progress':
      setBar(phaseRow(update.phase, update.detail), update.done, update.total);
      break;
    case 'phase_done': {
      const row = phaseRow(update.phase);
      row.classList.add('phase-done');
      setBar(row, 1, 1);
      row.parts.count.textContent = `${update.elapsed}s`;
      break;
    }
    case 'warning':
      byId('output').textContent += `⚠ ${update.message}\n`;
      break;
    case 'error': {
      const row = phaseRow('error', 'Scan failed');
      row.classList.add('phase-error');
      row.parts.count.textContent = update.message;
      break;
    }
    case 'tree':
      renderTree(update.categories || []);
      break;
    case 'summary': {
      const parts = [`${update.categories} categories`, `${update.items} items`,
        `${update.groups} option groups`, `${update.elapsed}s`];
      if (typeof update.images === 'number') parts.push(`${update.images} images`);
      byId('summary').textContent = parts.join(' · ');
      break;
    }
    default:
      break;
  }
});

byId('scan-form').onsubmit = async event => {
  event.preventDefault();
  byId('output').textContent = '';
  // Prompt: clear the previous run before a new scan starts.
  // Reason: stale bars or a stale tree would misreport the new scan's result.
  phases.clear();
  byId('phases').textContent = '';
  byId('tree').textContent = '';
  byId('summary').textContent = '';
  byId('progress').hidden = true;
  byId('tree-panel').hidden = true;
  const controls = ['start', 'order', 'url', 'images'];
  controls.forEach(id => { byId(id).disabled = true; });
  status.textContent = 'Scanning… This can take a few minutes.';
  try {
    status.textContent = await window.techkes.scan({
      url: byId('url').value.trim(), images: byId('images').checked
    });
  } catch (error) { status.textContent = error.message; }
  finally { controls.forEach(id => { byId(id).disabled = false; }); }
};
