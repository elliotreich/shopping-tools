'use strict';

/* ---------- constants ---------- */

const LS_KEY = 'shelf-scout-v1';
const STORE_KINDS = ['local', 'online', 'mixed'];
const MEMBERSHIP_NAMES = ['Prime', 'Walmart+', 'Custom'];

const UNIT_LIB = {
  weight: {
    base: 'oz',
    label: '/oz',
    units: { oz: 1, lb: 16, g: 0.035274, kg: 35.274 }
  },
  volume: {
    base: 'fl oz',
    label: '/fl oz',
    units: { 'fl oz': 1, ml: 0.033814, L: 33.814, cup: 8, pint: 16, qt: 32, gal: 128 }
  },
  count: {
    base: 'unit',
    label: '/unit',
    units: { unit: 1, each: 1, can: 1, jar: 1, bottle: 1, roll: 1, sheet: 1, pod: 1, bar: 1, bag: 1, box: 1, pack: 1, case: 1, serving: 1 }
  }
};

const DEAL_TYPES = [
  { id: 'none', label: 'No deal' },
  { id: 'pct', label: '% off' },
  { id: 'fixed', label: '$ off' },
  { id: 'bogo', label: 'BOGO' },
  { id: 'multi', label: 'N for $' }
];

const FULFILL_LABELS = { instore: 'In store', delivery: 'Delivery', shipping: 'Shipping' };

/* ---------- helpers ---------- */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '-';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUnitPrice(n) {
  if (n == null || isNaN(n)) return '-';
  const digits = n >= 1 ? 2 : (n >= 0.1 ? 2 : 3);
  return '$' + n.toFixed(digits);
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return '';
  return (Math.round(n * 100) / 100).toString();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- seed data ---------- */

function seedState() {
  const stores = [
    { id: 's1', name: 'Walgreens', kind: 'local', deliveryFee: 7.99, freeThreshold: 35, taxRate: 0, membership: '', memberFreeDelivery: false, loyaltyPct: 0 },
    { id: 's2', name: 'CVS', kind: 'local', deliveryFee: 7.99, freeThreshold: 35, taxRate: 0, membership: 'Custom', memberFreeDelivery: false, loyaltyPct: 0 },
    { id: 's3', name: 'Key Food', kind: 'local', deliveryFee: 9.99, freeThreshold: 35, taxRate: 0, membership: '', memberFreeDelivery: false, loyaltyPct: 0 },
    { id: 's4', name: 'Whole Foods', kind: 'mixed', deliveryFee: 9.95, freeThreshold: 35, taxRate: 0, membership: 'Prime', memberFreeDelivery: true, loyaltyPct: 0 },
    { id: 's5', name: 'Target', kind: 'mixed', deliveryFee: 5.99, freeThreshold: 35, taxRate: 8.875, membership: '', memberFreeDelivery: false, loyaltyPct: 0 },
    { id: 's6', name: 'Walmart', kind: 'mixed', deliveryFee: 6.99, freeThreshold: 35, taxRate: 8.875, membership: 'Walmart+', memberFreeDelivery: true, loyaltyPct: 0 },
    { id: 's7', name: 'Amazon', kind: 'online', deliveryFee: 6.99, freeThreshold: 35, taxRate: 8.875, membership: 'Prime', memberFreeDelivery: true, loyaltyPct: 0 },
    { id: 's8', name: 'Costco', kind: 'local', deliveryFee: 0, freeThreshold: 0, taxRate: 8.875, membership: 'Custom', memberFreeDelivery: false, loyaltyPct: 0 },
    { id: 's9', name: "Trader Joe's", kind: 'local', deliveryFee: 0, freeThreshold: 0, taxRate: 0, membership: '', memberFreeDelivery: false, loyaltyPct: 0 }
  ];
  const offers = [
    { id: 'o1', item: 'Fruity Pebbles', storeId: 's1', price: 6.49, size: 18.9, unitType: 'weight', unit: 'oz', fulfillment: 'instore', deal: { type: 'multi', value: 2, extra: 10 }, taxOverride: 0, note: 'In-store 2 for $10' },
    { id: 'o2', item: 'Fruity Pebbles', storeId: 's2', price: 6.79, size: 18.9, unitType: 'weight', unit: 'oz', fulfillment: 'delivery', deal: { type: 'pct', value: 20, extra: null }, taxOverride: 0, note: '20% off with ExtraCare' },
    { id: 'o3', item: 'Fruity Pebbles', storeId: 's3', price: 6.29, size: 18.9, unitType: 'weight', unit: 'oz', fulfillment: 'instore', deal: { type: 'none' }, taxOverride: 0, note: '' },
    { id: 'o4', item: 'Fruity Pebbles', storeId: 's7', price: 6.19, size: 18.9, unitType: 'weight', unit: 'oz', fulfillment: 'shipping', deal: { type: 'none' }, taxOverride: 0, note: '' },
    { id: 'o5', item: 'Fruity Pebbles', storeId: 's4', price: 6.49, size: 18.9, unitType: 'weight', unit: 'oz', fulfillment: 'delivery', deal: { type: 'none' }, taxOverride: 0, note: '' },
    { id: 'o6', item: 'Fruity Pebbles', storeId: 's5', price: 5.49, size: 18.9, unitType: 'weight', unit: 'oz', fulfillment: 'shipping', deal: { type: 'pct', value: 5, extra: null }, taxOverride: 0, note: 'Target Circle 5%' },
    { id: 'o7', item: 'Duracell AA (4 pack)', storeId: 's2', price: 9.99, size: 4, unitType: 'count', unit: 'each', fulfillment: 'instore', deal: { type: 'multi', value: 2, extra: 15 }, taxOverride: 8.875, note: '' },
    { id: 'o8', item: 'Duracell AA (4 pack)', storeId: 's7', price: 8.79, size: 4, unitType: 'count', unit: 'each', fulfillment: 'shipping', deal: { type: 'none' }, taxOverride: 8.875, note: '' },
    { id: 'o9', item: 'Duracell AA (4 pack)', storeId: 's5', price: 9.29, size: 4, unitType: 'count', unit: 'each', fulfillment: 'shipping', deal: { type: 'pct', value: 5, extra: null }, taxOverride: 8.875, note: '' }
  ];
  return {
    settings: {
      area: 'Brooklyn, NY',
      includeTax: true,
      myMemberships: { Prime: true, 'Walmart+': false, Custom: false },
      prefillUrl: '',
      sampleNoticeSeen: false
    },
    stores,
    offers
  };
}

/* ---------- state ---------- */

let state = null;
const ui = { selectedItem: 'all', editingId: null, editingStoreId: null, formTouched: false };

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.offers) && Array.isArray(parsed.stores) && parsed.settings) {
        state = parsed;
        return;
      }
    }
  } catch (e) {
    console.warn('Failed to load saved state', e);
  }
  state = seedState();
}

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state', e);
  }
}

