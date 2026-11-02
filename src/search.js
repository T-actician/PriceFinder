'use strict';
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SKIP = ['facebook.', 'instagram.', 'youtube.', 'youtu.be', 'pinterest.', 'tiktok.', 'wikipedia.', 'twitter.',
  'x.com', 'linkedin.', 'reddit.', 'quora.', 't.me', 'whatsapp.', 'google.', 'bing.', 'yahoo.', 'medium.com', 'scribd.'];
const STOP = new Set(['for', 'and', 'the', 'of', 'with', 'in', 'a', 'an', 'kenya', 'price', 'ksh', 'buy', 'to', 'per', 'x', 'nairobi']);
const MATERIALS = ['stainless steel', 'cast iron', 'galvanized', 'galvanised', 'brass', 'upvc', 'pvc', 'ppr', 'hdpe',
  'copper', 'bronze', 'aluminium', 'aluminum', 'steel', 'plastic', 'rubber', 'ceramic', 'glass', 'wood'];

const domain = u => { try { const h = new URL(u).hostname.toLowerCase(); return h.startsWith('www.') ? h.slice(4) : h; } catch { return ''; } };
const skipDomain = d => !d || SKIP.some(s => d === s.replace(/\.$/, '') || d.startsWith(s.endsWith('.') ? s : s + '.') || d.includes('.' + (s.endsWith('.') ? s : s + '.')) || d.endsWith('.' + s));
let LOG = () => {}; const setLog = f => { LOG = f; };
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

