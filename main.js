'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { isBlocked, keyQueries, shopMode, officialSites, smart, searchProduct, quickWeb, discover, setDiscovered, setRates, setLog, snippetPrice, priceRange, variants, plan, setShops, getShops, shopQueries, kenyanSite, setLearned } = require('./src/search');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + process.versions.chrome + ' Safari/537.36';   // matches the real engine inside the app
let googleBlockedUntil = 0;                                        // Google showed a captcha: leave it alone until the person verifies (or 30 min)

// Free mode: loads Google Shopping in a hidden window, like a normal visitor, and reads the prices off it.
const EXTRACT = `(()=>{const out=[],seen=new Set(),P=/(?:ksh|kes)\\s?[\\d,]+/i;
document.querySelectorAll('a[href]').forEach(a=>{const t=a.innerText||'';if(!P.test(t))return;
const lines=t.split('\\n').map(s=>s.trim()).filter(Boolean);const pl=lines.find(l=>P.test(l));
const o=lines.filter(l=>l!==pl&&l.length>3&&!/^(free|delivery|\\(?\\d)/i.test(l));
const title=[...o].sort((x,y)=>y.length-x.length)[0];if(!title)return;
const store=o.filter(l=>l!==title&&l.length<40).pop()||'';let href=a.href;
try{const u=new URL(href);if(u.hostname.includes('google.')&&u.pathname==='/url'&&u.searchParams.get('q'))href=u.searchParams.get('q');}catch(e){}
const k=href+title;if(seen.has(k))return;seen.add(k);const im=a.querySelector('img');
out.push({title,source:store,price:pl,link:href,imageUrl:im&&/^http/.test(im.src)?im.src:''});});return out;})()`;

let win, runId = 0;
app.whenReady().then(() => session.fromPartition('persist:scrape').webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (d, cb) => cb({ cancel: d.resourceType === 'media' || d.resourceType === 'font' })));

// Generic "product card" reader for any shop's search page: finds each price, climbs to its card, reads title/link/image.
function cardsInPage() {
  const M = /(?:KSh|KES|Ksh|US\$|USD|\$|£|GBP|€|EUR|AED|CN¥|¥|CNY|₹)\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:KSh|KES|Ksh)/i;
  const G = new RegExp(M.source, 'gi');
  const priced = [...document.body.querySelectorAll('*')].filter(e => e.textContent.length < 40 && M.test(e.textContent));
  const leaves = priced.filter(e => !priced.some(o => o !== e && e.contains(o)));
  const out = [], seen = new Set();
  for (const el of leaves) {
    if (el.closest('del,s,strike') || /line-through/.test(getComputedStyle(el).textDecorationLine)) continue;   // old price
    let c = el, card = null;
    for (let i = 0; i < 9 && c.parentElement; i++) { c = c.parentElement; if (c.querySelector('img') && c.querySelector('a[href]')) { card = c; break; } }
    if (!card || (card.innerText.match(G) || []).length > 3) continue;
    const h = [...card.querySelectorAll('h1,h2,h3,h4,[class*=title],[class*=name]')].map(x => x.innerText.trim()).find(x => x.length > 8 && !M.test(x));
    const area = i => { const r = i.getBoundingClientRect(); return r.width * r.height; };
    const img = [...card.querySelectorAll('img')].filter(i => /^http/.test(i.currentSrc || i.src || i.dataset.src || '') && !/sprite|badge|logo|icon|pledge|climate|placeholder|blank|pixel|dispatch/i.test((i.currentSrc || i.src || i.dataset.src) + ' ' + i.className))
      .sort((x, y) => area(y) - area(x))[0];
    const title = h || (img && img.alt) || '';
    const a = (card.querySelector('h1 a,h2 a,h3 a,h4 a') || (card.querySelector('h1,h2,h3,h4') || {}).closest && card.querySelector('h1,h2,h3,h4').closest('a') || card.querySelector('a[href]'));
    if (!title || !a || !a.href || seen.has(a.href)) continue;
    seen.add(a.href);
    out.push({ title, price: el.textContent.trim(), link: a.href, imageUrl: img ? (img.currentSrc || img.src || img.dataset.src) : '' });
  }
  return out.slice(0, 40);
}