/* ---------- math ---------- */

function storeById(id) {
  return state.stores.find((s) => s.id === id);
}

function membershipActive(name) {
  return !!name && !!state.settings.myMemberships[name];
}

function effectivePrefillUrl() {
  const saved = (state.settings.prefillUrl || '').trim();
  if (saved) return saved.replace(/\/+$/, '');
  if (location.protocol.startsWith('http') && location.host) return location.origin;
  return 'http://127.0.0.1:8091';
}

function matchStore(candidateStore) {
  if (!candidateStore) return null;
  const want = candidateStore.toLowerCase();
  for (const s of state.stores) {
    if (s.name.toLowerCase() === want) return s.id;
  }
  const firstToken = want.split(/\s+/)[0];
  for (const s of state.stores) {
    if (s.name.toLowerCase().split(/\s+/)[0] === firstToken) return s.id;
  }
  return null;
}

function cleanTitle(title, store) {
  let t = String(title || '').trim();
  if (store) {
    const storeRe = store.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp('\\s*[|\\-\\u2013\\u2014\\u00b7]\\s*' + storeRe + '$', 'i'), '');
  }
  t = t.replace(/\s*[|\u00b7]\s*[^|]*$/, '').trim();
  t = t.replace(/\s+\d+(?:\.\d+)?\s*(fl ?oz|oz|lbs?|grams?|kg|ml|L|gal|qt|pt|ct|count|each|packs?|rolls?)\b\s*$/i, '').trim();
  t = t.replace(/\s+\d+\s+for\s+\$\d+(?:\.\d{1,2})?\s*$/i, '').trim();
  t = t.replace(/\s+\$\d+(?:\.\d{1,2})?\s*$/, '').trim();
  return t || String(title || '').trim();
}

