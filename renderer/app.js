'use strict';
const $ = id => document.getElementById(id);
let groups = [];          // {name, offers:Map, done, error, showLoose}
let raf = 0;

const money = n => 'KSh ' + Math.round(n).toLocaleString('en-KE');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

function offerHtml(o, best) {
  const specs = (o.specs || []).map(([k, v]) => `<li>${k ? `<b>${esc(k)}:</b> ` : ''}${esc(v)}</li>`).join('');
  return `<div class="offer${best ? ' best' : ''}">
    <div class="img" style="${o.image ? `background-image:url('${esc(o.image)}')` : ''}">${o.image ? `<button class="dl" data-img="${esc(o.image)}" data-name="${esc(o.title)}" title="Download image">&#8595;</button>` : 'No image'}</div>
    <div>
      <div class="ot">${esc(o.title)}${o.match === 'near' ? '<span class="badge ver">Close match</span>' : o.match === 'related' ? '<span class="badge ver">Related</span>' : ''}${best ? '<span class="badge">Lowest price</span>' : ''}${o.verified ? '' : '<span class="badge ver">checking…</span>'}</div>
      <span class="store">${esc(o.store)}</span>
      <ul class="specs">${specs}</ul>
    </div>
    <div class="pr"><div class="price">${o.price > 0 ? `<small>${o.from ? 'From' : 'Price'}</small>${money(o.price)}<button class="cp" data-copy="${Math.round(o.price)}" title="Copy price">&#10064;</button>` : '<small>Price</small>See page'}</div>${o.from && o.hi > o.price ? `<div class="orig">up to ${money(o.hi)} (varies by size)</div>` : o.from ? '<div class="orig">your size isn’t listed: lowest price shown</div>' : ''}${o.orig ? `<div class="orig">≈ converted from ${esc(o.orig)}</div>` : ''}
      <div class="btns"><button class="open" data-url="${esc(o.url)}" data-b="edge">Open in Edge</button>
      <button class="open" data-url="${esc(o.url)}" data-b="chrome">Open in Chrome</button></div></div>
  </div>`;
}

/** What to show for one product: Kenyan listings first; foreign (converted) ones only on request or when Kenya has none. */
function view(g) {
  const all = [...g.offers.values()].sort((a, b) => (Math.round(b.rank * 10) - Math.round(a.rank * 10)) || (a.price || 1e12) - (b.price || 1e12));
  const priced = list => { const p = list.filter(o => o.price > 0); return p.length >= 3 ? p : list; };      // plenty of real prices: hide pages that only say "See page"
  const local = priced(all.filter(o => !o.intl)), intl = priced(all.filter(o => o.intl));
  const kenya = local.length > 0;
  const main = kenya ? local : intl;
  const hasExact = main.some(o => o.match === 'exact');
  let note = '';
  const onlyRelated = main.length && main.every(o => o.match === 'related');
  if (main.length && !hasExact && !onlyRelated) note = 'No exact match' + (kenya ? ' in Kenya' : '') + '. Showing the closest results, best match first.';
  if (!kenya && main.length) note = 'No Kenyan listings found. Showing international results (converted to KSh), best match first.';
  const showIntl = kenya && g.showIntl;
  const all2 = showIntl ? main.concat(intl) : main, core = all2.filter(o => o.match !== 'related');
  const foldRel = core.length > 0 && !g.showRelated, pool = foldRel ? core : all2, cnt = new Map(), moreRel = foldRel ? all2.length - core.length : 0;
  pool.forEach(o => cnt.set(o.store, (cnt.get(o.store) || 0) + 1));
  const stores = [...cnt.entries()].sort((a, b) => b[1] - a[1]);
  if (onlyRelated) note = 'Nothing matched exactly. These are the closest related listings, best first.';
  if (g.corrected && main.length) note = 'Also searched “' + g.corrected + '” (possible spelling). ' + note;
  return { main: g.store && cnt.has(g.store) ? pool.filter(o => o.store === g.store) : pool, intl: kenya && !g.showIntl ? intl : [], note, stores, moreRel };
}

function render() {
  const root = $('results');
  const scroll = root.scrollTop;
  root.innerHTML = groups.map((g, gi) => {
    const v = view(g);
    const prices = v.main.map(o => o.price).filter(p => p > 0), lo = Math.min(...prices), hi = Math.max(...prices);
    const sum = v.main.length
      ? `${v.main.length} offers` + (prices.length ? ` · from <b>${money(lo)}</b> to ${money(hi)}` : '')
      : (g.done ? 'No results found' : 'Searching…');
    return `<section class="group">
      <div class="ghead"><h2>${esc(g.name)}</h2><span class="sum">${sum}</span>${g.done ? '' : '<span class="spin"></span>'}</div>
      ${g.error ? `<div class="msg err">${esc(g.error)}</div>` : ''}
      ${g.targets && g.targets.length ? `<div class="msg">Searched first: ${esc(g.targets.join(', '))}</div>` : ''}
      ${v.note ? `<div class="msg">${esc(v.note)}</div>` : ''}
      ${v.stores.length > 1 ? `<div class="chips"><button class="chip${g.store ? '' : ' on'}" data-store="${gi}|">All (${v.stores.reduce((a, s) => a + s[1], 0)})</button>${v.stores.map(([n, c]) => `<button class="chip${g.store === n ? ' on' : ''}" data-store="${gi}|${esc(n)}">${esc(n)} (${c})</button>`).join('')}</div>` : ''}
      ${v.main.map(o => offerHtml(o, v.main.length > 1 && o.price > 0 && o.price === lo && !o.from)).join('')}
      ${v.moreRel ? `<button class="more" data-more="${gi}">Show ${v.moreRel} more related results</button>` : ''}
      ${v.intl.length ? `<button class="more" data-intl="${gi}">Show ${v.intl.length} international results (converted to KSh)</button>` : ''}
    </section>`;
  }).join('');
  root.scrollTop = scroll;
  $('export').disabled = !groups.some(g => g.offers.size);
}

function csv() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['Product searched', 'Store', 'Listing', 'Price (KSh)', 'Specs', 'Link'].map(q).join(',')];
  for (const g of groups)
    for (const o of view({ ...g, showIntl: true }).main)
      rows.push([g.name, o.store, o.title, o.price || '', (o.specs || []).map(([k, v]) => (k ? k + ': ' : '') + v).join('; '), o.url].map(q).join(','));
  return rows.join('\r\n');
}

async function go() {
  const items = [...new Set($('q').value.split('\n').map(s => s.trim()).filter(Boolean))];
  if (!items.length) return;
  groups = items.map(name => ({ name, offers: new Map(), done: false, error: '', showLoose: false }));
  $('msg').textContent = ''; $('msg').className = 'msg';
  render();
  await window.api.search(items);
}

window.api.onEvent(e => {
  const g = groups[e.i]; if (!g) return;
  if (e.type === 'offers') e.offers.forEach(o => g.offers.set(o.id, o));
  else if (e.type === 'update') { const o = g.offers.get(e.id); if (o) Object.assign(o, e.patch); }
  else if (e.type === 'targets') g.targets = e.shops;
  else if (e.type === 'error') g.error = e.message;
  else if (e.type === 'ok') g.error = '';
  else if (e.type === 'replace') g.offers = new Map(e.offers.map(o => [o.id, o]));
  else if (e.type === 'corrected') g.corrected = e.text;
  else if (e.type === 'done') g.done = true;
  schedule();
});

$('results').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.copy) {
    window.api.copy(b.dataset.copy);
    b.textContent = '\u2713'; b.classList.add('ok');
    setTimeout(() => { b.innerHTML = '&#10064;'; b.classList.remove('ok'); }, 1000);
    return;
  }
  if (b.dataset.url) window.api.open(b.dataset.url, b.dataset.b);
  if (b.dataset.img) window.api.download(b.dataset.img, b.dataset.name).then(r => {
    if (r) { $('msg').textContent = r.error ? 'Download failed.' : 'Saved: ' + r.file; $('msg').className = 'msg' + (r.error ? ' err' : ''); }
  });
  if (b.dataset.more) { groups[+b.dataset.more].showRelated = true; render(); }
  if (b.dataset.store != null) { const i = b.dataset.store.indexOf('|'), gi = +b.dataset.store.slice(0, i), n = b.dataset.store.slice(i + 1); groups[gi].store = groups[gi].store === n ? '' : n; render(); }
  if (b.dataset.intl) { groups[+b.dataset.intl].showIntl = true; render(); }
});
$('diag').onclick = async () => { const n = await window.api.diag(); $('msg').textContent = n ? 'Copied ' + n + ' diagnostic lines. Paste them in the chat.' : 'No diagnostics yet. Search first.'; };
$('vg').onclick = async () => { await window.api.verifyGoogle(); $('msg').textContent = 'Solve the check in the window, then close it. Search again after.'; $('vg').hidden = true; };
window.api.onNotice(t => { if (t === 'google') { $('vg').hidden = false; $('msg').textContent = 'Google blocked automatic searches, so results may be missing. Click Verify Google.'; $('msg').className = 'msg err'; } });
$('go').onclick = go;
$('q').addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'Enter') go(); });
$('folder').onclick = async () => { const d = await window.api.pickDir(); if (d) { $('msg').textContent = 'Images save to: ' + d; $('msg').className = 'msg'; } };
$('export').onclick = async () => { if (await window.api.exportCsv(csv())) $('msg').textContent = 'Saved.'; };