// At most 6 hidden browser windows at once (shops that block plain requests go first).
let active = 0; const waiters = [];
async function slot(fn, hi) {
  if (active >= 6) await new Promise(r => (hi ? waiters.unshift(r) : waiters.push(r)));
  active++;
  try { return await fn(); } finally { active--; const n = waiters.shift(); if (n) n(); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function hidden(url, readFn, hi) {
  return slot(async () => {
    const w = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { contextIsolation: true, partition: 'persist:scrape', backgroundThrottling: false } });
    try {
      w.webContents.setUserAgent(UA);
      w.loadURL(url, { extraHeaders: 'Accept-Language: en-US,en;q=0.9\n' }).catch(() => {});
      let prev = -1, last = [];
      const trace = [];
      for (let i = 0; i < 26; i++) {
        await sleep(250);
        if (w.isDestroyed()) break;
        if (/\/sorry\/|captcha/i.test(w.webContents.getURL())) {
          dbg('window', url.slice(0, 70), 'Google asked for a check (captcha)', 0);
          if (!googleBlockedUntil || googleBlockedUntil < Date.now()) { googleBlockedUntil = Date.now() + 30 * 60 * 1000; if (win && !win.isDestroyed()) win.webContents.send('notice', 'google'); }
          break;
        }
        // Read the page even while it is still "loading" (Google, Jiji etc. never stop loading in a hidden window); settled = same count twice
        const busy = w.webContents.isLoading();
        if (busy && i < 4) continue;
        let cur;
        try { cur = await w.webContents.executeJavaScript(readFn); trace.push(Array.isArray(cur) ? cur.length : 'x'); } catch (e) { trace.push('E:' + String(e.message).slice(0, 40)); cur = []; }
        if (!Array.isArray(cur)) cur = [];
        if (cur.length > last.length) last = cur;                  // keep the best read, a later empty read (page reloading) must not wipe it
        if (cur.length && cur.length === prev && (!busy || i >= 8)) break;      // stable
        prev = cur.length;
      }
      if (!last.length && !w.isDestroyed()) {
        const info = await w.webContents.executeJavaScript("(()=>{const t=document.body?document.body.innerText:'';return t.length+' chars; a='+document.querySelectorAll('a').length+'; h3='+document.querySelectorAll('h3').length+'; li.product='+document.querySelectorAll('li.product').length+'; h3s: '+[...document.querySelectorAll('h3')].slice(0,3).map(h=>(h.closest('a')?'A['+(h.closest('a').getAttribute('href')||'').slice(0,50)+']':'noA')+h.innerText.slice(0,25)).join(' / ')+'; text: '+t.replace(/\\s+/g,' ').slice(0,100)})()").catch(e => 'diag error ' + e.message);
        dbg('window', url.slice(0, 70), 'empty; reads=[' + trace.join(',') + '] title: ' + w.webContents.getTitle() + ' | ' + info, 0);
      }
      return last;
    } finally { if (!w.isDestroyed()) w.destroy(); }
  }, hi);
}

const googleShopping = async q => googleBlockedUntil > Date.now() ? { shopping: [] } : ({ shopping: await hidden('https://www.google.com/search?tbm=shop&hl=en&gl=ke&q=' + encodeURIComponent(q), EXTRACT) });
const SITES = [
  ['Amazon US', 'https://www.amazon.com/s?k='], ['Amazon UK', 'https://www.amazon.co.uk/s?k='],
  ['eBay', 'https://www.ebay.com/sch/i.html?_nkw='], ['AliExpress', 'https://www.aliexpress.com/wholesale?SearchText='],
  ['Jumia Kenya', 'https://www.jumia.co.ke/catalog/?q='], ['Kilimall', 'https://www.kilimall.co.ke/search?q='],
  ['Jiji Kenya', 'https://jiji.co.ke/search?query='],
];
const siteSearch = (name, base, hi) => async q =>
  ({ shopping: (await hidden(base + encodeURIComponent(q), '(' + cardsInPage.toString() + ')()', hi)).map(i => ({ ...i, source: name })) });