function baseHost(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

function unitFactor(unitType, unit) {
  const lib = UNIT_LIB[unitType];
  if (!lib || !lib.units[unit]) return 1;
  return lib.units[unit];
}

function baseUnits(o) {
  return (Number(o.size) || 0) * unitFactor(o.unitType, o.unit);
}

function baseLabel(o) {
  return (UNIT_LIB[o.unitType] || UNIT_LIB.count).label;
}

function dealPrice(o) {
  const store = storeById(o.storeId);
  let price = Number(o.price) || 0;
  if (store && membershipActive(store.membership) && (store.loyaltyPct || 0) > 0) {
    price *= 1 - (store.loyaltyPct || 0) / 100;
  }
  const d = o.deal || { type: 'none' };
  if (d.type === 'fixed') {
    price = Math.max(0, price - (Number(d.value) || 0));
  } else if (d.type === 'pct') {
    price *= Math.max(0, 1 - (Number(d.value) || 0) / 100);
  } else if (d.type === 'bogo') {
    const n = Number(d.value) || 1;
    const m = Number(d.extra) || 0;
    price *= n / (n + m);
  } else if (d.type === 'multi') {
    const n = Number(d.value) || 1;
    price = (Number(d.extra) || 0) / n;
  }
  return price;
}

function dealLabel(o) {
  const d = o.deal || { type: 'none' };
  if (d.type === 'pct') return d.value + '% off';
  if (d.type === 'fixed') return fmtMoney(d.value) + ' off';
  if (d.type === 'bogo') return 'Buy ' + (d.value || 1) + ' get ' + (d.extra || 0);
  if (d.type === 'multi') return (d.value || 1) + ' for ' + fmtMoney(d.extra);
  return '';
}

function groupKey(o) {
  return o.storeId + '|' + o.fulfillment;
}

function groupFee(g) {
  const store = storeById(g.storeId);
  if (!store || g.fulfillment === 'instore') return 0;
  if (membershipActive(store.membership) && store.memberFreeDelivery) return 0;
  if ((store.freeThreshold || 0) > 0 && g.subtotal >= store.freeThreshold) return 0;
  return store.deliveryFee || 0;
}

function buildGroups() {
  const groups = {};
  for (const o of state.offers) {
    const key = groupKey(o);
    if (!groups[key]) {
      groups[key] = { storeId: o.storeId, fulfillment: o.fulfillment, subtotal: 0, count: 0 };
    }
    groups[key].subtotal += dealPrice(o);
    groups[key].count += 1;
  }
  for (const g of Object.values(groups)) {
    g.fee = groupFee(g);
  }
  return groups;
}

function computeOffer(o, groups) {
  const store = storeById(o.storeId);
  const g = groups[groupKey(o)];
  const units = baseUnits(o);
  const dp = dealPrice(o);
  const fee = g ? g.fee : 0;
  const feeShare = fee;
  const taxPct = (o.taxOverride !== null && o.taxOverride !== undefined && o.taxOverride !== '')
    ? Number(o.taxOverride) || 0
    : ((store && store.taxRate) || 0);
  const tax = state.settings.includeTax ? (dp + feeShare) * (taxPct / 100) : 0;
  const total = dp + feeShare + tax;
  return {
    offer: o,
    store,
    group: g,
    units,
    dealPrice: dp,
    fee,
    feeShare,
    tax,
    total,
    rawUnit: units > 0 ? dp / units : null,
    allInUnit: units > 0 ? total / units : null
  };
}

/* ---------- render: header ---------- */

function renderMemberships() {
  const wrap = $('headerMemberships');
  wrap.innerHTML = MEMBERSHIP_NAMES.map((name) =>
    '<label class="member-chip' + (state.settings.myMemberships[name] ? ' on' : '') + '">' +
    '<input type="checkbox" data-member="' + esc(name) + '"' + (state.settings.myMemberships[name] ? ' checked' : '') + '>' +
    esc(name) + '</label>'
  ).join('');
  wrap.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', () => {
      state.settings.myMemberships[input.dataset.member] = input.checked;
      saveState();
      render();
    });
  });
}

/* ---------- render: comparison ---------- */

function itemNames() {
  const seen = [];
  for (const o of state.offers) {
    if (!seen.includes(o.item)) seen.push(o.item);
  }
  return seen;
}

function renderItemBar() {
  const names = itemNames();
  const bar = $('itemBar');
  const pill = (label, count, active, isAll) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item-pill' + (active ? ' on' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.innerHTML = esc(label) + ' <span class="count">' + count + '</span>';
    btn.addEventListener('click', () => {
      ui.selectedItem = isAll ? 'all' : label;
      render();
    });
    return btn;
  };
  bar.appendChild(pill('All', names.length, ui.selectedItem === 'all', true));
  for (const name of names) {
    const count = state.offers.filter((o) => o.item === name).length;
    bar.appendChild(pill(name, count, ui.selectedItem === name, false));
  }
}

function feeChips(comp) {
  const store = comp.store;
  const g = comp.group;
  if (!store || !g) return [{ t: 'No store data', cls: 'amber' }];
  if (g.fulfillment === 'instore') return [{ t: 'In store, no fee', cls: 'green' }];
  const member = membershipActive(store.membership) && store.memberFreeDelivery;
  if (member) return [{ t: store.membership + ' free delivery', cls: 'blue' }];
  if ((store.freeThreshold || 0) > 0 && g.subtotal >= store.freeThreshold) {
    return [{ t: 'Free over ' + fmtMoney(store.freeThreshold), cls: 'green' }];
  }
  if (comp.fee > 0) {
    return [{ t: fmtMoney(comp.feeShare) + ' ' + g.fulfillment + (g.count > 1 ? ' (once per order)' : ''), cls: 'amber' }];
  }
  return [];
}