// ---------- matching ----------
/** Trade shorthand: H/G, HG = heavy gauge; L/G, LG = light gauge (HG/LG only next to the word pipe, so brands like LG are safe). */
function abbr(s) {
  s = String(s || '').replace(/\bh\s*[\/.]\s*g\b\.?/gi, 'heavy gauge').replace(/\bl\s*[\/.]\s*g\b\.?/gi, 'light gauge');
  if (/\bpipes?\b/i.test(s)) s = s.replace(/\bhg\b/gi, 'heavy gauge').replace(/\blg\b/gi, 'light gauge');
  return s;
}
function norm(s) {
  return abbr(s).replace(/\b([A-Z]{1,3})[\s-]+(\d{3,})\b/g, '$1$2').toLowerCase().replace(/\bg\.\s?i\b\.?/g, 'gi')
    .replace(/(?<![\d.\/])(\d{2,4}(?:\.\d+)?)((?:\s*x\s*\d+(?:\.\d+)?)+)\s*(mm|cm)\b/g, (m, a, rest, u) => [a, ...rest.match(/\d+(?:\.\d+)?/g)].map(n => n + u).join(' x '))
    .replace(/[`´‘’′]{2}/g, '"').replace(/[“”″]/g, '"').replace(/(''|")(?=[a-z])/g, '$1 ').replace(/\bpn\s?-?(\d)/g, 'pn$1').replace(/(\d|")\s*x\s*(?=\d)/g, '$1 x ').replace(/(\d)(gangs?|ways?)\b/g, '$1 $2').replace(/½/g, '1/2').replace(/¾/g, '3/4').replace(/¼/g, '1/4')
    .replace(/(?<![\d\/.])(\d+)\s*[- ]\s*(\d)\/(\d)(?![\d\/])/g, (m, a, b, c) => String(+a + b / c))        // 2 1/2, 2-1/2 -> 2.5
    .replace(/\b([1-9])(1\/2|1\/4|3\/4)\b/g, (m, a, f) => String(+a + { '1/2': 0.5, '1/4': 0.25, '3/4': 0.75 }[f]))   // 21/2 (trade shorthand) -> 2.5
    .replace(/(\d+(?:[.\/]\d+)?)[\s-]*(?:"|''|inches\b|inch\b|in\b)/g, '$1in')
    .replace(/(\d+(?:\.\d+)?)\s*(?:mtrs?|mt|metres?|meters?)\b/g, '$1m')
    .replace(/\b(?:metres|meters|metre|meter|mtrs|mtr|mt)\b/g, 'metre')
    .replace(/(\d+(?:\.\d+)?)\s*(mm|cm|kg|ltrs?|litres?|l|w|v|ah)\b/g, (m, n, u) => n + (/^(ltrs?|litres?)$/.test(u) ? 'l' : u))
    .replace(/ph/g, 'f')
    .replace(/[^a-z0-9\/.]+/g, ' ');
}
function tokens(s) {
  return norm(s).split(' ').map(t => t.replace(/^[.\/]+|[.\/]+$/g, '')).filter(Boolean)
    .map(t => (t.length > 3 && /[^s]s$/.test(t) && !/\d/.test(t) ? t.slice(0, -1) : t))
    .map(t => (/^\d+(?:[.\/]\d+)?in$/.test(t) ? t.slice(0, -2) : t))      // 3/4" == 3/4
    .filter(t => !STOP.has(t));
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const NUMTOK = /^\d+(?:[.\/]\d+)?$/;
function tokHit(q, set) {
  if (set.has(q)) return true;
  if (NUMTOK.test(q)) { const v = FR(q); for (const t of set) if (NUMTOK.test(t) && Math.abs(FR(t) - v) < 0.001) return true; }
  if (ALIAS[q] && ALIAS[q].some(a => set.has(a))) return true;
  if (q.length < 5 || /\d/.test(q)) return false;           // short words and sizes must match exactly
  for (const t of set) {
    if (/\d/.test(t) || Math.abs(t.length - q.length) > 2) continue;
    const d = lev(q, t);
    if (d <= 1 || (d <= 2 && q.length >= 7 && q[0] === t[0])) return true;     // tolerates typos like "cross" -> "close"
  }
  return false;
}
const isModel = t => /[a-z]/i.test(t) && /\d/.test(t) && !/^\d+(?:[.\/]\d+)?(?:mm|cm|m|in|l|kg|g|w|v|ah|a|amp|amps|kw|hp|hz|va|ft|bar|psi|pcs|mtr|mt)$/i.test(t);
const isSize = t => /\d/.test(t) && !isModel(t) && /[a-z]/i.test(t);
const LOW = new Set(['metre', 'pcs', 'piece', 'pc', 'dark', 'light', 'deep', 'gauge', 'furniture', 'structural', 'industrial', 'domestic', 'commercial', 'household', 'decorative', 'general']);
const ALIAS = { dark: ['heavy'], heavy: ['dark'], gi: ['galvanized', 'galvanised'], galvanized: ['gi', 'galvanised'], galvanised: ['gi', 'galvanized'],
  roll: ['coil'], coil: ['roll'], stand: ['standpipe'], standpipe: ['stand'] };            // trade synonyms: dark grey waste pipe = heavy gauge                 // unit-ish words: nice to match, never required
const weight = t => (isModel(t) ? 3 : isSize(t) ? 1.5 : LOW.has(t) ? 0.3 : 1);

/**
 * Every typed word counts on its own (model codes weigh most, then sizes). Nothing has to match exactly:
 *  match 'exact' = all words present; 'near' = a meaningful part is present (>=50% by weight, OR 3+ typed words
 *  together in order, OR the model code); else 'loose' (dropped).
 *  rank = relevance, used to sort (model code + coverage + words together + short titles first).
 */
function analyze(query, main, extra, dom, ctx) {
  const wt = t => weight(t) * ((ctx && ctx.mul && ctx.mul.get(t)) || 1);        // a word found in nearly every result says little; a rare one says a lot
  let cov = 1; const fin = o => ({ ...o, cov: Math.round(cov * 1000) / 1000 });
  const qt = tokens(query);
  if (!qt.length) return fin({ match: 'exact', rank: 1 });
  const mt = tokens(main), ms = new Set(mt), es = new Set(tokens(extra || ''));
  const ds = String(dom || '').toLowerCase().replace(/\.(co\.ke|com|ke|org|net|co\.uk|co)$/, '').replace(/[^a-z0-9]/g, '');
  const inMain = qt.map(t => tokHit(t, ms) || (t.length >= 5 && !/\d/.test(t) && ds.includes(t)));
  const inAny = qt.map((t, i) => inMain[i] || tokHit(t, es));
  const W = qt.reduce((a, t) => a + wt(t), 0);
  const wMain = qt.reduce((a, t, i) => a + (inMain[i] ? wt(t) : 0), 0);
  const wAny = qt.reduce((a, t, i) => a + (inAny[i] ? wt(t) : 0), 0);
  const covW = (wMain + 0.75 * (wAny - wMain)) / W; cov = covW;
  const modelHit = qt.some((t, i) => isModel(t) && inAny[i]);
  const n = qt.length;
  const eq = (q, t) => q === t || tokHit(q, new Set([t]));
  let run = 0, at = 99;                                     // longest run of typed words that also appear together, in order
  for (let i = 0; i < n; i++) for (let p = 0; p < mt.length; p++) {
    let k = 0; while (i + k < n && p + k < mt.length && eq(qt[i + k], mt[p + k])) k++;
    if (k > run || (k === run && k > 0 && p < at)) { run = k; at = p; }
  }
  const PS = /^\d+(?:[.\/]\d+)?$/, qS = qt.filter(t => PS.test(t) && t.length <= 4), tS = mt.filter(t => PS.test(t) && t.length <= 4);
  const sizeMiss = qS.length && tS.length && !qS.some(t => tS.some(u => Math.abs(FR(t) - FR(u)) < 0.001));          // asked for 1", title says 1/2" or 3/4"
  if (sizeMiss) return fin({ match: 'loose', rank: 0, reason: 'size' });
  if (qt.some((t, i) => isBrand(t) && !inAny[i])) return fin({ match: 'loose', rank: 0, reason: 'brand' });          // asked Ingco: it must be Ingco
  const mmT = mt.filter(t => /^\d{2,3}mm$/.test(t));              // title gives the size in mm (32mm) while we asked in inches
  if (qS.length && mmT.length && !tS.length) {
    const ok = new Set(qt.filter(t => /^\d{2,3}mm$/.test(t)).map(t => parseInt(t, 10))); for (const t of qS) {   // inches converted, or the mm the person typed themselves
      const v = FR(t); [PRESS_MM[v], WASTE_MM[v], Math.round(v * 25.4)].filter(Boolean).forEach(m => ok.add(m)); }
    if (ok.size && !mmT.some(t => [...ok].some(m => Math.abs(m - parseInt(t, 10)) <= 2))) return fin({ match: 'loose', rank: 0, reason: 'size' });
  }
  const tg = typeGroups(qt), tPresent = tg.filter(g => g.some(alt => alt.every(w => tokHit(w, ms) || tokHit(w, es))));
  let typePen = 0;
  if (tg.length && tPresent.length < tg.length) {                  // a missing generic word (asked "pipe", title says "GI Stand") only costs rank when the rest matches well
    if (tg.some(g => g.strict && !tPresent.includes(g)) || covW < 0.7) return fin({ match: 'loose', rank: 0.01, soft: tPresent.length / tg.length >= 0.5, reason: 'type' });
    typePen = 0.12;
  }   // asked hose: it must be a hose
  const distinct = qt.map((t, i) => [t, i]).filter(([t]) => /^[a-z]{4,}$/.test(t) && !GENERIC.has(t) && !LOW.has(t) && !MOD.has(t) && !FORM.has(t) && !MATERIALS.includes(t) && !COLORS.includes(t) && !STOP.has(t));
  if (distinct.length && n >= 2 && !modelHit && covW < 0.9 && distinct.some(([, i]) => !inAny[i])) return fin({ match: 'loose', rank: 0.02, soft: qt.some((t, i) => /^[a-z]{4,}$/.test(t) && !GENERIC.has(t) && !LOW.has(t) && inAny[i]), reason: 'distinct' });   // the one word that names the product is missing
  const al = qt.map((t, i) => [t, i]).filter(([t]) => /^[a-z]+$/.test(t) && !LOW.has(t));
  if (al.length >= 2 && !modelHit && al.filter(([, i]) => inAny[i]).length / al.length < 0.5) return fin({ match: 'loose', rank: 0.01, soft: al.filter(([, i]) => inAny[i]).length / al.length >= 0.34, reason: 'distinct' });   // only numbers matched: wrong product (never shown, not even as 'closest')
  const qa = titleSpecs(query), ta = titleSpecs(main);
  for (const k of ['No. of gangs', 'No. of ways', 'Pressure rating']) { const a = qa.find(x => x[0] === k), b = ta.find(x => x[0] === k); if (a && b && a[1] !== b[1]) return fin({ match: 'loose', rank: 0, reason: 'spec' }); }
  const qc = qt.filter(t => COLORS.includes(t)), tc = mt.filter(t => COLORS.includes(t));
  const colMiss = qc.length && tc.length && !qc.some(c => tc.includes(c)) ? 0.25 : 0;      // asked grey, title says white
  const qH = qt.some(t => t === 'heavy' || t === 'dark'), qL = qt.includes('light'), tH = mt.some(t => t === 'heavy' || t === 'dark'), tL = mt.includes('light');
  const gaugeMiss = (qH && tL && !tH) || (qL && tH && !tL) ? 0.3 : 0;
  const exact = qt.every((t, i) => inMain[i] || LOW.has(t));
  const match = exact ? 'exact' : (covW >= 0.5 || run >= 3 || (modelHit && covW >= 0.3) ? 'near' : 'loose');
  const leadMiss = n >= 3 && /^[a-z]{4,}$/.test(qt[0]) && !LOW.has(qt[0]) && !inAny[0] ? 0.15 : 0;   // brand/lead word missing
  const brandMiss = brandCandidates(query).some(b => !ms.has(b)) ? 0.15 : 0;      // asked Makita, title says another brand
  const rank = 0.5 * covW - typePen - brandMiss - leadMiss - colMiss - gaugeMiss + 0.25 * (run / n) + (exact ? 0.1 : 0) + (modelHit ? 0.15 : 0) + (at <= 2 && run > 1 ? 0.04 : 0)
    - 0.1 * Math.min(1, Math.max(0, mt.length - n) / 25);
  return fin({ match, rank: Math.round(rank * 1000) / 1000 });
}
const score = (q, text) => analyze(q, text).match;
const BONUS = /(?:\s\+\s?(?=\S)|\s(?:plus|with|and|&)\s+(?:a\s+|an\s+)?(?:free|bonus)\b|\s(?:free|bonus)\s+(?:gift|offer)\b|\s(?:gifts?|freebies?)\b)/i;
const mainOnly = t => { const x = String(t || ''), m = BONUS.exec(x); return m && m.index >= 6 ? x.slice(0, m.index) : x; };
function haystack(title, url, name, specs) {
  let slug = '';
  try {
    const segs = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean), keepSegs = [];
    for (const g of segs) { if (/^(dp|gp|ref|product|p|sspa)$/i.test(g)) break; if (/=|^[A-Z0-9]{10}$|^\d{6,}$/.test(g)) continue; keepSegs.push(g); }
    slug = keepSegs.join(' ').replace(/[-_.]+/g, ' ');
  } catch { /* none */ }
  const keep = (specs || []).filter(([k]) => k && /^(colou?r|size|material|model|brand)$/i.test(k)).map(([, v]) => v);
  return [mainOnly(title), mainOnly(name), mainOnly(slug), ...keep].join(' ');
}

/** Alternative spellings to also search: alfa <-> alpha. */
function variants(q) {
  const alt = String(q).split(/\s+/).map(w => {
    if (w.length < 4 || /\d/.test(w)) return w;
    if (/ph/i.test(w)) return w.replace(/ph/gi, 'f');
    return /f/i.test(w) ? w.replace(/f/gi, 'ph') : w;
  }).join(' ');
  return alt.toLowerCase() === String(q).toLowerCase() ? [q] : [q, alt];
}
/** Extra, narrower searches so a model code or a feature set is looked for on its own. */
function plan(q) {
  const toks = String(q).replace(/\b([A-Z]{1,3})[\s-]+(\d{3,})\b/g, '$1$2').split(/\s+/).filter(Boolean);
  const M = toks.filter(isModel), core = toks.filter(t => !isModel(t));
  const out = [];
  if (M.length) out.push(M.join(' '));
  if (M.length && core.length > 1) out.push(core.join(' '));
  if (core.length >= 4) out.push(core.slice(0, -1).join(' '));
  return [...new Set(out.filter(x => x.toLowerCase() !== String(q).toLowerCase()))];
}
const NOISE = /^(per|metres?|meters?|mtrs?|mt|price|kenya|ksh|kes|buy|nairobi|cheap|best|online|pcs|pieces?)$/i;
const SYN = [['hose pipe', 'hosepipe', 'garden hose', 'hose'], ['faucet', 'tap'], ['bulb', 'lamp'], ['cable', 'wire'], ['basin', 'sink'], ['gate valve', 'gatevalve'], ['dark grey', 'grey heavy', 'heavy grey'], ['heavy gauge', 'heavy'], ['water tank', 'tank']];
/** Understands the query: drops filler/units, fixes fractions, swaps synonyms, joins/splits compounds, drops brand or size. */
function smart(q) {
  const base = abbr(q).replace(/(\d)\s*(?:''|[`´‘’′]{2})\s*/g, '$1" ').replace(/[`´‘’′]{2}/g, '"').replace(/½/g, '1/2').replace(/¼/g, '1/4').replace(/¾/g, '3/4').replace(/[“”″]/g, '"');
  const toks = base.split(/\s+/).filter(Boolean), keep = toks.filter(t => !NOISE.test(t));
  const core = keep.join(' ').trim(); if (!core) return [];
  const out = [core], low = core.toLowerCase();
  for (const g of SYN) for (const a of [...g].sort((x, y) => y.length - x.length).slice(0, 1).concat([])) {
    const hit = g.filter(w => new RegExp('(^|\\s)' + w.replace(/\s/g, '\\s+') + '(\\s|$)').test(low)).sort((x, y) => y.length - x.length)[0];
    if (!hit) continue;
    for (const b of g) if (b !== hit) out.push(low.replace(new RegExp('(^|\\s)' + hit.replace(/\s/g, '\\s+') + '(?=\\s|$)'), m => m.replace(hit, b)));
  }
  const noMod = keep.filter(t => !/^(dark|light|deep|heavy|gauge)$/i.test(t)); if (noMod.length < keep.length) out.push(noMod.join(' '));
  const noSize = keep.filter(t => !/\d/.test(t)); if (noSize.length >= 2 && noSize.length < keep.length) out.push(noSize.join(' '));
  if (keep.length >= 3 && /^[a-z]{4,}$/i.test(keep[0])) out.push(keep.slice(1).join(' '));   // without the brand
  return [...new Set(out.map(x => x.trim()).filter(Boolean))].slice(0, 6);
}
const expand = q => [...new Set([...variants(q), ...plan(q), ...smart(q)])];
const tidy = t => clean(String(t || '').replace(/\s+at\s+(?:the\s+)?best\s+prices?(?:\s+in\s+kenya)?\s*$/i, '').replace(/\s*opens in a new (?:window|tab)(?: or tab)?/gi, '').replace(/^new listing\s*/i, ''));

const GLOBAL = /(amazon\.|ebay\.|aliexpress\.|alibaba\.|temu\.|walmart\.|etsy\.|shein\.|banggood\.|dhgate\.|wish\.com)/i;
const isIntl = (url, store, orig) => !!orig || GLOBAL.test(domain(url)) || /^(amazon|ebay|aliexpress)/i.test(store || '');

// ---------- price / spec helpers ----------
const SYM = [[/(?:ksh|kes|k\.sh)\.?/i, 'KES'], [/us\$|usd|\$/i, 'USD'], [/£|gbp/i, 'GBP'], [/€|eur/i, 'EUR'], [/aed|dhs/i, 'AED'], [/cn¥|cny|rmb|¥/i, 'CNY'], [/₹|inr/i, 'INR']];
let RATES = { KES: 1, USD: 129, GBP: 170, EUR: 150, AED: 35, CNY: 18, INR: 1.5 };   // KSh per 1 unit (fallback; live rates loaded at start)
function setRates(perKes) { for (const k of Object.keys(RATES)) if (perKes[k] > 0) RATES[k] = 1 / perKes[k]; RATES.KES = 1; }
function curCode(c) { c = String(c || '').toUpperCase(); return c === 'KSH' ? 'KES' : c; }
/** "£12.99", "KSh 1,250", "US$ 5" -> { value: 12.99, cur: 'GBP' } */
function parseMoney(s) {
  if (s == null) return null;
  const t = String(s).replace(/\u00a0/g, ' ');
  const num = '([\\d][\\d,]*(?:\\.\\d{1,2})?)';
  for (const [re, cur] of SYM) {
    const m = t.match(new RegExp('(?:' + re.source + ')\\s?' + num, 'i')) || t.match(new RegExp(num + '\\s?(?:' + re.source + ')', 'i'));
    if (m) { const v = Number(m[1].replace(/,/g, '')); if (v > 0) return { value: v, cur }; }
  }
  return null;
}
function fmtOrig(m) { const sym = { USD: '$', GBP: '£', EUR: '€', AED: 'AED ', CNY: 'CN¥', INR: '₹' }[m.cur] || m.cur + ' '; return sym + m.value.toLocaleString('en-US'); }
/** -> { price (KSh), orig ('£12.99' or '') } */
function inKes(m) { return m ? { price: Math.round(m.value * (RATES[m.cur] || 0)), hi: m.hi ? Math.round(m.hi * (RATES[m.cur] || 0)) : 0, orig: m.cur === 'KES' ? '' : fmtOrig(m) } : null; }
function parsePrice(s) { const m = parseMoney(s); return m && m.cur === 'KES' ? m.value : null; }
const COLORS = ['white', 'black', 'silver', 'grey', 'gray', 'gold', 'blue', 'red', 'green', 'yellow', 'brown', 'pink', 'orange', 'clear', 'chrome', 'cream', 'ivory'];
/** Key attributes read from a title (or any text): size, material, gangs, ways, current, voltage, power, capacity, length, colour, pack. */
function titleSpecs(title) {
  const out = [], T = String(title || '').replace(/(\d)\s*(?:''|[`´‘’′]{2})/g, '$1"').replace(/[`´‘’′]{2}/g, '"'), t = ' ' + T.toLowerCase() + ' ';
  const add = (k, v) => { if (v && !out.some(([x]) => x === k)) out.push([k, clean(v)]); };
  const size = T.match(/(\d+\s\d\/\d\s*(?:"|”|inch(?:es)?\b)|\d+(?:[.\/]\d+)?\s*(?:"|”|inch(?:es)?\b|mm\b|cm\b))/i); if (size) add('Size', size[1]);
  const n = ' ' + norm(T) + ' ', mat = MATERIALS.find(m => n.includes(' ' + m + ' ')); if (mat) add('Material', mat.length <= 4 ? mat.toUpperCase() : mat[0].toUpperCase() + mat.slice(1));
  let m;
  if ((m = t.match(/(\d)\s*[- ]?gangs?\b/) || t.match(/\b(one|two|three|four)\s*gangs?\b/))) add('No. of gangs', m[1]);
  if ((m = t.match(/(\d)\s*[- ]?(?:way|ways)\b/))) add('No. of ways', m[1]);
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:a|amps?|amperes?)\b/)) && (/amp/.test(m[0]) || m[1].length >= 2 || /\./.test(m[1]))) add('Current', m[1] + 'A');
  if ((m = t.match(/(\d+(?:\.\d+)?(?:\s*-\s*\d+)?)\s*(?:v|volts?|vac|vdc)\b/))) add('Voltage', m[1].replace(/\s/g, '') + 'V');
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(kw|w|watts?|hp)\b/))) add('Power', m[1] + (m[2][0] === 'w' ? 'W' : m[2].toUpperCase()));
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:l|ltrs?|litres?|liters?)\b/))) add('Capacity', m[1] + 'L');
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|mtrs?|mt|metres?|meters?|m)\b/))) add('Length', m[0].trim());
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:bar|psi)\b/))) add('Pressure', m[0].trim());
  if ((m = t.match(/(\d+)\s*(?:pcs|pieces|pack|pc|set)\b/))) add('Pack', m[0].trim());
  const col = COLORS.find(c => t.includes(' ' + c + ' ') || t.includes(' ' + c + ',')); if (col) add('Colour', col[0].toUpperCase() + col.slice(1));
  const hose = /\b(hose|hosepipe|shower|extension|garden)\b/.test(t);
  if (/\bpipes?\b/.test(t) && !hose) {
    add('Pipe type', /\b(waste|soil|drain|drainage|sewer)\b/.test(t) ? 'Waste / drainage' : /\bconduit\b/.test(t) ? 'Conduit' : /\b(pressure|water|class|pn\s?\d)/.test(t) ? 'Pressure (water)' : '');
  }
  if ((m = t.match(/\bpn\s?-?(\d+(?:\.\d+)?)\b/))) add('Pressure rating', 'PN' + m[1]);
  else if ((m = t.match(/\bclass\s?([a-e])\b/))) add('Pressure rating', 'Class ' + m[1].toUpperCase());
  return derive(out, t);
}
const FR = v => { v = String(v).trim(); let m = v.match(/^(\d+)\s+(\d)\/(\d)$/); if (m) return +m[1] + m[2] / m[3]; m = v.match(/^(\d)\/(\d)$/); if (m) return m[1] / m[2]; return parseFloat(v) || 0; };
// nominal inch -> outside diameter (mm) of standard PVC pipe
const WASTE_MM = { 1.25: 32, 1.5: 40, 2: 50, 3: 75, 4: 110, 6: 160 };
const PRESS_MM = { 0.5: 20, 0.75: 25, 1: 32, 1.25: 40, 1.5: 50, 2: 63, 2.5: 75, 3: 90, 4: 110, 5: 140, 6: 160, 8: 200 };
/** Works out what the listing doesn't say: diameter in mm from an inch size, length in metres from feet. */
function derive(list, text) {
  const has = re => list.some(([k]) => re.test(k)), val = re => { const f = list.find(([k]) => re.test(k)); return f ? f[1] : ''; };
  const out = list.slice(), add = (k, v) => { if (!has(new RegExp('^' + k.replace(/[()]/g, '\\$&') + '$', 'i'))) out.push([k, v]); };
  const sz = val(/^size$/i).match(/^(\d+\s\d\/\d|\d+(?:[.\/]\d+)?)\s*(?:"|”|inch)/i);
  if (sz && !has(/diameter/i)) {
    const inch = FR(sz[1]), type = val(/pipe type/i);
    if (type) { const mm = (/waste/i.test(type) ? WASTE_MM : PRESS_MM)[inch]; if (mm) add('Diameter (mm)', '≈' + mm + ' mm'); }
    else if (/\b(hose|hosepipe)\b/.test(text || '')) add('Diameter (mm)', '≈' + Math.round(inch * 25.4 * 10) / 10 + ' mm');
    else add('Size (mm)', '≈' + Math.round(inch * 25.4) + ' mm');
  }
  const ln = val(/^length$/i).match(/^(\d+(?:\.\d+)?)\s*(ft|feet)$/i);
  if (ln && !has(/length \(m\)/i)) add('Length (m)', '≈' + Math.round(ln[1] * 0.3048 * 10) / 10 + ' m');
  return out;
}
function descBullets(d) {
  const t = cheerio.load('<div>' + String(d || '') + '</div>').text();
  return t.split(/\n|•|;|\. |•/).map(clean).filter(x => x.length >= 8 && x.length <= 120 && !/shop now|best deals|free shipping|fast shipping|customer support|add to cart|buy now|click here|subscribe|cookies?/i.test(x)).slice(0, 3);
}

function ldProducts($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, e) => {
    let j; try { j = JSON.parse($(e).contents().text()); } catch { return; }
    const walk = n => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      if ([].concat(n['@type'] || []).includes('Product')) out.push(n);
      if (n['@graph']) walk(n['@graph']);
    };
    walk(j);
  });
  return out;
}
function ldPrice(p) {
  for (const o of [].concat(p.offers || [])) {
    const cur = curCode(o.priceCurrency) || 'KES';
    const v = o.price ?? o.lowPrice ?? (o.priceSpecification && o.priceSpecification.price);
    const n = Number(String(v ?? '').replace(/,/g, '')), hi = Number(String(o.highPrice ?? '').replace(/,/g, '')) || 0;
    if (n > 0 && RATES[cur]) return { value: n, cur, hi: hi > n ? hi : 0 };
  }
  return null;
}

/** Reads price, name, image and specs out of a product page. */
function extract(html) {
  const $ = cheerio.load(html);
  const r = { price: null, money: null, name: '', image: '', specs: [], confident: false };
  const prod = ldProducts($);
  for (const p of prod) {
    const pr = ldPrice(p);
    if (pr && !r.price) {
      r.money = pr; r.price = pr.value; r.confident = true; r.name = clean(p.name);
      const img = [].concat(p.image || [])[0];
      r.image = typeof img === 'string' ? img : (img && img.url) || '';
      const brand = typeof p.brand === 'string' ? p.brand : p.brand && p.brand.name;
      if (brand) r.specs.push(['Brand', clean(brand)]);
      for (const k of ['material', 'size', 'color', 'model']) if (typeof p[k] === 'string' && p[k]) r.specs.push([k[0].toUpperCase() + k.slice(1), clean(p[k])]);
      for (const a of [].concat(p.additionalProperty || [])) if (a && a.name && a.value) r.specs.push([clean(a.name), clean(a.value)]);
      descBullets(p.description).forEach(b => r.specs.push([null, b]));
    }
  }
  if (!r.price) {
    const meta = $('meta[property="product:price:amount"],meta[property="og:price:amount"],meta[itemprop="price"]').first().attr('content');
    const cur = curCode($('meta[property="product:price:currency"],meta[property="og:price:currency"],meta[itemprop="priceCurrency"]').first().attr('content')) || 'KES';
    const n = Number(String(meta || '').replace(/,/g, ''));
    if (n > 0 && RATES[cur]) { r.money = { value: n, cur }; r.price = n; r.confident = true; }
  }
  const og = String($('meta[property="og:type"]').attr('content') || '').toLowerCase();
  const amounts = new Set($('[class*=price],[itemprop=price]').toArray().slice(0, 80).map(e => parseMoney(clean($(e).text()))).filter(Boolean).map(m => m.value));
  r.isProduct = prod.length > 0 || /product/.test(og) || !!$('meta[property="product:price:amount"],[itemtype*="schema.org/Product"],form.cart,.single_add_to_cart_button,.product_title,[name="add-to-cart"]').length || amounts.size <= 3;
  if (!r.isProduct) { r.price = null; r.money = null; r.confident = false; }          // a category page listing many items: its prices belong to other products
  const h1 = clean($('h1').first().text());
  if (!r.name) r.name = h1 || clean($('meta[property="og:title"]').attr('content'));
  if (!r.image) r.image = $('meta[property="og:image"]').attr('content') || '';
  if (!r.price && h1 && r.isProduct) {   // last resort: first KSh price printed right after the main heading
    const body = $('body').clone(); body.find('script,style,noscript').remove();
    const txt = body.text().replace(/\s+/g, ' ');
    const i = txt.indexOf(h1.slice(0, 40));
    if (i >= 0) { const m = parseMoney(txt.slice(i, i + 1500)); if (m) { r.money = m; r.price = m.value; } }
  }
  if (!r.price && r.isProduct) {   // any element whose class/id says "price"
    for (const e of $('[itemprop=price],[class*=price],[id*=price]').toArray().slice(0, 30)) {
      const t = clean($(e).text()); if (t.length > 60) continue;
      const m = parseMoney(t); if (m && m.value > 0) { r.money = m; r.price = m.value; break; }
    }
  }
  if (r.specs.length < 3) {
    const tbls = $('table[class*=spec],table[class*=attr],table[class*=additional],table.woocommerce-product-attributes,table').toArray();
    for (const t of tbls) {
      const rows = [];
      $(t).find('tr').each((_, tr) => {
        const c = $(tr).find('th,td').map((_, x) => clean($(x).text())).get();
        if (c.length === 2 && c[0] && c[1] && c[0].length < 40 && c[1].length < 80 && !/^(\.{2,}|-+|n\/a)$/i.test(c[1]) && !/^(sku|production country|certifications?)$/i.test(c[0])) rows.push([c[0], c[1]]);
      });
      if (rows.length >= 2) { r.specs.push(...rows.slice(0, 6)); break; }
    }
  }
  if (r.specs.length < 2) {
    const d = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content');
    descBullets(d).forEach(b => r.specs.push([null, b]));
  }
  return r;
}

/** Pages that list one price per size in a table (Size | Price per m): returns the row for the size asked. */
function tableRow(html, q) {
  const want = tokens(q).filter(t => /^\d+(?:[.\/]\d+)?$/.test(t) && t.length <= 4);
  if (!want.length) return null;
  const $ = cheerio.load(html);
  for (const tb of $('table').toArray()) {
    const rows = [];
    $(tb).find('tr').each((_, tr) => {
      const c = $(tr).find('th,td').map((_, x) => clean($(x).text())).get();
      if (c.length >= 2 && c[0].length <= 30 && /\d/.test(c[0])) { const m = c.slice(1).map(parseMoney).find(Boolean); if (m) rows.push({ label: c[0], money: m }); }
    });
    if (rows.length < 2) continue;
    const hit = rows.find(r => tokens(r.label).some(t => want.includes(t)));
    if (hit) return hit;
  }
  return null;
}
/** The price Google itself shows for a result (the one next to "In stock"), not an installment or shipping figure. */
function snippetPrice(sn) {
  sn = String(sn || '');
  const m = sn.match(/(?:ksh|kes|k\.?sh)\.?\s?[\d,]+(?:\.\d+)?(?=\s*[·•]\s*(?:in stock|out of stock|available))/i) || sn.match(/sale price\s*(?:ksh|kes)\.?\s?[\d,]+(?:\.\d+)?/i);
  if (m) return /(?:\bto|[–—-])\s*$/i.test(sn.slice(Math.max(0, m.index - 8), m.index)) ? null : parseMoney(m[0]);
  const f = sn.match(/(?:ksh|kes|k\.?sh)\.?\s?[\d,]+(?:\.\d+)?(?:\s*(?:[–—-]|to)\s*(?:ksh|kes))?/i);
  return f && !/[–—-]|to/i.test(f[0].slice(4)) ? parseMoney(f[0]) : null;       // "KSh 135 – KSh 1,050" is a range, not this item's price
}
/** "KSh 47.00 to Ksh 2,822.00" -> { value: 47, hi: 2822, cur: 'KES' } (a product sold in several sizes). */
function priceRange(sn) {
  const m = String(sn || '').match(/(?:ksh|kes|k\.?sh)\.?\s?([\d,]+(?:\.\d+)?)\s*(?:[–—-]|to)\s*(?:(?:ksh|kes|k\.?sh)\.?\s?)?([\d,]+(?:\.\d+)?)/i);
  if (!m) return null;
  const lo = Number(m[1].replace(/,/g, '')), hi = Number(m[2].replace(/,/g, ''));
  return lo > 0 && hi > lo ? { value: lo, hi, cur: 'KES' } : null;
}
/** Shop pages with a size/pressure dropdown (WooCommerce): returns the variation that matches the query, or {skip:true} if that size isn't offered. */
function variationRow(html, q) {
  const $ = cheerio.load(html), raw = $('[data-product_variations]').first().attr('data-product_variations');
  if (!raw) return null;
  let vs; try { vs = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(vs) || !vs.length) return null;
  const T = tokens(q), nums = T.filter(t => /^\d+(?:[.\/]\d+)?$/.test(t) && t.length <= 4), pn = (String(q).match(/\bpn\s?-?(\d+)/i) || [])[1];
  const mmQ = T.filter(t => /^\d+mm$/.test(t)).map(t => parseInt(t, 10));
  if (!nums.length && !mmQ.length && !pn) return null;
  const inch = new Set(nums), mm = new Set(mmQ);
  for (const t of nums) { const v = FR(t); [PRESS_MM[v], WASTE_MM[v], Math.round(v * 25.4)].filter(Boolean).forEach(m => mm.add(m)); }
  const wantsSize = nums.length > 0 || mmQ.length > 0;
  for (const v of vs) {
    const vals = Object.values(v.attributes || {}).filter(Boolean), label = vals.join(', '), flat = label.replace(/[-_]/g, ' ').toLowerCase();
    if (!vals.length || !v.display_price) continue;
    const sizeOk = !wantsSize || tokens(flat).some(t => NUMTOK.test(t) && [...inch].some(n => Math.abs(FR(t) - FR(n)) < 0.001)) || [...mm].some(m => new RegExp('(^|\\D)' + m + '\\s?mm').test(flat));
    const pnOk = !pn || new RegExp('pn\\s?' + pn + '\\b').test(flat) || !/pn\s?\d/.test(flat);
    if (sizeOk && pnOk) return { label, money: { value: Number(v.display_price), cur: 'KES' }, image: v.image && v.image.src };
  }
  return wantsSize ? { skip: true } : null;       // the page sells this product, just not in that size
}
const specText = specs => (specs || []).map(([, v]) => v).join(' ');

function mergeSpecs(...lists) {
  const seen = new Set(), out = [];
  for (const l of lists) for (const [k, v] of l || []) {
    const key = (k || v).toLowerCase();
    if (seen.has(key)) continue; seen.add(key); out.push([k, v]);
  }
  return derive(out, out.map(x => x[1]).join(' ').toLowerCase()).slice(0, 9);
}

// ---------- network ----------
const BLOCKED = new Set();                                   // shops that answer plain requests with a bot-check page (need a real browser window)
const isBlocked = h => BLOCKED.has(String(h).replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''));
const CHALLENGE = /imunify|bot.?check|captcha|just a moment|checking your browser|cf-chl|access denied|enable javascript/i;
async function fetchPage(url, ms) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-KE,en;q=0.9' },
    redirect: 'follow', signal: AbortSignal.timeout(ms || 4500),
  });
  if (!r.ok) { LOG(domain(url), url.slice(0, 80), 'HTTP ' + r.status, 0); if ([401, 403, 429, 503].includes(r.status)) BLOCKED.add(domain(url)); return null; }
  if (!(r.headers.get('content-type') || '').includes('html')) return null;
  const t = (await r.text()).slice(0, 1500000);
  if (t.length < 6000 && CHALLENGE.test(t)) { LOG(domain(url), url.slice(0, 80), 'bot-check page', 0); BLOCKED.add(domain(url)); return null; }
  return t;
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); } catch { /* skip */ } }
  }));
}

// ---------- shop routing: a brand name or a shop's own product code sends the search to that shop first ----------
let LEARNED = {};                                   // CODE-PREFIX -> { shop: count }, e.g. KS -> { 'nemsiholdings.co.ke': 4 }
const BRAND = { zebra: ['aliglaziers.co.ke', 'vmart.co.ke'], 'pipe': [], king: ['aliglaziers.co.ke'] };   // brand word -> shops that sell it
/** Brand -> its official site (searched before any shop). Add more as: name: 'site/path'. */
const BRAND_SITES = { ingco: 'ingco.com/ke', schneider: 'se.com', bosch: 'bosch-professional.com', dewalt: 'dewalt.com', stanley: 'stanleytools.com', 'tp-link': 'tp-link.com/ke', tplink: 'tp-link.com/ke' };
const GENERIC = new Set(('pipe pipes hose hosepipe wrench spanner switch gang way waste soil suction valve gate tap taps mixer bulb bulbs lamp cable wire socket plug kettle tank sink basin bracket hinge lock door handle screw bolt nut nail drill saw hammer pliers tape paint brush roller ladder pump motor fan heater iron cooker fridge phone laptop charger adapter battery light led solar panel inverter generator trap bend elbow tee coupling union reducer clip cap strainer filter meter gauge pressure heavy grey gray ' +
  'kitchen bathroom toilet shower tile tiles cement sand stone door window glass mirror table chair sofa bed mattress shelf cabinet drawer rack basket bucket bin box bag pack set kit roll sheet plate board plank timber wood steel iron metal plastic rubber foam sponge cloth towel soap oil gas fuel water electric electrical power extension cord breaker fuse bell sensor camera lock padlock chain rope clamp pulley wheel tyre tire bearing belt gear spring washer rivet staple glue silicone sealant primer varnish thinner mop broom dustpan gloves boots helmet goggles mask apron overall uniform ' +
  'cutter cutters threader tester level chisel rasp vice vise jack tool tools connector fitting fittings nozzle sprinkler cordless wireless rechargeable portable digital automatic adjustable professional industrial universal waterproof original genuine new used heavy duty light medium large small big long short wide thin thick round square flat flexible rigid male female straight angle left right inch inches foot feet metre meter litre liter size price kenya nairobi per each pair piece pieces').split(/\s+/));
/** Words in the query that could be a brand: not a product word, colour, material, unit or number. */
const brandCandidates = q => [...new Set(tokens(q).filter(t => /^[a-z][a-z-]{2,14}$/.test(t) && !GENERIC.has(t) && !STOP.has(t) && !LOW.has(t) && !MATERIALS.includes(t) && !COLORS.includes(t) && !BRAND_SITES[t]))].slice(0, 3);
const KNOWN_BRANDS = new Set('ingco makita bosch dewalt stanley schneider philips samsung hisense tecno infinix xiaomi oppo apple iphone ipad macbook airpods galaxy redmi realme vivo sony hp dell lenovo asus acer ramtons hotpoint nokia huawei hikvision dahua tefal kenwood tp-link tplink sandstorm mika'.split(' ').map(b => norm(b).trim()));   // normalised the same way as query tokens (iphone -> ifone)
let DISCOVERED = new Set();                                       // brands whose own site the app found (set from main.js)
const setBrands = list => { DISCOVERED = new Set(list || []); };
const FORM = new Set('roll rolls coil round square flat rectangular oval tube tubing class type size grade standard quality original new price best'.split(' '));
const isBrand = t => KNOWN_BRANDS.has(t) || !!BRAND_SITES[t];          // only brands we are sure of are mandatory; discovered ones just rank higher
const MOD = new Set('set kit pack pcs piece pair combo bundle original genuine new used heavy gauge duty professional industrial universal waterproof cordless wireless rechargeable portable digital automatic adjustable large small big long short flexible quick medium light thin thick round square flat rigid male female straight angle left right quality best cheap dark deep'.split(' '));
const TYPE_SYN = [['hose pipe', 'hosepipe', 'garden hose', 'hose'], ['suction pipe', 'suction hose'], ['gate valve', 'gatevalve'], ['faucet', 'tap'], ['bulb', 'lamp'], ['cable', 'wire']];
/** What the product IS (hose, pipe, wrench, switch...): groups of alternatives, each group must be present. Everything else is optional. */
function typeGroups(qt) {
  const text = ' ' + qt.join(' ') + ' ', used = new Set(), groups = [];
  for (const g of TYPE_SYN) {
    const hit = [...g].sort((a, b) => b.length - a.length).find(a => text.includes(' ' + a + ' '));
    if (!hit) continue;
    hit.split(' ').forEach(w => used.add(w));
    const grp = g.map(a => a.split(' ')); grp.strict = true; groups.push(grp);
  }
  const rollish = qt.includes('roll') || qt.includes('hdpe') || qt.includes('coil');
  for (const t of qt) if (t === 'pipe' && rollish && !used.has(t)) { groups.push([['pipe'], ['roll'], ['coil'], ['tube']]); used.add(t); used.add('roll'); used.add('coil'); }
  for (const t of qt) if (!used.has(t) && GENERIC.has(t) && !MOD.has(t) && !COLORS.includes(t) && !LOW.has(t) && !isBrand(t) && /^[a-z]{3,}$/.test(t)) groups.push([[t]]);
  return groups;
}
const LEXTRA = ('flush elbow nipple bushing flange gasket sealant silicone wye bend reducer coupling adaptor adapter valve float cistern toilet closet basin sink shower mixer faucet hosepipe tube tubing conduit trunking cable wire socket switch breaker isolator fuse bulb lamp tank pump borehole submersible galvanized galvanised stainless aluminium aluminum copper brass steel iron plastic cement paint primer thinner varnish roofing nail screw bolt washer rivet hinge padlock drill grinder hammer spanner wrench pliers blade brush roller trowel ladder wheelbarrow gloves helmet boots goggles extension charger battery inverter solar panel regulator cylinder burner cooker heater kettle angle channel purlin tubular rectangular square round sheet plate mesh barbed fencing gutter downpipe manhole trap stopcock tap hose connector clamp saddle union plug');
let LEXSET = null;
const lexicon = () => LEXSET || (LEXSET = new Set([...LEXTRA.split(' '), ...GENERIC, ...MATERIALS.flatMap(m => m.split(' '))].filter(w => /^[a-z]{4,}$/.test(w))));
/** "Flash Pipe" -> "Flush Pipe": only words that are not trade words and sit one edit from exactly one trade word. */
function fixTypos(q) {
  const L = lexicon();
  return String(q).split(/(\s+)/).map(w => {
    const k = w.toLowerCase();
    if (!/^[a-z]{5,}$/.test(k) || L.has(k) || KNOWN_BRANDS.has(k) || BRAND_SITES[k]) return w;
    const c = [...L].filter(l => l.length >= 4 && Math.abs(l.length - k.length) <= 1 && l !== k.slice(0, -1) && k !== l.slice(0, -1) && lev(k, l) === 1);
    if (c.length !== 1) return w;
    return w[0] === w[0].toUpperCase() ? c[0][0].toUpperCase() + c[0].slice(1) : c[0];
  }).join('');
}
const officialSites = q => [...new Set(tokens(q).map(t => BRAND_SITES[t]).filter(Boolean))];
const SEED = { KS: 'nemsiholdings.co.ke', SH: 'nemsiholdings.co.ke' };
const setLearned = o => { LEARNED = o && typeof o === 'object' ? o : {}; };
function targetShops(q) {
  const out = new Set();
  const toks = tokens(String(q).replace(/\b([A-Z]{1,3})[\s-]+(\d{3,})\b/g, '$1$2'));
  for (const d of SHOPS) {
    const label = d.replace(/^www\./, '').split('.')[0].toLowerCase();       // nemsiholdings
    for (const t of toks) if (t.length >= 4 && !/\d/.test(t) && (label.startsWith(t) || (t.length >= 5 && label.includes(t)))) out.add(d);
  }
  for (const t of toks) for (const d of BRAND[t] || []) if (SHOPS.includes(d)) out.add(d);
  for (const t of toks) {
    const m = t.match(/^([a-z]{1,3})\d{3,}/); if (!m) continue;
    const P = m[1].toUpperCase();
    if (SEED[P] && SHOPS.includes(SEED[P])) out.add(SEED[P]);
    for (const [d, c] of Object.entries(LEARNED[P] || {})) if (c >= 2 && SHOPS.includes(d)) out.add(d);
  }
  return [...out];
}
function learnFrom(offers) {                          // remember which shop uses which product-code prefix
  for (const o of offers) {
    const d = domain(o.url); if (!SHOPS.includes(d)) continue;
    const seenP = new Set();
    const m = String(o.title).match(/^\W*([A-Za-z]{1,3})-?\d{3,5}\b/);          // a shop's own code leads its product titles
    if (m) seenP.add(m[1].toUpperCase());
    for (const P of seenP) { LEARNED[P] = LEARNED[P] || {}; LEARNED[P][d] = (LEARNED[P][d] || 0) + 1; }
  }
}

// ---------- main search ----------
const cache = new Map();
const TTL = 30 * 60 * 1000;

async function searchProduct(q, cfg, emit, isLive) {
  const key = q.toLowerCase().trim() + '|' + (cfg.country || 'ke');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) {
    emit({ type: 'offers', offers: hit.offers }); emit({ type: 'done' }); return;
  }
  const QS = [...new Set([q, fixTypos(q)])], A = (m, e, d, c) => QS.map(x => analyze(x, m, e, d, c)).reduce((a, b) => (b.rank > a.rank ? b : a));
  const seen = new Map(), urlKeys = new Set(), soft = [], webBuf = [], related = [];
  let raw = 0, webOpen = false, errored = false;
  const live = () => !isLive || isLive();
  let dropped = 0; const drop = (store, title, an) => { if (dropped++ < 40) LOG('dropped', clean(title).slice(0, 70), store + ' | ' + (an.reason || 'loose') + ' cov=' + an.cov, 0); };
  const add = list => {
    const fresh = list.filter(o => { const k = String(o.url).split('#')[0] + '|' + (o.price || 0); if (seen.has(o.id) || urlKeys.has(k)) return false; urlKeys.add(k); return true; });
    fresh.forEach(o => seen.set(o.id, o));
    if (fresh.length && live()) { if (errored) { errored = false; emit({ type: 'ok' }); } emit({ type: 'offers', offers: fresh }); }
  };
  const patch = (o, p) => { Object.assign(o, p); if (live()) emit({ type: 'update', id: o.id, patch: p }); };

  if (QS.length > 1 && (!isLive || isLive())) emit({ type: 'corrected', text: QS[1] });
  const tgt = targetShops(q), tried = new Set(tgt), all = [], track = p => (all.push(p), p);
  const boost = url => (tgt.includes(domain(url)) ? 0.25 : 0);   // the shop the query points to goes on top

  const NOFETCH = ['amazon.', 'ebay.', 'aliexpress.', 'google.'];   // bot-protected: keep the listing as read, don't re-open
  const runSource1 = (src, qq) => src(qq).then(async j => {
    const offers = [];
    for (const it of j.shopping || []) {
      const k = inKes(parseMoney(it.price));
      if (!k || !k.price || !it.link) continue;
      it.title = tidy(it.title);
      const an = A(haystack(it.title, it.link, '', titleSpecs(it.title)), '', domain(it.link));
      raw++;
      const item = {
        id: hash(it.link + '|' + it.title), src: 'shopping', store: clean(it.source) || (domain(it.link).includes('google.') ? 'Google Shopping' : domain(it.link)),
        title: clean(it.title), price: k.price, orig: k.orig, intl: isIntl(it.link, it.source, k.orig), url: it.link, image: it.imageUrl || '', specs: titleSpecs(it.title),
        match: an.match, rank: an.rank + boost(it.link), bonus: boost(it.link), verified: NOFETCH.some(d => domain(it.link).includes(d)),
      };
      const rg = k.orig ? null : priceRange(it.price); item.hi = rg ? Math.round(rg.hi) : k.hi; item.from = item.hi > k.price;   // "KSh 2,300 – KSh 22,000" = from 2,300
      if (an.match === 'loose') { drop(item.store, it.title, an); if (an.soft) soft.push({ ...item, match: 'near', verified: true }); else if (!['brand', 'size', 'spec', 'distinct'].includes(an.reason) && !item.intl && an.cov >= 0.3 && (an.reason !== 'type' || an.cov >= 0.7)) related.push({ ...item, match: 'related', rank: an.cov * 0.4 + boost(it.link) }); continue; }
      offers.push(item);
    }
    add(offers);
    track(pool(offers.filter(o => !o.verified), 14, async o => {
      const html = await fetchPage(o.url, 3500); if (!html) { patch(o, { verified: true }); return; }
      const x = extract(html), vr = variationRow(html, q);
      const p = { verified: true, specs: mergeSpecs(o.specs, x.specs) };
      if (vr && !vr.skip) { const k = inKes(vr.money); p.price = k.price; p.orig = k.orig; p.from = false; p.hi = 0; p.title = o.title + ' (' + vr.label + ')'; if (vr.image) p.image = vr.image; }
      else if (x.confident && x.money) { const k = inKes(x.money); p.price = k.price; p.orig = k.orig; p.hi = k.hi; p.from = k.hi > k.price || !!(vr && vr.skip); }
      if (!o.image && x.image) p.image = x.image;
      const a2 = A(haystack(o.title, o.url, x.name, p.specs), specText(p.specs), domain(o.url));
      const r2 = a2.rank + boost(o.url) - (vr && vr.skip ? 0.15 : 0);
      if (r2 > o.rank) { p.rank = r2; if (a2.match === 'exact' || o.match === 'loose') p.match = a2.match; }
      patch(o, p);
    }).catch(() => {}));
  });

  const runSource = (src, qs = QS) => Promise.all(qs.map(qq => runSource1(src, qq).catch(() => {})));
  const runWeb1 = qq => cfg.providers.web(qq).then(async j => {
    const urls = [];
    for (const it of j.organic || []) {
      if (skipDomain(domain(it.link))) continue;
      urls.push(it);
    }
    const off = officialSites(q), isOff = l => off.some(x => String(l).replace(/^https?:\/\/(www\.)?/, '').startsWith(x.split('/')[0]) && String(l).includes(x.split('/')[0]));
    urls.sort((a, b) => (b.official || isOff(b.link) ? 1 : 0) - (a.official || isOff(a.link) ? 1 : 0));          // the brand's own pages first
    const known = it => (tgt.includes(domain(it.link)) ? 2 : 0) + (it.official || isOff(it.link) ? 3 : 0) + (it.gpos != null && it.gpos < 5 ? 1 : 0);
    urls.sort((a, b) => known(b) - known(a));
    if (cfg.providers.siteSearch) {                                   // any Kenyan shop the web shows is searched directly too (its own search, all its matching products)
      let n = 0;
      for (const it of urls) {
        const d = domain(it.link);
        if (n >= 6 || tried.has(d) || SHOPS.includes(d) || GLOBAL.test(d) || !(d.endsWith('.ke') || /kenya|ksh|nairobi/i.test(it.title + ' ' + (it.snippet || '')))) continue;
        tried.add(d); n++;
        track(runSource(cfg.providers.siteSearch(d, false), [q]).catch(() => {}));
      }
    }
    const pages = urls.filter(u => !u.lead);                          // a 'lead' only names a shop (its home page): the shop is searched above, the page itself isn't a listing
    await pool(pages.slice(0, 18), 14, async it => {
      let html = null;
      try { html = await fetchPage(it.link, 3500); } catch { /* retry below */ }
      const x = html ? extract(html) : { money: null, name: '', image: '', specs: [], isProduct: true };
      const row = html ? (tableRow(html, q) || variationRow(html, q)) : null;
      const sizeGone = !!(row && row.skip);                               // the page sells it, but not in that size
      let money = row && !row.skip ? row.money : x.money;
      if (!money && it.snippet && x.isProduct) money = snippetPrice(it.snippet) || priceRange(it.snippet);   // page blocked us: use the price the search engine shows
      const k = money ? inKes(money) : { price: 0, hi: 0, orig: '' };
      let title = (x.name || clean(it.title)) + (row ? ' (' + row.label + ')' : '');
      const official = !!it.official || isOff(it.link);
      if (official) { const b = it.brand || tokens(q).find(t => BRAND_SITES[t]); if (b && !title.toLowerCase().includes(b)) title = b.toUpperCase() + ' ' + title; }
      const an = A(haystack(title, it.link, it.title, x.specs), specText(x.specs) + ' ' + (it.snippet || ''), domain(it.link));
      let match = an.match, rank = an.rank - (sizeGone ? 0.15 : 0) - (k.price ? 0 : 0.25) - (x.isProduct ? 0 : 0.2);
      if (it.gpos != null && it.gpos < 10 && !['brand', 'size', 'spec', 'type', 'distinct'].includes(an.reason)) { if (match === 'loose') match = 'near'; rank += it.gpos < 3 ? 0.2 : 0.1; }   // Google ranked it
      if (official && match !== 'loose') rank += 0.6;                 // the brand's own page goes on top
      raw++; if (!clean(it.title) && !x.name) return;                  // nothing readable at all (a page we couldn't open still shows by its search title)
      const wo = {
        id: hash(it.link + '|' + title), src: 'web', store: domain(it.link) + (official ? ' (official)' : ''), title, orig: k.orig, intl: isIntl(it.link, '', k.orig), url: it.link,
        image: (row && row.image) || x.image, specs: mergeSpecs(titleSpecs(title), x.specs), match, rank: rank + boost(it.link), verified: !!html,
        price: k.price || null, hi: k.hi, from: k.hi > k.price || sizeGone,
      };
      wo.bonus = wo.rank - an.rank;
      if (match === 'loose') { drop(wo.store, title, an); if (an.soft) soft.push({ ...wo, match: 'near' }); else if (!['brand', 'size', 'spec', 'distinct'].includes(an.reason) && !wo.intl && an.cov >= 0.3 && (an.reason !== 'type' || an.cov >= 0.7)) related.push({ ...wo, match: 'related', rank: an.cov * 0.4 + boost(it.link) }); return; }
      if (official || webOpen || tgt.includes(domain(it.link))) add([wo]); else webBuf.push(wo);        // Google is the fallback: held back until the shops have answered
    });
  });

  const runWeb = () => Promise.all(QS.map(qq => runWeb1(qq).catch(() => {})));

  // Everything starts at once; results stream to the screen as they arrive. Hard stop at 8 s (5 s once there are plenty of results).
  const t0 = Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms));
  const shopFns = cfg.providers.shopMap || {};
  const discP = cfg.providers.discover ? cfg.providers.discover(q, (host, words) => {           // a brand / model code / site named in the query was identified: search that site first
    if (tried.has(host)) return; tried.add(host); tgt.push(host);
    if (live()) emit({ type: 'targets', shops: [...tgt] });
    const rest = String(q).split(/\s+/).filter(w => !words.includes(w.toLowerCase().replace(/[^a-z0-9]/g, ''))).join(' ').trim();
    track(runSource(cfg.providers.siteSearch(host, true), [...new Set([q, rest].filter(Boolean))]).catch(() => {}));
  }).catch(() => {}) : Promise.resolve();
  const firstFns = tgt.map(d => shopFns[d]).filter(Boolean);
  if (tgt.length && live()) emit({ type: 'targets', shops: [...tgt] });
  const firstRuns = firstFns.map(f => runSource(f));
  const shopRuns = Object.values(shopFns).filter(f => !firstFns.includes(f)).map(f => runSource(f));
  const slowRuns = (cfg.providers.slow || []).map(f => runSource(f));
  const webP = runWeb().catch(() => {});
  all.push(...firstRuns, ...shopRuns, ...slowRuns, webP, discP);
  let intlStarted = false;
  const openWeb = () => {
    webOpen = true; add(webBuf.splice(0));
    const good = [...seen.values()].filter(o => !o.intl && o.match !== 'loose' && o.rank >= 0.45).length;
    if (!intlStarted && good < 6) { intlStarted = true; (cfg.providers.intl || []).forEach(f => track(runSource(f))); }   // foreign shops only when Kenya has little
  };
  Promise.race([Promise.allSettled([...firstRuns, ...shopRuns, webP, discP]), sleep(3000)]).then(openWeb);
  await new Promise(res => {
    let fin = false; const end = () => { if (!fin) { fin = true; clearInterval(iv); res(); } };
    (async () => { let n = -1; while (n !== all.length) { n = all.length; await Promise.allSettled(all.slice()); } })().then(end);
    const iv = setInterval(() => { const el = Date.now() - t0; if (el > 10000 || (el > 6000 && seen.size >= 6)) end(); }, 150);
  });
  openWeb();
  learnFrom([...seen.values()]);
  if (cfg.onLearn) cfg.onLearn(LEARNED);
  if (seen.size >= 4 && live()) {
    const list = [...seen.values()], df = new Map();
    list.forEach(o => new Set(tokens(haystack(o.title, o.url, '', o.specs))).forEach(t => df.set(t, (df.get(t) || 0) + 1)));
    const mul = new Map();
    for (const x of QS) for (const t of tokens(x)) { const r = (df.get(t) || 0) / list.length; mul.set(t, r > 0.85 ? 0.6 : r < 0.25 ? 1.25 : 1); }
    for (const o of list) {
      const a3 = A(haystack(o.title, o.url, '', o.specs), specText(o.specs), domain(o.url), { mul });
      if (a3.match === 'loose') { if (a3.reason || a3.cov < 0.3) { seen.delete(o.id); continue; } o.rank *= 0.5; o.match = 'near'; continue; }
      o.rank = a3.rank + (o.bonus || 0); o.match = a3.match;
    }
    emit({ type: 'replace', offers: [...seen.values()] });
  }
  if (!seen.size && soft.length) add(soft.sort((a, b) => a.price - b.price).slice(0, 12));   // nothing better: show the closest
  const strong = [...seen.values()].filter(o => !o.intl && o.rank >= 0.3).length;
  if (related.length) {                                              // the rest of what the shops listed that is related, best first (the screen keeps them folded away)
    const pool2 = related.filter(o => !o.intl);
    add(pool2.sort((a, b) => b.rank - a.rank || (a.price || 1e12) - (b.price || 1e12)).slice(0, 30));
  }
  LOG('summary', q, 'raw=' + raw + ' shown=' + seen.size + ' ms=' + (Date.now() - t0), seen.size);
  if (live() && !seen.size) { errored = true; emit({ type: 'error', message: 'No listings found (' + raw + ' checked, none matched). If this keeps happening, wait a few minutes (Google may be limiting searches) and try again.' }); }
  if (seen.size && ![...seen.values()].every(o => o.match === 'related')) cache.set(key, { t: Date.now(), offers: [...seen.values()] });
  if (live()) emit({ type: 'done' });
}

// ---------- Kenyan shops searched directly ----------
let SHOPS = ['aliglaziers.co.ke', 'nemsiholdings.co.ke', 'builderschoice.co.ke', 'tujengeke.co.ke', 'randtech.co.ke', 'brighttech.co.ke',
  'winstar.co.ke', 'gypsumceilingkenya.co.ke', 'shabbirihardware.co.ke', 'jamjos.co.ke'];
const setShops = list => { if (list && list.length) SHOPS = list; };
const getShops = () => SHOPS;

// at most 12 shop requests at once
let busy = 0; const queue = [];
async function gate(fn) {
  if (busy >= 24) await new Promise(r => queue.push(r));
  busy++;
  try { return await fn(); } finally { busy--; const n = queue.shift(); if (n) n(); }
}
async function fetchJson(url, ms) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(ms || 6000) });
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}
const CARD = 'li.product, .product-thumb, .product-layout, article.product, .type-product, .product-item, .product-card';
function parseCards(html, base) {
  const $ = cheerio.load(html), out = [], seen = new Set();
  for (const c of $(CARD).toArray()) {
    const el = $(c);
    if (el.find(CARD).length) continue;                           // a wrapper, not a card
    const a = el.find('h1 a,h2 a,h3 a,h4 a,.name a,.title a,a.woocommerce-LoopProduct-link').first();
    const href = a.attr('href') || el.find('a[href]').first().attr('href');
    const title = clean(el.find('.woocommerce-loop-product__title,h1,h2,h3,h4,.name,.title').first().text() || a.text());
    el.find('del,s,strike,[class*=old],[class*=was]').remove();   // ignore struck-through old prices
    const price = clean(el.find('.price,[class*=price]').first().text());
    const img = el.find('img').first();
    let src = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src') || '';
    try { src = src ? new URL(src, base).href : ''; } catch { src = ''; }
    let link; try { link = new URL(href, base).href; } catch { continue; }
    if (!title || !parseMoney(price) || seen.has(link)) continue;
    seen.add(link);
    out.push({ title, price, link, imageUrl: /^https?:/.test(src) ? src : '' });
  }
  return out.slice(0, 30);
}
/** One shop, three ways: WooCommerce product API -> its search page -> follow the links its search page shows. */
const MODE = {}, PROBE = {};   // host -> search style that works / the one-time test of that host
const PATS = ['/?post_type=product&s=', '/index.php?route=product/search&search=', '/search?q=', '/?s='];
const shopMode = h => MODE[String(h).replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')];
const kenyanSite = domain => async q => {
  const host = String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const origin = 'https://' + host, enc = encodeURIComponent(q);
  const wooItems = j => j.map(p => {
    const minor = Number(p.prices && p.prices.currency_minor_unit) || 0;
    const price = Number(p.prices && p.prices.price) / Math.pow(10, minor);
    return { title: cheerio.load('<b>' + (p.name || '') + '</b>').text(), price: (p.prices.currency_code || 'KES') + ' ' + price,
      link: p.permalink, imageUrl: (p.images && p.images[0] && p.images[0].src) || '' };
  }).filter(i => i.link && /\d/.test(i.price) && !/NaN| 0$/.test(i.price));
  const viaPage = async (pat, query) => {
    let pg = ''; try { pg = await fetchPage('https://' + host + pat + encodeURIComponent(query), 3500); } catch { pg = ''; }
    if (!pg) return null;
    let items = parseCards(pg, origin + '/');
    if (!items.length) {                                       // open the pages the search shows
      const $ = cheerio.load(pg), links = [];
      $('main a[href], #content a[href], .content a[href], article a[href]').each((_, a) => {
        let h; try { h = new URL($(a).attr('href'), origin + '/'); } catch { return; }
        if (!h.hostname.endsWith(host) || h.search.includes('add-to-cart') || /\.(jpg|png|webp|pdf)$/i.test(h.pathname)) return;
        if (clean($(a).text()).length >= 8 && !links.includes(h.href.split('#')[0])) links.push(h.href.split('#')[0]);
      });
      await pool(links.slice(0, 6), 6, async u => {
        const x = extract(await fetchPage(u, 4000)); if (!x.money || !x.name) return;
        items.push({ title: x.name, price: x.money.cur + ' ' + x.money.value, link: u, imageUrl: x.image });
      });
    }
    return items;
  };
  const viaWoo = async query => {
    try { const j = await fetchJson('https://' + host + '/wp-json/wc/store/v1/products?per_page=60&search=' + encodeURIComponent(query), 3000); return Array.isArray(j) ? wooItems(j) : null; } catch { return null; }
  };
  const run = async (mode, query) => (mode === 'woo' ? viaWoo(query) : viaPage(mode, query)) || [];
  const probe = async () => {                                  // once per shop: all search styles tried at the same time
    const [woo, ...pgs] = await Promise.all([viaWoo(q), ...PATS.map(p => viaPage(p, q).catch(() => null))]);
    LOG(host, q, 'probe woo=' + (woo ? woo.length : 'null') + ' pages=' + pgs.map(r => (r ? r.length : 'null')).join(','), 0);
    if (woo) { MODE[host] = 'woo'; return woo; }                // its product API answers (even with 0 matches for this first query): always use it
    let i = pgs.findIndex(r => r && r.length); if (i < 0) i = pgs.findIndex(r => r);
    if (i >= 0) { MODE[host] = PATS[i]; return pgs[i]; }
    LOG(host, q, 'probe: none worked', 0); MODE[host] = 'none'; return [];
  };
  return gate(async () => {
    let items;
    if (!MODE[host]) { if (!PROBE[host]) PROBE[host] = probe(); const first = await PROBE[host]; items = MODE[host] === 'none' ? [] : first.concat(await run(MODE[host], q)); }
    else items = MODE[host] === 'none' ? [] : await run(MODE[host], q);
    return { shopping: items.map(i => ({ ...i, source: host })) };
  });
};
/** Searches to run on a shop: spelling variants, model code alone, and the query with each single word left out. */
const dropOne = q => {
  const t = String(q).split(/\s+/).filter(Boolean);
  return t.length < 3 ? [] : t.slice(0, 8).map((_, i) => t.filter((_, j) => j !== i).join(' '));
};
const FILLER = /^(per|metres?|meters?|mtrs?|mt|pcs|pieces?|of|for|the|and|with|x|dark|light|deep|heavy|gauge|furniture|structural|industrial|domestic|commercial|household|decorative|general)$/i;
const SWAP = { gi: 'galvanized', roll: 'coil', coil: 'roll' };
/** Short, distinctive searches ("hdpe pipe", "hdpe roll", "gi stand"): shops answer these even when the full title would never match. */
function keyQueries(q) {
  const base = abbr(q).replace(/[`´‘’′]{2}|''|\"/g, ' ').replace(/[½¼¾]/g, ' ').replace(/\s+/g, ' ').trim();
  const toks = base.split(/\s+/).filter(t => t && !FILLER.test(t) && !STOP.has(t.toLowerCase()));
  const words = [...new Set(toks.filter(t => /^[a-z][a-z.-]*$/i.test(t) && t.length >= 2 && !NOISE.test(t) && !/^(inch|inches|in)$/i.test(t)).map(t => t.replace(/\./g, '')))];
  const dist = w => !GENERIC.has(w.toLowerCase()) && !LOW.has(w.toLowerCase());
  const out = [];
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++)
    if (dist(words[i]) || dist(words[j])) out.push(words[i] + ' ' + words[j]);
  const mm = toks.find(t => /^\d+\s?mm$/i.test(t)), ga = toks.find(t => /^\d{1,2}g$/i.test(t)), lead = words.find(dist) || words.find(w => !LOW.has(w.toLowerCase()));
  if (lead && mm) out.push(lead + ' ' + mm);
  if (lead && ga) out.push(lead + ' ' + ga);
  const singles = words.filter(w => dist(w) && w.length >= 4).slice(0, 2);
  out.push(...singles);
  const src = String(q), im = src.match(/(\d+(?:\.\d+)?)\s*(?:"|''|”|″|in\b|inch(?:es)?)/i) || src.match(/(?<![\d\/.])(\d+)\s+(\d)\/(\d)(?![\d\/])/) || src.match(/(?<![\d\/.])(\d+\.(?:25|5|75))(?![\d.]|\s?mm)/);
  const hd = out.find(x => !/\d/.test(x)) || lead;
  if (im && hd) {
    const v = im[3] ? +im[1] + im[2] / im[3] : parseFloat(im[1]), w = Math.floor(v), fr = { 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' }[+(v - w).toFixed(2)];
    if (fr && w >= 1) out.splice(1, 0, hd + ' ' + w + ' ' + fr, hd + ' ' + w + fr, hd + ' ' + v);
  }
  const swapped = out.slice(0, 2).map(x => x.split(' ').map(w => SWAP[w.toLowerCase()] || w).join(' '));
  return [...new Set([...out.slice(0, 5), ...swapped, ...singles])];
}
/** Searches for a shop whose search wants EVERY word in the title: the full name, a tidy version, distinctive short ones, shorter prefixes. */
function shopQueries(q) {
  const base = abbr(q).replace(/[`´‘’′]{2}|''|\"/g, ' ').replace(/½/g, '1/2').replace(/¼/g, '1/4').replace(/¾/g, '3/4').replace(/\s+/g, ' ').trim();
  const toks = base.split(/\s+/).filter(Boolean);
  const core = toks.filter(t => !FILLER.test(t));
  const out = [base, core.join(' '), ...keyQueries(q)];
  for (let k = Math.min(core.length - 1, 5); k >= 3; k--) out.push(core.slice(0, k).join(' '));
  out.push(core.filter(t => !/\d/.test(t)).join(' '));
  out.push(...smart(q), ...plan(base), ...variants(base));
  const seen = new Set();
  return out.map(x => x.trim()).filter(x => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())).slice(0, 8);
}

// ---------- free web search (no key) ----------
async function htmlSearch(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-KE,en;q=0.9' }, signal: AbortSignal.timeout(8000) });
  return r.ok ? r.text() : '';
}
async function freeWeb(q) {
  const qs = [q + ' price Kenya', q + ' buy online Kenya'];
  const jobs = qs.flatMap(x => [
    htmlSearch('https://html.duckduckgo.com/html/?kl=ke-en&q=' + encodeURIComponent(x)),
    htmlSearch('https://www.bing.com/search?cc=ke&setlang=en&q=' + encodeURIComponent(x)),
  ]);
  const res = await Promise.allSettled(jobs);
  const organic = [];
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value) return;
    const $ = cheerio.load(r.value);
    if (i % 2 === 0) $('a.result__a').each((_, a) => {
      let h = $(a).attr('href') || '';
      const m = h.match(/uddg=([^&]+)/); if (m) h = decodeURIComponent(m[1]);
      if (h.startsWith('//')) h = 'https:' + h;
      if (/^https?:/.test(h)) organic.push({ title: clean($(a).text()), link: h, snippet: clean($(a).closest('.result').find('.result__snippet').text()) });
    });
    else $('li.b_algo h2 a').each((_, a) => { const h = $(a).attr('href') || ''; if (/^https?:/.test(h)) organic.push({ title: clean($(a).text()), link: h, snippet: clean($(a).closest('li.b_algo').find('.b_caption p, p').first().text()) }); });
  });
  const seen = new Set();
  return { organic: organic.filter(o => !seen.has(o.link) && seen.add(o.link)) };
}


// ---------- fast web search (plain requests, no browser window): results in about a second ----------
async function serp(kind, url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-KE,en;q=0.9' }, signal: AbortSignal.timeout(3500) });
  if (!r.ok) { if (r.status === 429 && kind === 'g') GCOOL = Date.now() + 120000; LOG('serp-' + kind, url.slice(0, 60), 'HTTP ' + r.status, 0); return []; }
  const $ = cheerio.load(await r.text()), out = [];
  if (kind === 'g') $('a[href^="/url?q="]').each((_, a) => {
    const m = ($(a).attr('href') || '').match(/\/url\?q=([^&]+)/); if (!m) return;
    let link; try { link = decodeURIComponent(m[1]); } catch { return; }
    if (!/^https?:/.test(link) || /google\./.test(domain(link))) return;
    const title = clean($(a).find('h3').text() || $(a).text()); if (!title) return;
    out.push({ title, link, snippet: clean($(a).closest('div').parent().text()).slice(0, 500) });
  });
  else if (kind === 'b') $('li.b_algo').each((_, li) => {
    const a = $(li).find('h2 a').first(), h = a.attr('href') || ''; if (!/^https?:/.test(h)) return;
    out.push({ title: clean(a.text()), link: h, snippet: clean($(li).find('.b_caption p, p').first().text()) });
  });
  else $('a.result__a').each((_, a) => {
    let h = $(a).attr('href') || ''; const m = h.match(/uddg=([^&]+)/); if (m) h = decodeURIComponent(m[1]);
    if (h.startsWith('//')) h = 'https:' + h;
    if (/^https?:/.test(h)) out.push({ title: clean($(a).text()), link: h, snippet: clean($(a).closest('.result').find('.result__snippet').text()) });
  });
  LOG('serp-' + kind, url.slice(0, 60), 'results', out.length);
  return out.map((o, i) => ({ ...o, gpos: i }));
}
let GCOOL = 0;                                                      // Google's plain page rate-limits (429): leave it alone for 2 minutes after that
/** Bing + DuckDuckGo at the same time (about a second); Google's plain page only if those found almost nothing. */
async function quickWeb(q) {
  const e = encodeURIComponent(q);
  const ps = [serp('b', 'https://www.bing.com/search?cc=ke&setlang=en&q=' + e), serp('d', 'https://html.duckduckgo.com/html/?kl=ke-en&q=' + e)];
  const got = await new Promise(res => {
    const all = []; let left = ps.length, timer = null, done = false;
    const fin = () => { if (!done) { done = true; res(all); } };
    ps.forEach(p => p.then(r => { if (r.length) { all.push(...r); if (!timer) timer = setTimeout(fin, 400); } }).catch(() => {}).finally(() => { if (--left === 0) fin(); }));
  });
  if (got.length < 3 && Date.now() > GCOOL) got.push(...await serp('g', 'https://www.google.com/search?gbv=1&hl=en&gl=ke&num=20&q=' + e).catch(() => []));
  const seen = new Set();
  return { organic: got.filter(o => !seen.has(o.link) && seen.add(o.link)) };
}

// ---------- discovery: which word in the query is a brand, a website, a tool model code? ----------
let DISC = {};                                                      // remembered: word -> [sites], '#code' -> { hosts, term }
const setDiscovered = o => { DISC = o && typeof o === 'object' ? o : {}; };
const getDiscovered = () => DISC;
const apexOf = h => { const p = h.split('.'); return ((p.length > 2 && p[p.length - 2].length <= 3 ? p[p.length - 3] : p[p.length - 2]) || '').replace(/-/g, ''); };
const TITLE_NOISE = new Set('tools tool supplier suppliers supplies power hardware shop online store buy product products price prices kenya nairobi best cheap sale mall from with your for the and'.split(' '));
/**
 * Looks at every word of the query on the internet: a brand/site word -> its own website(s); a model code (Fhppc042) -> the shops that list it
 * and the brand it belongs to. Calls onSite(host, words) the moment a site is found. Answers are remembered on disk.
 */
async function discover(q, search, save, onSite) {
  const raw = String(q).toLowerCase().replace(/[`´‘’′"'“”″]/g, ' ').split(/[^a-z0-9-]+/).filter(Boolean);
  const word = t => /^[a-z][a-z-]{2,14}$/.test(t) && !GENERIC.has(t) && !STOP.has(t) && !LOW.has(t) && !MOD.has(t) && !FORM.has(t) && !MATERIALS.includes(t) && !COLORS.includes(t) && !BRAND_SITES[t];
  const brands = [...new Set(raw.filter(word))].slice(0, 3);
  const models = [...new Set(raw.filter(t => t.length >= 5 && /[a-z]/.test(t) && /\d/.test(t) && isModel(t)))].slice(0, 2);
  const gen = raw.filter(t => GENERIC.has(t) && !MOD.has(t) && !LOW.has(t)).slice(0, 2).join(' ');
  const found = new Set(), emit = (host, words) => { if (host && !found.has(host)) { found.add(host); onSite && onSite(host, words); } };
  const safe = p => p.catch(() => ({ organic: [] }));
  const siteFor = async b => {
    if (Array.isArray(DISC[b])) { DISC[b].forEach(h => emit(h, [b])); return DISC[b]; }
    const rs = await Promise.all([safe(search(b + ' Kenya')), safe(search((b + ' ' + gen).trim()))]);
    const score = new Map(), bb = b.replace(/-/g, '');
    for (const r of rs) (r.organic || []).slice(0, 12).forEach((o, i) => {
      const h = domain(o.link); if (skipDomain(h) || GLOBAL.test(h)) return;
      const a = apexOf(h);
      if (a === bb || a.startsWith(bb) || (bb.length >= 5 && a.includes(bb))) score.set(h, (score.get(h) || 0) + 12 - i);
    });
    const hosts = [...score.entries()].sort((x, y) => y[1] - x[1]).map(x => x[0]).slice(0, 2);
    hosts.forEach(h => emit(h, [b]));
    if (hosts.length || rs.some(r => (r.organic || []).length)) { DISC[b] = hosts; save && save(DISC); }
    return hosts;
  };
  const modelFor = async m => {
    const key = '#' + m, flat = m.replace(/[^a-z0-9]/g, '');
    let c = DISC[key];
    if (!c) {
      const r = await safe(search(m)), hosts = new Map(), words = new Map();
      const hits = (r.organic || []).filter(o => (o.title + ' ' + o.snippet + ' ' + o.link).toLowerCase().replace(/[^a-z0-9]/g, '').includes(flat));
      hits.forEach((o, i) => {
        const h = domain(o.link); if (!skipDomain(h) && !GLOBAL.test(h)) hosts.set(h, (hosts.get(h) || 0) + 12 - i);
        for (const w of new Set(o.title.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4 && w.length <= 12 && !GENERIC.has(w) && !LOW.has(w) && !MOD.has(w) && !STOP.has(w) && !TITLE_NOISE.has(w) && !MATERIALS.includes(w) && !COLORS.includes(w) && !raw.includes(w))))
          words.set(w, (words.get(w) || 0) + 1);
      });
      const top = [...words.entries()].sort((x, y) => y[1] - x[1])[0];
      c = { hosts: [...hosts.entries()].sort((x, y) => y[1] - x[1]).map(x => x[0]).slice(0, 3), term: top && hits.length >= 2 && top[1] >= Math.max(2, hits.length * 0.4) ? top[0] : '' };
      if (hits.length || (r.organic || []).length) { DISC[key] = c; save && save(DISC); }
    }
    c.hosts.forEach(h => emit(h, [m]));
    if (c.term && !brands.includes(c.term)) await siteFor(c.term);        // the brand the code belongs to: its own site too
  };
  await Promise.all([...brands.map(b => siteFor(b).catch(() => {})), ...models.map(m => modelFor(m).catch(() => {}))]);
  return [...found];
}

module.exports = { setLog, quickWeb, discover, setDiscovered, getDiscovered, skipDomain, fixTypos, isBlocked, keyQueries, shopMode, priceRange, variationRow, setBrands, typeGroups, snippetPrice, brandCandidates, officialSites, haystack, tableRow, smart, setLearned, targetShops, setShops, getShops, shopQueries, plan, expand, kenyanSite, parseCards, analyze, variants, setRates, parseMoney, inKes, freeWeb, searchProduct, extract, score, parsePrice, norm, tokens, titleSpecs };