// Cheap sources are searched with every variant + sub-query (spelling, model code alone, without the model code...).
const multi = (fn, list = variants) => async q => {
  const rs = await Promise.all(list(q).map(v => fn(v).catch(() => ({ shopping: [] }))));
  return { shopping: rs.flatMap(r => r.shopping) };
};
const KE = new Set(['Jumia Kenya', 'Kilimall', 'Jiji Kenya']);
const modelOnly = q => { const p = plan(q); return /\d/.test(p[0] || '') && !/\s/.test(p[0]) ? [p[0]] : []; };
// Google exactly as your own browser sees it (hidden window). Reliable; used together with the fast plain-request engines.
const GOOGLE_RESULTS = `(()=>{const out=[],seen=new Set();
const add=(a,title)=>{if(!a||!/^https?:/.test(a.href))return;let u=a.href;try{const x=new URL(u);if(x.hostname.includes('google.')){if(x.pathname==='/url')u=x.searchParams.get('q')||x.searchParams.get('url')||u;else if(x.pathname!=='/goto')return;}}catch(e){}
if(seen.has(u)||!title)return;seen.add(u);let b=a;for(let i=0;i<7&&b.parentElement;i++){const p=b.parentElement;if(p.querySelectorAll('h3,[role=heading]').length>1)break;b=p;}
out.push({title:title,link:u,snippet:(b.innerText||'').slice(0,700)});};
document.querySelectorAll('a h3, a [role=heading], h3 a').forEach(h=>{const a=h.closest('a')||h.querySelector('a');add(a,(h.innerText||'').trim());});
if(!out.length)document.querySelectorAll('a[href^=http]').forEach(a=>{const t=(a.innerText||'').split(String.fromCharCode(10))[0].trim();if(t.length>=20&&t.length<=160)add(a,t);});
return out;})()`;
// Google gives a bare window links like google.com/goto?url=<code>. Its answer to that link is a redirect to the real page: read where it points.
const GOTO_FAIL = [];
const resolveGoto = async o => {
  let x; try { x = new URL(o.link); } catch { return null; }
  if (!x.hostname.includes('google.') || x.pathname !== '/goto') return o;
  // the real site is shown under every result ("https://www.finder.com > product > ..."): keep that as a lead if the redirect can't be read
  const shown = (String(o.snippet).match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i) || [])[0];
  const lead = shown && !/google\./.test(shown) ? { ...o, link: shown + '/', lead: true } : null;
  try {
    const r = await fetch(o.link, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(4000) });
    const loc = r.headers.get('location');
    if (loc && /^https?:/.test(loc) && !/google\./.test(new URL(loc).hostname)) return { ...o, link: loc };
    if (r.status === 200) {                                        // no redirect header: the page itself names the real address (meta refresh / script / link)
      const body = (await r.text()).slice(0, 20000).replace(/\\x3d/gi, '=').replace(/\\x26/gi, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
      const urls = body.match(/https?:\/\/[^\s"'<>\\)]+/g) || [];
      const real = urls.map(u => u.replace(/[,;.]+$/, '')).find(u => { try { return !/(google|gstatic|googleapis|schema\.org|w3\.org)\./i.test(new URL(u).hostname); } catch { return false; } });
      if (real) return { ...o, link: real };
    }
    GOTO_FAIL.push(r.status + (loc ? ' ->google' : ' nolocation'));
  } catch (e) { GOTO_FAIL.push('err ' + String(e.message).slice(0, 20)); }
  return lead;
};
const googleWin = async q => {
  if (googleBlockedUntil > Date.now()) return [];
  const raw = (await hidden('https://www.google.com/search?hl=en&gl=ke&q=' + encodeURIComponent(q), GOOGLE_RESULTS, true).catch(() => [])).map((r, i) => ({ ...r, gpos: i }));
  GOTO_FAIL.length = 0;
  const fixed = (await Promise.all(raw.map(resolveGoto))).filter(Boolean);
  dbg('google-window', q, 'read ' + raw.length + ', usable links ' + fixed.length + ' (leads only: ' + fixed.filter(f => f.lead).length + '); redirect failures: ' + GOTO_FAIL.join(', '), fixed.length);
  return fixed;
};
// Fast plain-request engines first (~1 s). Google's own window only when those found little.
const engine = async q => {
  let fast = []; try { fast = (await quickWeb(q)).organic || []; } catch { /* none */ }
  const win = fast.length < 5 ? await googleWin(q).catch(() => []) : [];
  dbg('engine', q, 'fast=' + fast.length + ' google=' + win.length, fast.length + win.length);
  const seen = new Set();
  return { organic: [...win, ...fast].filter(o => !seen.has(o.link) && seen.add(o.link)) };
};
// Web search (fast plain requests + Google window) (Google + Bing + DuckDuckGo at once, ~1 s). Several angles run together.
const webAll = async q => {
  // Google's own results page in a window (shows shop prices even for shops that block us), plus the fast engines
  const jobs = [googleWin(q).then(o => { dbg('google-window', q, 'results', o.length); return { organic: o }; }), quickWeb(q), quickWeb(q + ' price Kenya')];
  for (const site of officialSites(q)) jobs.push(quickWeb('site:' + site + ' ' + q.replace(/[`´‘’′"']+/g, ' ').split(/\s+/).filter(w => !officialSites(w).length).join(' ')).then(r => ({ organic: r.organic.map(o => ({ ...o, official: true })) })));
  const vs = variants(q); if (vs[1]) jobs.push(quickWeb(vs[1]));
  const sm = smart(q).filter(x => x.toLowerCase() !== q.toLowerCase()); if (sm[0]) jobs.push(quickWeb(sm[0] + ' Kenya'));
  for (const m of modelOnly(q)) jobs.push(quickWeb(m + ' Kenya'));
  for (const k of keyQueries(q).slice(0, 2)) jobs.push(quickWeb(k + ' Kenya'));
  const rs = await Promise.all(jobs.map(j => j.catch(() => ({ organic: [] }))));
  const seen = new Set();
  return { organic: rs.flatMap(r => r.organic).filter(o => !seen.has(o.link) && seen.add(o.link)) };
};
// Kenyan shops come from shops.txt (one web address per line) so more can be added without touching the code.
try {
  setShops(fs.readFileSync(path.join(__dirname, 'shops.txt'), 'utf8').split(/\r?\n/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean));
} catch { /* built-in list */ }
const learnedFile = path.join(app.getPath('userData'), 'learned.json');
try { setLearned(JSON.parse(fs.readFileSync(learnedFile, 'utf8'))); } catch { /* nothing learned yet */ }
const discFile = path.join(app.getPath('userData'), 'discovered.json');
try { setDiscovered(JSON.parse(fs.readFileSync(discFile, 'utf8'))); } catch { /* nothing yet */ }
const saveDisc = o => { try { fs.writeFileSync(discFile, JSON.stringify(o)); } catch { /* ignore */ } };
const dbgFile = path.join(app.getPath('userData'), 'debug.log');
const dbg = (host, q, how, n) => { try { fs.appendFileSync(dbgFile, new Date().toISOString() + ' ' + host + ' | ' + q + ' | ' + how + ' -> ' + n + '\n'); } catch { /* ignore */ } };
// One shop, searched directly (its product API / search page). Two queries first; more only if those found nothing.
setLog(dbg);
const shopCache = {};
const makeShop = (d, browser = true) => {
  const host = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (shopCache[host]) return shopCache[host];
  const one = kenyanSite(d);
  const run = (list, q) => Promise.all(list.map(v => one(v).catch(() => ({ shopping: [] })))).then(rs => ({ shopping: rs.flatMap(r => r.shopping) }));
  const viaFetch = async q => { const qs = shopQueries(q); let r = await run(qs.slice(0, 3)); if (!r.shopping.length) r = await run(qs.slice(3, 6)); return r; };
  return (shopCache[host] = async q => {
    const r = await viaFetch(q);
    const blocked = isBlocked(host) || shopMode(host) === 'none';
    if (r.shopping.length || !blocked || !browser) { dbg(host, q, 'fetch', r.shopping.length); return r; }
    // the shop refuses plain requests (bot protection): open its search page in a hidden browser window instead, like a visitor
    const kq = keyQueries(q), key = kq.find(x => /\d/.test(x)) || kq[0] || q;
    // the shop refuses us, but Google/Bing show its pages with prices: read them from the search results, and open its page in a window as well
    const viaSnip = engine('site:' + host + ' ' + key).then(r => (r.organic || []).filter(o => { try { return new URL(o.link).hostname.replace(/^www\./, '').endsWith(host); } catch { return false; } }).map(o => {
      const m = snippetPrice(o.snippet) || priceRange(o.snippet); if (!m) return null;
      return { title: o.title.replace(/\s+[-|–]\s+[^-|–]*$/, ''), price: 'KES ' + m.value, link: o.link, imageUrl: '', source: host };
    }).filter(Boolean)).catch(() => []);
    const viaWin = siteSearch(host, 'https://' + host + '/?post_type=product&s=', true)(key).then(x => x.shopping).catch(() => []);
    const out = (await Promise.all([viaSnip, viaWin])).flat(); dbg(host, q, 'blocked: snippets+browser', out.length);
    return { shopping: out };
  });
};
const shopMap = {};
getShops().forEach(d => { shopMap[d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')] = makeShop(d); });
const cfg = { country: 'ke', onLearn: o => { try { fs.writeFileSync(learnedFile, JSON.stringify(o)); } catch { /* ignore */ } }, providers: {
  shopMap,
  siteSearch: (host, browser) => makeShop(host, browser),
  discover: (q, onSite) => discover(q, engine, saveDisc, onSite),
  slow: [...SITES.filter(([n]) => KE.has(n)).map(([n, u]) => multi(siteSearch(n, u), q => [...variants(q).slice(0, 1), ...modelOnly(q)]))],
  intl: SITES.filter(([n]) => !KE.has(n)).map(([n, u]) => siteSearch(n, u)),
  web: webAll,
} };

// Live exchange rates (free, no key); built-in approximate rates are used if offline.
fetch('https://open.er-api.com/v6/latest/KES', { signal: AbortSignal.timeout(8000) })
  .then(r => r.json()).then(j => j && j.rates && setRates(j.rates)).catch(() => {});

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: '#0e0f12', title: 'Price Finder',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}


ipcMain.handle('search', async (_, items) => {
  const my = ++runId;
  const send = (i, e) => { if (my === runId && win && !win.isDestroyed()) win.webContents.send('evt', { i, ...e }); };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length && my === runId) {
      const i = next++;
      await searchProduct(items[i], cfg, e => send(i, e), () => my === runId)
        .catch(err => send(i, { type: 'error', message: err.message }));
    }
  }));
});

const dirFile = () => path.join(app.getPath('userData'), 'imgfolder.txt');
let saveDir = ''; try { saveDir = fs.readFileSync(dirFile(), 'utf8').trim(); } catch { /* none yet */ }
async function pickDir() {
  const d = await dialog.showOpenDialog(win, { title: 'Choose folder for downloaded images', defaultPath: saveDir || app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] });
  if (d.canceled || !d.filePaths[0]) return '';
  saveDir = d.filePaths[0]; fs.writeFileSync(dirFile(), saveDir); return saveDir;
}
ipcMain.handle('pickdir', () => pickDir());
ipcMain.handle('diag', () => { try { const t = fs.readFileSync(dbgFile, 'utf8').trim().split('\n').slice(-70).join('\n'); clipboard.writeText(t); return t.split('\n').length; } catch { return 0; } });
// Google sometimes asks the app to prove it's a person. The person solves it once in a normal window; the app then keeps the pass.
ipcMain.handle('verifyGoogle', () => {
  const v = new BrowserWindow({ width: 960, height: 720, title: 'Verify with Google', webPreferences: { contextIsolation: true, partition: 'persist:scrape' } });
  v.webContents.setUserAgent(UA);
  v.loadURL('https://www.google.com/search?hl=en&gl=ke&q=gate+valve+1+inch+price+kenya');
  v.on('closed', () => { googleBlockedUntil = 0; });
  return true;
});
ipcMain.handle('copy', (_, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('dl', async (_, url, name) => {
  if (!/^https?:\/\//i.test(url)) return { error: true };
  if (!saveDir || !fs.existsSync(saveDir)) { if (!await pickDir()) return null; }
  const lastDir = saveDir;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('bad');
    const ext = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' })[(r.headers.get('content-type') || '').split(';')[0]] || 'jpg';
    const base = String(name || 'image').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'image';
    let file = path.join(lastDir, base + '.' + ext), n = 1;
    while (fs.existsSync(file)) file = path.join(lastDir, `${base} (${n++}).${ext}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return { file: path.basename(file) };
  } catch { return { error: true }; }
});

const BROWSERS = {
  edge: [process.env['ProgramFiles(x86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe', process.env.ProgramFiles + '\\Microsoft\\Edge\\Application\\msedge.exe'],
  chrome: [process.env.ProgramFiles + '\\Google\\Chrome\\Application\\chrome.exe', process.env['ProgramFiles(x86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'],
};
ipcMain.handle('open', (_, url, browser) => {
  if (!/^https?:\/\//i.test(url)) return;
  const exe = (BROWSERS[browser] || []).find(p => p && fs.existsSync(p));
  if (!exe) return shell.openExternal(url);
  require('child_process').spawn(exe, [url], { detached: true, stdio: 'ignore' }).unref();
});

ipcMain.handle('export', async (_, csv) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'prices.csv', filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, '﻿' + csv);
  return true;
});

app.whenReady().then(createWindow);

// Self-update from GitHub Releases (installer version only; the portable .exe can't update itself).
app.whenReady().then(() => {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.on('update-downloaded', info => {
      dialog.showMessageBox(win, { type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, title: 'Price Finder update',
        message: 'Version ' + info.version + ' is ready.', detail: 'Restart to finish updating. It also installs automatically when you close the app.' })
        .then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
    });
    autoUpdater.on('error', () => { /* offline or no release yet: ignore */ });
    autoUpdater.checkForUpdates().catch(() => {});
  } catch { /* updater unavailable */ }
});
app.on('window-all-closed', () => app.quit());