function renderRows() {
  const groups = buildGroups();
  const comps = state.offers.map((o) => computeOffer(o, groups));
  const filtered = comps.filter((c) => ui.selectedItem === 'all' || c.offer.item === ui.selectedItem);
  const valid = filtered.filter((c) => c.allInUnit != null);
  const sorted = valid.slice().sort((a, b) => a.allInUnit - b.allInUnit || a.rawUnit - b.rawUnit);
  const best = sorted.length ? sorted[0].allInUnit : null;
  const none = filtered.filter((c) => c.allInUnit == null);
  const rows = [...sorted, ...none];

  const wrap = $('offerRows');
  wrap.innerHTML = '';

  rows.forEach((comp, i) => {
    const o = comp.offer;
    const rank = i + 1;
    const isBest = i === 0 && best != null;
    const barPct = comp.allInUnit != null && best != null ? Math.max(4, Math.round((best / comp.allInUnit) * 100)) : 0;
    const delta = comp.allInUnit != null && best != null ? comp.allInUnit - best : null;
    const dl = dealLabel(o);
    const chips = feeChips(comp);
    const sizeText = fmtNum(o.size) + ' ' + o.unit;
    const hasFees = Math.abs(comp.total - comp.dealPrice) > 0.005;

    const row = document.createElement('div');
    row.className = 'row' + (isBest ? ' best' : '');

    row.innerHTML =
      '<div class="c-rank">' + rank + (isBest ? '<span class="best-tag">Best</span>' : '') + '</div>' +
      '<div class="c-store">' +
        '<div class="store-line">' +
          '<span class="name">' + esc(comp.store ? comp.store.name : 'Unknown store') + '</span>' +
          '<span class="badge ' + esc(o.fulfillment) + '">' + esc(FULFILL_LABELS[o.fulfillment] || o.fulfillment) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="c-size">' + esc(sizeText) + '</div>' +
      '<div class="c-deal">' + (dl ? '<span class="chip deal">' + esc(dl) + '</span>' : '<span class="chip muted">none</span>') + '</div>' +
      '<div class="c-unit">' + fmtUnitPrice(comp.rawUnit) + '<span class="u">' + esc(baseLabel(o)) + '</span></div>' +
      '<div class="c-allin">' +
        '<span>' + fmtUnitPrice(comp.allInUnit) + '<span class="u">' + esc(baseLabel(o)) + '</span></span>' +
        (delta != null ? '<span class="delta">' + (isBest ? 'cheapest' : '+' + fmtUnitPrice(delta) + ' vs best') + '</span>' : '<span class="delta">missing data</span>') +
        (comp.allInUnit != null ? '<span class="bar" style="width:' + barPct + '%"></span>' : '') +
      '</div>' +
      '<div class="c-actions">' +
        '<button class="icon-btn" type="button" title="Edit offer" data-edit="' + esc(o.id) + '">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5L17 3z"/></svg></button>' +
        '<button class="icon-btn danger" type="button" title="Delete offer" data-del="' + esc(o.id) + '">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg></button>' +
      '</div>' +
      '<div class="strip">' +
        '<span class="chip muted strip-size">' + esc(sizeText) + '</span>' +
        (dl ? '<span class="chip deal strip-deal">' + esc(dl) + '</span>' : '') +
        '<span class="chip muted strip-unit">' + fmtUnitPrice(comp.rawUnit) + esc(baseLabel(o)) + '</span>' +
        chips.map((c) => '<span class="chip ' + esc(c.cls) + '">' + esc(c.t) + '</span>').join('') +
        (comp.tax > 0.005 ? '<span class="chip muted">tax ' + fmtMoney(comp.tax) + '</span>' : '') +
        (hasFees ? '<span class="total">' + fmtMoney(comp.total) + ' all-in</span>' : '<span class="total">' + fmtMoney(comp.total) + '</span>') +
        (o.note ? '<span class="note">' + esc(o.note) + '</span>' : '') +
      '</div>';

    wrap.appendChild(row);
  });

  wrap.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => startEdit(btn.dataset.edit));
  });
  wrap.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => deleteOffer(btn.dataset.del));
  });

  $('emptyState').hidden = state.offers.length > 0;
}

/* ---------- render: offer form ---------- */

function renderUnitOptions(unitType) {
  const select = $('fUnit');
  select.innerHTML = Object.keys(UNIT_LIB[unitType].units).map((u) => '<option value="' + esc(u) + '">' + esc(u) + '</option>').join('');
}

