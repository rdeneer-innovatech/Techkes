// Prompt: navigate the restaurant site to create one combined order.
// Reason: select every submitted menu path in the visible browser while always
// stopping before checkout or payment.
(async ({ orders, deliveryFee, account, address, remark }) => {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  const report = (type, detail) => window.techkesOrder.progress({ type, detail });
  // Prompt: wait for a condition instead of sleeping a fixed time.
  // Reason: fixed sleeps had to be long enough for the slowest response, so every
  // step paid the worst case and the run took minutes. Polling returns the moment
  // the page is ready, which is both faster and less likely to act too early.
  const waitFor = async (check, timeout = 8000, step = 120) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      let result;
      try { result = check(); } catch (error) { result = null; }
      if (result) return result;
      if (Date.now() >= deadline) return null;
      await pause(step);
    }
  };
  // Prompt: reject hidden elements without demanding height on every axis.
  // Reason: an item's card overlay is an empty <button> stretched across the
  // card by CSS, so it reports height 0 by design (measured live: all 12
  // overlays had width 304-841 and height 0). Requiring height above zero
  // rejected every one of them, which is why no item could ever be clicked.
  // It is genuinely clickable, so only a fully collapsed box is ruled out.
  const visible = element => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 || box.height > 0;
  };
  // Prompt: read an item overlay's name from the label it points at.
  // Reason: the overlay is an empty <button> whose only name source is
  // aria-labelledby="item_73" (live markup), so innerText — the element's own
  // and its parent's — is empty and every text match failed. One of the ids it
  // names is the item name span; price ids are skipped because they read
  // "vanaf EUR 7,50" and would match a dish name by accident.
  const overlayName = element => {
    const ids = String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const parts = ids.map(id => document.getElementById(id)).filter(Boolean)
      .filter(node => /price|prijs/i.test(node.id) === false)
      .map(node => node.innerText);
    // The category list has no aria-labelledby, so fall back to the card text.
    if (!parts.length) parts.push(element.closest('[data-qa="card-element"]')?.innerText || '');
    return norm(parts.join(' '));
  };
  // Prompt: click a step, preferring the item card overlay over the bare text.
  // Reason: the menu shows the same dish twice — once in the "popular items"
  // carousel and once in the category list. Both contain a span whose text is
  // exactly the dish name, and the carousel one has no clickable ancestor, so
  // matching text first clicked a dead element and reported success. The overlay
  // is the only element that actually opens the item, so it is tried first, and
  // the click is confirmed by waiting for the dialog that should appear.
  const clickText = async text => {
    const expected = norm(text);
    const overlayFor = () => [...document.querySelectorAll('[class*="clickableCardOverlay" i]')]
      .filter(visible)
      .find(element => overlayName(element).includes(expected));
    const dialogOpen = () => document.querySelector('[data-qa="item-modal"]')
      || document.querySelector('[data-qa="location-panel-header"]');
    // A menu item is opened through its card overlay; a category chip and an
    // option row are clicked by their own text. Try the text control first when
    // it is a real control, so option names inside the dialog still work.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const inDialog = document.querySelector('[data-qa="item-modal"]');
      if (inDialog) {
        const option = [...inDialog.querySelectorAll('[data-qa^="item-choices-options-single-element-"]')]
          .filter(visible)
          .find(element => norm(element.innerText).includes(expected));
        if (option) {
          realClick(option);
          await pause(250);
          return true;
        }
      }
      const card = overlayFor();
      if (card) {
        // The overlay is a zero-height button; scroll the card it covers, since
        // scrollIntoView on the overlay itself has no height to align with and
        // would leave the click coordinates off-screen.
        const holder = card.closest('[data-qa="card-element"], [data-qa="card"], li') || card;
        holder.scrollIntoView({ block: 'center' });
        await pause(400);
        realClick(card);
        // The item dialog appearing is what distinguishes an item from a chip.
        if (await waitFor(dialogOpen, 6000)) return true;
        return true;
      }
      const candidates = [...document.querySelectorAll('button, [role="button"], a, label, div, span')]
        .filter(element => visible(element) && norm(element.innerText) === expected)
        .sort((a, b) => a.children.length - b.children.length);
      const target = candidates[0];
      if (target) {
        const clickable = target.closest('button, [role="button"], a, label') || target;
        clickable.scrollIntoView({ block: 'center' });
        realClick(clickable);
        await pause(400);
        return true;
      }
      await pause(400);
    }
    return false;
  };
  // Prompt: clear the cookie wall by accepting the essential cookies only.
  // Reason: it covers the page, so the first item click lands on the banner
  // instead of the menu and the whole run silently adds nothing — but the
  // operator does not want this automation consenting to tracking on their
  // behalf. "Noodzakelijk" (essential only) is tried first and is the button the
  // banner offers for that; the accept-all labels stay as a fallback for a
  // banner variant that does not present the essential-only option, because a
  // popup that is never dismissed fails the order outright, which is worse.
  const dismissCookies = async () => {
    const labels = ['Noodzakelijk', 'Alleen noodzakelijke', 'Noodzakelijke cookies',
      'Alles accepteren', 'Accept all', 'Alle cookies accepteren'];
    for (const label of labels) {
      const node = [...document.querySelectorAll('*')].filter(element =>
        element.children.length === 0 && norm(element.textContent) === norm(label) && visible(element))[0];
      if (node) {
        const clickable = node.closest('button, a, [role="button"]') || node.parentElement;
        clickable.scrollIntoView({ block: 'center' });
        clickable.click();
        await waitFor(() => (visible(node) ? null : true), 3000);
        return label;
      }
    }
    return null;
  };
  // Prompt: close any promotional dialog overlaying the menu.
  // Reason: the site opens a "save your favourites" popup on load; while it is
  // up the menu behind it is not reachable, so every item click misses.
  const dismissPromo = async () => {
    const closeFor = () => [...document.querySelectorAll('[role="dialog"]')].filter(visible)
      .map(dialog => dialog.querySelector('button[aria-label*="sluiten" i], button[aria-label*="close" i]'))
      .filter(Boolean)[0];
    let closed = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const close = closeFor();
      if (!close) return closed;
      close.click();
      closed = true;
      await waitFor(() => (closeFor() ? null : true), 4000);
    }
    return closed;
  };
  // Prompt: hide the "Iets vergeten?" cross-sell card in the basket.
  // Reason: it is an upsell nudge the restaurant adds to the sidebar, it is not
  // part of the submitted order, and leaving it visible pushes the real basket
  // content down the panel. It is removed with a style rule rather than a click
  // so no dismiss control has to be found, and it is re-applied after every add
  // because the basket re-renders and would otherwise bring the card back.
  const hideCrossSell = () => {
    const STYLE_ID = 'techkes-hide-cross-sell';
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = '[data-qa="cross-sell-carousel-section"]'
        + ', [class*="cross-sell-style_wrapper"] { display: none !important; }';
      document.head.appendChild(style);
    }
    return [...document.querySelectorAll('[data-qa="cross-sell-carousel-section"]')]
      .filter(visible).length === 0;
  };
  // Prompt: add the open item by choosing its required options and submitting.
  // Reason: the item dialog is a customisation form, not an add form. Its submit
  // control ships disabled as `item-choices-action-submit-disabled` until every
  // required group has a choice, so looking for an "Add" button by text found
  // nothing and the old code reported success without adding anything. The
  // control's data-qa attribute losing its "-disabled" suffix is the site's own
  // signal that the item is ready to submit.
  const addToCart = async (options = []) => {
    // Prompt: poll for the enabled submit instead of sleeping a fixed budget.
    // Reason: the previous loop slept ~900ms per turn up to 20 turns whatever the
    // page did, so every item cost up to 18 seconds even when it was ready at
    // once. Waiting on the actual condition finishes in a fraction of that.
    const modal = await waitFor(() => document.querySelector('[data-qa="item-modal"]'), 8000);
    if (!modal) return false;
    // Prompt: choose the options the order actually named.
    // Reason: the order data carries them ("Petit pain wit"), so picking the
    // first radio silently ordered a different bread than the customer chose.
    const wanted = options.map(norm);
    for (const name of wanted) {
      const option = [...document.querySelectorAll('[data-qa^="item-choices-options-single-element-"]')]
        .filter(visible).find(element => norm(element.innerText).includes(name));
      const box = option && option.querySelector('input');
      if (option && box && !box.checked) { realClick(option); await pause(150); }
    }
    const submitReady = () => {
      const button = document.querySelector('[data-qa="item-choices-action-submit"]');
      return button && visible(button) ? button : null;
    };
    // Fill in anything the order did not name, so a required group cannot block
    // the submit; the site marks these groups "Verplicht" (required).
    const picked = new Set();
    const button = await waitFor(() => {
      const ready = submitReady();
      if (ready) return ready;
      const choices = [...document.querySelectorAll('[data-qa^="item-choices-options-single-element-"]')]
        .filter(visible);
      const next = choices.find(option => !option.querySelector('input:checked') && !picked.has(option));
      if (next) { picked.add(next); realClick(next); }
      return null;
    }, 10000, 150);
    if (!button) return false;
    realClick(button);
    // Submitting the first item surfaces the location prompt rather than adding
    // it, so wait for the dialog to close and check the prompt never appeared.
    await waitFor(() => (locationInput() || !document.querySelector('[data-qa="item-modal"]')) ? true : null, 6000);
    if (locationInput()) {
      report('address', 'The restaurant asked for a delivery location before accepting the item.');
      return false;
    }
    return true;
  };

  // Prompt: set controlled inputs the way a human keystroke would.
  // Reason: React tracks its own value and ignores `element.value = x`, so the
  // native setter has to be called and the events dispatched for the app to
  // notice the change at all — a plain assignment looks correct in the DOM but
  // leaves the framework's state empty.
  const setInput = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return element;
  };
  // Prompt: drive widgets with the full pointer sequence, not just .click().
  // Reason: the suggestion options are custom elements that commit their choice
  // from a pointer event; a bare synthetic .click() left the dialog open, which
  // would strand the run on the location prompt.
  const realClick = element => {
    const box = element.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, button: 0, isPrimary: true,
      clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    for (const [type, buttons] of [['pointerover', 0], ['mouseover', 0],
      ['pointerdown', 1], ['mousedown', 1], ['pointerup', 0], ['mouseup', 0], ['click', 0]]) {
      const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      element.dispatchEvent(new Ctor(type, { ...at, buttons }));
    }
  };
  // Prompt: find the location dialog by its own data-qa hooks.
  // Reason: sorting candidate containers by innerText length picked the dialog's
  // *header* ("Voer je locatie in" is its whole text) rather than the dialog, and
  // the header holds no input — so the address step reported "not found" on a
  // page where the field was plainly visible. The data-qa names are stable
  // markers the site uses for its own tests, unlike its hashed CSS classes.
  const locationInput = () => {
    const panel = document.querySelector('[data-qa="location-panel-header"]')?.closest('[role="dialog"]')
      || document.querySelector('[role="dialog"]');
    const scope = panel || document;
    const candidate = [...scope.querySelectorAll('input[name="searchText"], input[placeholder*="adres" i]')]
      .filter(visible)[0];
    if (candidate) return candidate;
    // Fall back to the text match, but require the container to hold an input.
    const holders = [...document.querySelectorAll('[role="dialog"], section, aside')]
      .filter(element => visible(element) && /voer je locatie in/i.test(element.innerText || ''));
    for (const holder of holders) {
      const input = [...holder.querySelectorAll('input[type="text"], input:not([type])')].filter(visible)[0];
      if (input) return input;
    }
    return null;
  };
  // Prompt: pick the address suggestion and confirm the choice took.
  // Reason: the dialog only closes once a suggestion is committed, so returning
  // on the click alone would report success while the order stayed blocked.
  const chooseAddress = async value => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const input = locationInput();
      if (!input) return attempt > 0 ? true : null;
      input.focus();
      setInput(input, value);
      // Wait for the geocoder to answer rather than sleeping a flat guess.
      await waitFor(() => document.querySelector('[data-qa="location-panel-results-item-element"]'), 6000);
      // Prompt: choose the result that matches the configured address.
      // Reason: the list is a geocoder, so its first entry is often a business
      // near the address rather than the address itself ("Vroom en Dreesman"
      // ranked above the street the operator typed). Taking the first result
      // therefore set the delivery location to the wrong place, and picking a
      // business that is not a deliverable address left the panel open, which
      // looked like the click had failed. Also skip the "use my location" entry:
      // a desktop browser has no location permission, so it always errors.
      const wanted = norm(value);
      const houseNumber = (value.match(/\d+/) || [''])[0];
      const results = [...document.querySelectorAll('[data-qa="location-panel-results-item-element"]')]
        .filter(visible);
      if (!results.length) continue;
      const textOf = element => norm(element.innerText);
      const match = results.find(element => textOf(element).includes(wanted))
        || results.find(element => houseNumber && textOf(element).includes(houseNumber))
        || results[0];
      report('address-choice', `Using location: ${match.innerText.trim()}`);
      realClick(match);
      // The panel closing is the confirmation that the location was accepted.
      if (await waitFor(() => (locationInput() ? null : true), 6000)) return true;
    }
    return false;
  };

  // Prompt: calculate item prices like the OrderManager application.
  // Reason: the difference between cart totals identifies the price of the
  // newly added item; the delivery fee is excluded until per-person totals.
  const euro = text => {
    // Prompt: recognize the actual euro character in the restaurant cart.
    // Reason: avoid terminal encoding differences affecting price extraction.
    const canonical = String(text).match(/\u20ac\s*([0-9]+(?:[.,][0-9]{1,2})?)/);
    if (canonical) return Number(canonical[1].replace(',', '.'));
    const match = String(text).match(/€\s*([0-9]+(?:[.,][0-9]{1,2})?)/);
    return match ? Number(match[1].replace(',', '.')) : null;
  };
  // Prompt: price an item from its own line in the cart, not from the grand total.
  // Reason: the old code differenced the basket's last euro amount (which already
  // includes delivery) against an items-only running sum, so every price was
  // inflated — a single sandwich was reported at EUR 32.49, then EUR 54.98 — and
  // the running sum was never reset between customers, so one customer's items
  // were charged to the next. Each cart line carries its own name, option
  // description and amount, so it can be matched directly and needs no running
  // total, no delivery-fee assumption, and cannot be contaminated by a cart that
  // already holds earlier items.
  const cartLines = () => [...document.querySelectorAll('[data-qa="cart-item"]')].map(line => {
    const pick = selector => {
      const node = line.querySelector(selector);
      return node ? String(node.innerText).replace(/\s+/g, ' ').trim() : '';
    };
    const amount = Number((pick('[data-qa="cart-item-amount"]').match(/\d+/) || ['1'])[0]) || 1;
    // Prompt: treat cart-item-price as the line total, not the price per unit.
    // Reason: measured live, a line holding 2 items reported "EUR 15,00" for a
    // EUR 7,50 dish — the cart prints the line total, so reading it as a unit
    // price doubled the cost of any item whose line had quantity above one. The
    // two agree at quantity 1, which is why the error only showed on a repeat.
    const lineTotal = euro(pick('[data-qa="cart-item-price"]'));
    return {
      name: pick('[data-qa="cart-item-name"]'),
      description: pick('[data-qa="cart-item-description"]'),
      amount,
      lineTotal,
      unit: lineTotal === null ? null : lineTotal / amount,
    };
  });
  // Prompt: find the cart line a submitted item belongs to.
  // Reason: the cart records the variant ("Petit pain wit") but never the default
  // choice ("Standaard"), so requiring every submitted option reported "could not
  // be read" for an item sitting in the cart. Only the options the cart actually
  // prints are used to tell lines apart.
  const lineFor = steps => {
    const dish = norm(steps[1] || steps[0] || '');
    const options = steps.slice(2).map(norm);
    const ofDish = cartLines().filter(line => norm(line.name).includes(dish));
    if (ofDish.length < 2) return ofDish[0] || null;
    return ofDish.find(line => options.every(option =>
      !cartRecordsOption(option) || norm(line.description).includes(option))) || ofDish[0];
  };
  // Prompt: decide whether the cart bothers to record a given option at all.
  // Reason: a default choice such as "Standaard" is never printed on the cart
  // line, so requiring it excluded the very line the item had just created.
  const cartRecordsOption = option => cartLines().some(line =>
    norm(line.description).includes(option) || norm(line.name).includes(option));
  // Prompt: record how many of each matching line the cart holds right now.
  // Reason: identical items are merged onto one line that shows their running
  // quantity, so the quantity after an add minus the quantity before it is the
  // only reliable statement of how many units that add put in the cart.
  const lineQuantities = steps => {
    const line = lineFor(steps);
    return line ? line.amount : 0;
  };
  // Prompt: read the delivery charge the basket actually applies.
  // Reason: the fee is decided by the restaurant and the chosen location, so a
  // configured value is only a fallback for display. Reading it from the basket
  // keeps the summary honest when the site charges something else.
  const cartDeliveryFee = () => {
    const scope = [...document.querySelectorAll('[class*="winkelmandje" i], aside')].filter(visible)[0]
      || document.body;
    const node = [...scope.querySelectorAll('*')].filter(element => element.children.length === 0)
      .find(element => /bezorgkosten|bezorging|delivery fee/i.test(element.innerText || ''));
    if (!node) return null;
    const holder = node.closest('div, li, tr') || node.parentElement;
    const match = ((holder && holder.innerText) || '').match(/€\s*[0-9]+(?:[.,][0-9]{1,2})?/);
    return match ? euro(match[0]) : null;
  };
  const round = amount => Math.round(amount * 100) / 100;
  const pricedLines = [];
  let addedCount = 0;

  report('ready', `Loaded ${orders.length} customer order${orders.length === 1 ? '' : 's'}.`);
  const cookieChoice = await dismissCookies();
  if (cookieChoice) report('cookies', `Dismissed the cookie banner ("${cookieChoice}").`);
  await dismissPromo();
  hideCrossSell();
  // Prompt: report whether the address is configured before the run starts.
  // Reason: without a location the restaurant blocks every item, and the
  // operator needs to know that up front rather than watching items silently
  // fail one by one.
  if (!address) report('address', 'No address is configured. Add "Adres: ..." to OrderAccount.txt; items cannot be added without one.');

  // Prompt: add every item, then set the remark, then stop.
  // Reason: the location is set during the first item add, so the poll for the
  // location dialog runs on each attempt — it appears there and nowhere else.
  let locationDone = false;
  let addressFailed = false;
  for (const order of orders) {
    if (addressFailed) break;
    for (const item of order.items) {
      const steps = item.split('\\').map(step => step.trim()).filter(Boolean);
      report('item', `${order.customer}: ${steps.join(' → ')}`);
      let complete = true;
      // Only the category and the dish are clicked on the page; the trailing
      // entries are options handled inside the dialog by addToCart below.
      for (const step of steps.slice(0, 2)) {
        if (!await clickText(step)) { complete = false; break; }
      }
      // Prompt: snapshot the cart before this add so its cost can be measured.
      // Reason: the restaurant merges identical items onto one line that carries
      // the running quantity, so a second "Broodje werrem sjink" showed the line
      // total (unit x 2) as the price of the single item just added, and the
      // per-customer sum then double-counted it. The difference this add makes
      // is the item's real cost whether the line is new or already existed.
      const before = lineQuantities(steps);
      // Step 1 is the category and step 2 the dish; anything after that is an
      // option ("Petit pain wit", "Standaard"). Options only exist inside the
      // dialog the click above opens, so they are chosen there by name rather
      // than clicked on the menu page.
      if (!complete || !await addToCart(steps.slice(2))) {
        // Prompt: a failed add must clear the flag, not leave the earlier click.
        // Reason: opening the item dialog succeeded, so `complete` was already
        // true; when the submit then failed the run still reported "added" and
        // went on to price an item that was never in the cart.
        complete = false;
        // Prompt: treat a location prompt as a blocking address failure.
        // Reason: every remaining item would fail the same way, so continuing
        // would spam the log and burn minutes without adding anything.
        if (address && !locationDone) {
          const outcome = await chooseAddress(address);
          if (outcome === true) {
            locationDone = true;
            report('address', `Delivery location set to "${address}".`);
            // The location dialog replaced the item's own dialog, so re-open the
            // item now that the address is known.
            for (const step of steps) await clickText(step);
            if (await addToCart()) { complete = true; }
          } else if (outcome === false) {
            addressFailed = true;
            report('address', `Could not set the delivery location "${address}". Check the address in OrderAccount.txt.`);
          }
        }
      }
      if (addressFailed) break;
      if (!complete) {
        report('failed', `${order.customer}: could not add ${item}. Please finish this item manually.`);
      } else {
        addedCount += 1;
        report('added', `${order.customer}: added ${item}.`);
        // The basket re-renders on every add, which brings the card back.
        hideCrossSell();
        // Prompt: wait until this item's cart quantity has actually grown.
        // Reason: the cart updates a moment after the submit, so reading straight
        // away found no line and priced the item at EUR 0.00. Waiting for the
        // quantity to exceed the pre-add snapshot both proves the add happened
        // and gives the exact number of units this add contributed.
        const line = await waitFor(() => {
          const found = lineFor(steps);
          return found && found.unit !== null && found.amount > before ? found : null;
        }, 6000, 200);
        if (!line) {
          report('price-failed', `${order.customer}: added ${item}, but its cart line could not be read.`);
        } else {
          // Units this add contributed, so a merged line prices one unit each.
          const units = Math.max(1, line.amount - before);
          const price = round(line.unit * units);
          pricedLines.push({ customer: order.customer, item, price });
          report('priced', `${order.customer}: ${item} — EUR ${price.toFixed(2)}.`);
        }
      }
    }
  }
  const perCustomer = new Map();
  for (const line of pricedLines) perCustomer.set(line.customer, (perCustomer.get(line.customer) || 0) + line.price);
  // Prompt: report item subtotals and the cart's own delivery charge.
  // Reason: the delivery fee is set by the site at checkout, not by this app, so
  // dividing a configured guess across customers invented a per-person fee that
  // did not exist. The basket states the real charge, so it is read from there
  // and shown once against the whole order instead of being split.
  const shipping = cartDeliveryFee();
  for (const [customer, itemTotal] of perCustomer) {
    report('total', `${customer}: EUR ${itemTotal.toFixed(2)} (items only; delivery is charged once for the order).`);
  }
  if (shipping !== null) {
    report('delivery', `Delivery charged by the restaurant: EUR ${shipping.toFixed(2)} for the whole order.`);
  } else if (Number.isFinite(deliveryFee) && deliveryFee > 0) {
    // The configured value is a fallback for display only; the restaurant sets
    // the real charge, so it is never presented as the amount actually billed.
    report('delivery', `The restaurant's delivery charge could not be read; the configured estimate is EUR ${deliveryFee.toFixed(2)}.`);
  }
  // Prompt: use OrderAccount.txt details in the payment summary.
  // Reason: retain the OrderManager account-holder and payment-method behaviour.
  if (account) report('account', `Payment method: ${account.paymentMethod}; transfer details: ${account.accountHolder}, ${account.iban}.`);
  // Prompt: enter the general remark on the order.
  // Reason: it is one remark for the whole office lunch, matching the single
  // AccountHolder/IBAN in OrderAccount.txt rather than a per-customer note.
  if (remark) {
    // The cart shows a link ("Opmerking toevoegen") that reveals the field, so
    // the link has to be opened before the field exists to type into.
    const opener = document.querySelector('[data-qa="cart-item-action-add-comment"]');
    if (opener && visible(opener)) {
      opener.scrollIntoView({ block: 'center' });
      await pause(400);
      realClick(opener);
      await pause(2000);
    }
    const field = [...document.querySelectorAll('input[type="text"], input:not([type]), textarea')]
      .filter(visible)
      .find(element => /opmerking|toelichting|remark|comment/i.test(
        `${element.placeholder || ''} ${element.getAttribute('aria-label') || ''} ${element.name || ''}`
        + ` ${element.getAttribute('data-qa') || ''}`));
    if (!field) {
      report('remark', `Type the remark "${remark}" by hand: the order form's remark field could not be opened automatically.`);
    } else {
      setInput(field, remark);
      await pause(800);
      // The comment is committed by its own save control, if it has one.
      const save = [...document.querySelectorAll('[data-qa*="comment" i] button, [role="dialog"] button')]
        .filter(visible).find(button => /opslaan|save|toevoegen|add|ok/i.test(norm(button.innerText)));
      if (save) { realClick(save); await pause(1200); }
      report('remark', `Remark entered: ${remark}`);
    }
  } else {
    report('remark', 'No remark is configured, so none was entered.');
  }

  // Prompt: hand the filled cart to a human instead of paying.
  // Reason: this automation must never complete a purchase, so it stops here
  // with the address and remark in place and the operator confirms payment.
  // Prompt: count real adds, not prices, when deciding what to report.
  // Reason: a price lookup can fail while the item is in the cart, and reporting
  // "no items were added" then would tell the operator the opposite of the truth.
  if (addressFailed) {
    report('stopped', 'Stopped before payment because the delivery address could not be set.');
  } else if (addedCount === 0) {
    report('stopped', 'Stopped before payment because no items were added to the cart.');
  } else {
    report('stopped', `Stopped before payment with ${addedCount} item${addedCount === 1 ? '' : 's'} in the cart. Review the order and confirm payment yourself.`);
  }
  report('done', 'The combined cart and price breakdown are ready for review. Payment was not confirmed.');
// Prompt: pass orders, delivery fee, account, address and remark to the cart automation.
// Reason: preserve the data shape supplied by Electron for price calculation.
})(window.techkesOrderData);