function renderForm() {
  const editing = ui.editingId ? state.offers.find((o) => o.id === ui.editingId) : null;
  $('formTitle').textContent = editing ? 'Edit offer' : 'Add an offer';
  $('btnCancelEdit').hidden = !editing;
  $('btnAddOffer').textContent = editing ? 'Save changes' : 'Add offer';

  const storeSelect = $('fStore');
  storeSelect.innerHTML = state.stores.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('');

  const itemList = $('itemList');
  itemList.innerHTML = itemNames().map((n) => '<option value="' + esc(n) + '"></option>').join('');

  const unitTypeSelect = $('fUnitType');
  unitTypeSelect.innerHTML = Object.keys(UNIT_LIB).map((t) => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('');

  const dealSelect = $('fDeal');
  dealSelect.innerHTML = DEAL_TYPES.map((d) => '<option value="' + d.id + '">' + esc(d.label) + '</option>').join('');

  if (editing) {
    $('fItem').value = editing.item;
    $('fStore').value = editing.storeId;
    $('fPrice').value = editing.price;
    $('fSize').value = editing.size;
    $('fUnitType').value = editing.unitType;
    renderUnitOptions(editing.unitType);
    $('fUnit').value = editing.unit;
    $('fDeal').value = editing.deal.type;
    $('fDealVal').value = editing.deal.value ?? '';
    $('fDealExtra').value = editing.deal.extra ?? '';
    $('fTax').value = editing.taxOverride === null || editing.taxOverride === undefined ? '' : editing.taxOverride;
    $('fNote').value = editing.note || '';
    setFulfill(editing.fulfillment);
    $('fPaste').value = '';
    $('pasteHint').textContent = '';
  } else {
    if (!ui.formTouched && document.activeElement !== $('fItem') && !$('fItem').value) {
      $('fItem').value = ui.selectedItem !== 'all' ? ui.selectedItem : '';
    }
    if (!ui.formTouched && document.activeElement !== $('fStore') && !$('fStore').value && state.stores[0]) {
      $('fStore').value = state.stores[0].id;
    }
    $('fPaste').value = '';
    $('pasteHint').textContent = '';
  }
  updateDealFields();
}

function setFulfill(value) {
  document.querySelectorAll('#fFulfill button').forEach((b) => {
    const on = b.dataset.fulfill === value;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.classList.toggle('on', on);
  });
}

function updateDealFields() {
  const type = $('fDeal').value;
  const wrap = $('dealFields');
  const extraWrap = $('wrapDealExtra');
  const valLabel = $('lblDealVal');
  const extraLabel = $('lblDealExtra');
  wrap.hidden = type === 'none';
  extraWrap.hidden = !(type === 'bogo' || type === 'multi');
  if (type === 'pct') valLabel.textContent = 'Percent off';
  if (type === 'fixed') valLabel.textContent = 'Dollars off';
  if (type === 'bogo') { valLabel.textContent = 'Buy'; extraLabel.textContent = 'Get free'; }
  if (type === 'multi') { valLabel.textContent = 'Quantity'; extraLabel.textContent = 'For $'; }
}

/* ---------- render: stores ---------- */

function renderStores() {
  const list = $('storeList');
  list.innerHTML = '';
  for (const s of state.stores) {
    const row = document.createElement('div');
    row.className = 'store-row';
    const editing = ui.editingStoreId === s.id;
    const meta = [];
    if (s.deliveryFee > 0) meta.push('Delivery ' + fmtMoney(s.deliveryFee));
    if (s.freeThreshold > 0) meta.push('Free over ' + fmtMoney(s.freeThreshold));
    meta.push('Tax ' + (s.taxRate ? s.taxRate + '%' : '0%'));
    if (s.membership) meta.push(s.membership + (s.memberFreeDelivery ? ' waives fee' : ''));
    if (s.loyaltyPct > 0) meta.push(s.loyaltyPct + '% card off');

    row.innerHTML =
      '<div class="store-main">' +
        '<div class="store-name"><span class="name">' + esc(s.name) + '</span><span class="badge kind">' + esc(s.kind) + '</span></div>' +
        '<div class="store-actions">' +
          '<button class="icon-btn" type="button" title="Edit store" data-editstore="' + esc(s.id) + '">' +
            '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5L17 3z"/></svg></button>' +
          '<button class="icon-btn danger" type="button" title="Delete store" data-delstore="' + esc(s.id) + '">' +
            '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg></button>' +
        '</div>' +
      '</div>' +
      (meta.length ? '<div class="store-meta">' + esc(meta.join(' | ')) + '</div>' : '');

    if (editing) {
      const edit = document.createElement('div');
      edit.className = 'store-edit';
      edit.innerHTML =
        '<div class="field"><label>Name</label><input data-se="name" value="' + esc(s.name) + '"></div>' +
        '<div class="field"><label>Kind</label><select data-se="kind">' +
          STORE_KINDS.map((k) => '<option value="' + k + '"' + (s.kind === k ? ' selected' : '') + '>' + k + '</option>').join('') +
        '</select></div>' +
        '<div class="field"><label>Delivery fee $</label><input data-se="deliveryFee" type="number" min="0" step="0.01" value="' + (s.deliveryFee || 0) + '"></div>' +
        '<div class="field"><label>Free over $</label><input data-se="freeThreshold" type="number" min="0" step="0.01" value="' + (s.freeThreshold || 0) + '"></div>' +
        '<div class="field"><label>Tax %</label><input data-se="taxRate" type="number" min="0" step="0.1" value="' + (s.taxRate || 0) + '"></div>' +
        '<div class="field"><label>Membership</label><select data-se="membership">' +
          '<option value="">None</option>' +
          MEMBERSHIP_NAMES.map((m) => '<option value="' + m + '"' + (s.membership === m ? ' selected' : '') + '>' + m + '</option>').join('') +
        '</select></div>' +
        '<div class="field"><label>Card discount %</label><input data-se="loyaltyPct" type="number" min="0" step="0.1" value="' + (s.loyaltyPct || 0) + '"></div>' +
        '<div class="field span2"><label class="check"><input data-se="memberFreeDelivery" type="checkbox"' + (s.memberFreeDelivery ? ' checked' : '') + '> Waives delivery fee</label></div>' +
        '<div class="edit-actions span2">' +
          '<button type="button" class="btn small" data-save-store="' + esc(s.id) + '">Save store</button>' +
          '<button type="button" class="btn small" data-cancel-store>Cancel</button>' +
        '</div>';
      row.appendChild(edit);
      edit.querySelectorAll('[data-se]').forEach((el) => {
        el.addEventListener('change', () => {
          const name = el.dataset.se;
          if (name === 'name' || name === 'membership' || name === 'kind') s[name] = el.value;
          else if (name === 'memberFreeDelivery') s[name] = el.checked;
          else s[name] = el.value === '' ? 0 : Number(el.value);
        });
      });
    }
    list.appendChild(row);
  }

  list.querySelectorAll('[data-editstore]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.editingStoreId = ui.editingStoreId === btn.dataset.editstore ? null : btn.dataset.editstore;
      render();
    });
  });
  list.querySelectorAll('[data-delstore]').forEach((btn) => {
    btn.addEventListener('click', () => deleteStore(btn.dataset.delstore));
  });
  list.querySelectorAll('[data-save-store]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.editingStoreId = null;
      saveState();
      render();
    });
  });
  list.querySelectorAll('[data-cancel-store]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.editingStoreId = null;
      render();
    });
  });
}

function renderMemberPanel() {
  const chips = $('memberChips');
  chips.innerHTML = MEMBERSHIP_NAMES.map((name) =>
    '<label class="member-chip' + (state.settings.myMemberships[name] ? ' on' : '') + '">' +
    '<input type="checkbox" data-mem="' + esc(name) + '"' + (state.settings.myMemberships[name] ? ' checked' : '') + '>' +
    esc(name) + '</label>'
  ).join('');
  chips.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', () => {
      state.settings.myMemberships[input.dataset.mem] = input.checked;
      saveState();
      render();
    });
  });
}

/* ---------- actions ---------- */

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

function parsePaste(text) {
  const s = text.trim();
  if (!s) return null;
  const normUnit = (raw) => {
    const u = raw.toLowerCase().replace('fl oz', 'floz');
    if (u === 'oz' || u === 'lb' || u === 'g' || u === 'kg') return { unitType: 'weight', unit: u === 'floz' ? 'fl oz' : u };
    if (u === 'floz' || u === 'ml' || u === 'l' || u === 'gal' || u === 'qt' || u === 'pt' || u === 'cup') {
      const unit = u === 'floz' ? 'fl oz' : (u === 'l' ? 'L' : u);
      return { unitType: 'volume', unit };
    }
    const counts = { ct: 'each', count: 'each', unit: 'unit', each: 'each', roll: 'roll', sheet: 'sheet', pod: 'pod', pack: 'pack', case: 'case' };
    if (counts[u]) return { unitType: 'count', unit: counts[u] };
    return null;
  };

  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s+for\s+\$?(\d+(?:\.\d+)?)$/i))) {
    return { deal: { type: 'multi', value: Number(m[1]), extra: Number(m[2]) } };
  }
  if ((m = s.match(/^\$?(\d+(?:\.\d+)?)\s*(?:for|\/)\s*(\d+(?:\.\d+)?)\s*(fl\s?oz|oz|lb|g|kg|ml|l|gal|qt|pt|cup|ct|count|unit|each|roll|sheet|pod|pack|case)$/i))) {
    const u = normUnit(m[3]);
    if (u) return { price: Number(m[1]), size: Number(m[2]), unitType: u.unitType, unit: u.unit };
  }
  if ((m = s.match(/^\$?(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*%$/))) {
    return { price: Number(m[1]), deal: { type: 'pct', value: Number(m[2]) } };
  }
  if ((m = s.match(/^\$?(\d+(?:\.\d+)?)$/))) {
    return { price: Number(m[1]) };
  }
  return null;
}

function readForm() {
  const item = $('fItem').value.trim();
  const storeId = $('fStore').value;
  const price = Number($('fPrice').value);
  const size = Number($('fSize').value);
  const unitType = $('fUnitType').value;
  const unit = $('fUnit').value;
  const fulfillment = document.querySelector('#fFulfill button.on') ? document.querySelector('#fFulfill button.on').dataset.fulfill : 'instore';
  const dealType = $('fDeal').value;
  const deal = { type: dealType };
  if (dealType === 'pct' || dealType === 'fixed') deal.value = Number($('fDealVal').value) || 0;
  if (dealType === 'bogo' || dealType === 'multi') {
    deal.value = Number($('fDealVal').value) || 0;
    deal.extra = Number($('fDealExtra').value) || 0;
  }
  const taxRaw = $('fTax').value.trim();
  const taxOverride = taxRaw === '' ? null : Number(taxRaw);
  return { item, storeId, price, size, unitType, unit, fulfillment, deal, taxOverride, note: $('fNote').value.trim() };
}

function validateForm(f) {
  if (!f.item) return 'Item name is required.';
  if (!f.storeId) return 'Pick a store.';
  if (!(f.price > 0)) return 'Price must be greater than 0.';
  if (!(f.size > 0)) return 'Size must be greater than 0.';
  if (f.deal.type === 'pct' && !(f.deal.value >= 0 && f.deal.value <= 100)) return 'Percent off must be between 0 and 100.';
  if (f.deal.type === 'bogo' && f.deal.extra < 0) return "Get-free count can't be negative.";
  if (f.deal.type === 'multi' && !(f.deal.value > 0 && f.deal.extra > 0)) return 'N for $ needs both numbers.';
  return null;
}

function submitForm() {
  const f = readForm();
  const err = validateForm(f);
  const hint = $('pasteHint');
  if (err) {
    hint.textContent = err;
    hint.classList.add('err');
    return;
  }
  hint.textContent = '';
  hint.classList.remove('err');

  const editing = ui.editingId ? state.offers.find((o) => o.id === ui.editingId) : null;
  if (editing) {
    Object.assign(editing, f);
    ui.editingId = null;
    toast('Offer updated');
  } else {
    state.offers.push({ id: uid(), ...f });
    ui.selectedItem = f.item;
    toast('Offer added');
  }
  saveState();
  clearForm();
  render();
}

function clearForm() {
  ui.editingId = null;
  ui.formTouched = false;
  $('fPaste').value = '';
  $('fItem').value = '';
  $('fPrice').value = '';
  $('fSize').value = '';
  $('fDeal').value = 'none';
  $('fDealVal').value = '';
  $('fDealExtra').value = '';
  $('fTax').value = '';
  $('fNote').value = '';
  setFulfill('instore');
  $('pasteHint').textContent = '';
  renderForm();
}

function startEdit(id) {
  ui.editingId = id;
  renderForm();
  document.querySelector('.form-panel, .rail .panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('fItem').focus();
}

function deleteOffer(id) {
  state.offers = state.offers.filter((o) => o.id !== id);
  if (ui.editingId === id) ui.editingId = null;
  saveState();
  render();
  toast('Offer removed');
}

function addStore() {
  const s = { id: uid(), name: 'New store', kind: 'local', deliveryFee: 7.99, freeThreshold: 35, taxRate: 0, membership: '', memberFreeDelivery: false, loyaltyPct: 0 };
  state.stores.push(s);
  ui.editingStoreId = s.id;
  saveState();
  render();
}

function deleteStore(id) {
  const count = state.offers.filter((o) => o.storeId === id).length;
  if (count > 0 && !confirm('Delete "' + (storeById(id) || {}).name + '" and its ' + count + ' offer(s)?')) return;
  state.stores = state.stores.filter((s) => s.id !== id);
  state.offers = state.offers.filter((o) => o.storeId !== id);
  if (ui.editingStoreId === id) ui.editingStoreId = null;
  saveState();
  render();
  toast('Store removed');
}

async function doPrefill() {
  const query = $('fItem').value.trim() || (ui.selectedItem !== 'all' ? ui.selectedItem : '');
  if (!query) {
    toast('Enter an item first');
    return;
  }
  const base = effectivePrefillUrl();
  const wrap = $('prefillResults');
  wrap.hidden = false;
  wrap.innerHTML = '<div class="prefill-empty">Searching for prices...</div>';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(base + '/api/prefill?q=' + encodeURIComponent(query), { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    renderPrefill((data && data.candidates) || [], query);
  } catch (err) {
    clearTimeout(timer);
    wrap.innerHTML =
      '<div class="prefill-err">Couldn\'t reach the prefill server at ' + esc(base) +
      '. Start the Shopping Tools backend (python3 server.py) or fix the URL.</div>';
  }
}

function renderPrefill(candidates, query) {
  const wrap = $('prefillResults');
  if (!candidates.length) {
    wrap.innerHTML = '<div class="prefill-empty">No prices with sizes found for "' + esc(query) + '".</div>';
    return;
  }
  wrap.innerHTML = '';
  for (const c of candidates) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'prefill-item';
    const dealTxt = c.deal ? dealLabel({ deal: c.deal }) : '';
    btn.innerHTML =
      '<span class="pf-title">' + esc(c.title) + '</span>' +
      '<span class="pf-price">' + fmtMoney(c.price) + '</span>' +
      '<span class="pf-meta">' +
        '<span class="chip muted">' + esc(c.store || '?') + '</span>' +
        '<span>' + esc(fmtNum(c.size)) + ' ' + esc(c.unit) + '</span>' +
        (dealTxt ? '<span class="chip deal">' + esc(dealTxt) + '</span>' : '') +
        (baseHost(c.url) ? '<span class="pf-src">' + esc(baseHost(c.url)) + '</span>' : '') +
      '</span>';
    btn.addEventListener('click', () => applyPrefill(c));
    wrap.appendChild(btn);
  }
}

function applyPrefill(c) {
  $('fItem').value = cleanTitle(c.title, c.store);
  $('fPrice').value = c.price;
  $('fSize').value = c.size;
  $('fUnitType').value = c.unitType;
  renderUnitOptions(c.unitType);
  $('fUnit').value = c.unit;
  if (c.deal) {
    $('fDeal').value = c.deal.type;
    $('fDealVal').value = c.deal.value ?? '';
    $('fDealExtra').value = c.deal.extra ?? '';
    updateDealFields();
  }
  const storeId = matchStore(c.store);
  if (storeId) $('fStore').value = storeId;
  ui.formTouched = true;
  $('prefillResults').hidden = true;
  toast('Prefilled from ' + (c.store || 'the web'));
}

function copyTable() {
  const groups = buildGroups();
  const comps = state.offers.map((o) => computeOffer(o, groups));
  const filtered = comps.filter((c) => ui.selectedItem === 'all' || c.offer.item === ui.selectedItem);
  const sorted = filtered.slice().sort((a, b) => (a.allInUnit ?? 1e9) - (b.allInUnit ?? 1e9));
  const lines = [['rank', 'item', 'store', 'how', 'size', 'deal', 'unit price', 'delivery share', 'tax', 'total', 'all-in per unit'].join('\t')];
  sorted.forEach((c, i) => {
    const o = c.offer;
    lines.push([i + 1, o.item, c.store ? c.store.name : '?', FULFILL_LABELS[o.fulfillment] || o.fulfillment,
      fmtNum(o.size) + ' ' + o.unit, dealLabel(o) || 'none',
      c.rawUnit != null ? fmtUnitPrice(c.rawUnit) + baseLabel(o) : '-',
      c.feeShare > 0 ? fmtMoney(c.feeShare) : '0', c.tax > 0 ? fmtMoney(c.tax) : '0',
      fmtMoney(c.total), c.allInUnit != null ? fmtUnitPrice(c.allInUnit) + baseLabel(o) : '-'
    ].join('\t'));
  });
  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(
    () => toast('Table copied'),
    () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Table copied');
    }
  );
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'shelf-scout-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.offers) || !Array.isArray(parsed.stores) || !parsed.settings) {
        toast('That file is not a Shelf Scout export');
        return;
      }
      state = parsed;
      saveState();
      render();
      toast('Import complete');
    } catch (e) {
      toast('Could not read that file');
    }
  };
  reader.readAsText(file);
}

function resetState() {
  if (!confirm('Replace all current data with the sample? Your offers will be lost.')) return;
  state = seedState();
  saveState();
  render();
  toast('Sample data restored');
}

/* ---------- render ---------- */

function render() {
  $('area').value = state.settings.area;
  $('taxOn').checked = state.settings.includeTax;
  $('fPrefillServer').value = state.settings.prefillUrl || effectivePrefillUrl();
  $('sampleNotice').hidden = state.settings.sampleNoticeSeen;
  renderMemberships();
  renderItemBar();
  renderRows();
  renderForm();
  renderStores();
  renderMemberPanel();
}

/* ---------- events ---------- */

function wireEvents() {
  $('area').addEventListener('change', (e) => {
    state.settings.area = e.target.value.trim();
    saveState();
  });
  $('taxOn').addEventListener('change', (e) => {
    state.settings.includeTax = e.target.checked;
    saveState();
    render();
  });
  $('btnDismissSample').addEventListener('click', () => {
    state.settings.sampleNoticeSeen = true;
    saveState();
    $('sampleNotice').hidden = true;
  });
  $('btnAddFirst').addEventListener('click', () => {
    $('fItem').focus();
    $('fItem').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('btnLoadSample').addEventListener('click', () => {
    state = seedState();
    saveState();
    render();
    toast('Sample prices loaded');
  });
  $('btnCancelEdit').addEventListener('click', clearForm);
  $('btnAddOffer').addEventListener('click', submitForm);
  $('btnPrefill').addEventListener('click', doPrefill);
  $('fPrefillServer').addEventListener('change', (e) => {
    state.settings.prefillUrl = e.target.value.trim();
    saveState();
  });

  $('fPaste').addEventListener('input', () => {
    const hint = $('pasteHint');
    const s = $('fPaste').value.trim();
    if (!s) { hint.textContent = ''; hint.classList.remove('err'); return; }
    const parsed = parsePaste(s);
    if (parsed) {
      hint.textContent = 'Parsed - ' + Object.entries(parsed).map(([k, v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(', ');
      hint.classList.remove('err');
    } else {
      hint.textContent = "Couldn't parse - enter the fields below";
      hint.classList.add('err');
    }
  });
  $('fPaste').addEventListener('blur', () => {
    const parsed = parsePaste($('fPaste').value);
    if (parsed) {
      if (parsed.price != null) $('fPrice').value = parsed.price;
      if (parsed.size != null) $('fSize').value = parsed.size;
      if (parsed.unitType) {
        $('fUnitType').value = parsed.unitType;
        renderUnitOptions(parsed.unitType);
        $('fUnit').value = parsed.unit;
      }
      if (parsed.deal) {
        $('fDeal').value = parsed.deal.type;
        $('fDealVal').value = parsed.deal.value ?? '';
        $('fDealExtra').value = parsed.deal.extra ?? '';
        updateDealFields();
      }
    }
  });

  $('fUnitType').addEventListener('change', () => {
    renderUnitOptions($('fUnitType').value);
  });
  $('fDeal').addEventListener('change', updateDealFields);

  document.querySelectorAll('#fFulfill button').forEach((b) => {
    b.addEventListener('click', () => setFulfill(b.dataset.fulfill));
  });

  ['fItem', 'fStore', 'fPrice', 'fSize', 'fUnitType', 'fUnit', 'fDeal', 'fTax', 'fNote'].forEach((id) => {
    $(id).addEventListener('input', () => { ui.formTouched = true; });
  });

  $('btnAddStore').addEventListener('click', addStore);
  $('btnCopy').addEventListener('click', copyTable);
  $('btnExport').addEventListener('click', exportJson);
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });
  $('btnReset').addEventListener('click', resetState);

  window.addEventListener('error', (e) => {
    if (e.message) console.error('page error:', e.message);
  });
}

/* ---------- boot ---------- */

loadState();
wireEvents();
render();
