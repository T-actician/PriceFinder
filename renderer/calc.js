(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  // tabs
  const show = k => { $('pc').hidden = k; $('pk').hidden = !k; $('tc').classList.toggle('on', !k); $('tk').classList.toggle('on', k); if (k) $('ke').focus(); };
  $('tc').onclick = () => show(false); $('tk').onclick = () => show(true);

  // safe evaluator: + - * / ( ) % and decimals (no eval)
  function evaluate(src) {
    const s = src.replace(/×|x|X/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '').replace(/\s+/g, '');
    let i = 0;
    const peek = () => s[i];
    function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = s[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
    function term() { let v = unary(); while (peek() === '*' || peek() === '/') { const o = s[i++]; const r = unary(); v = o === '*' ? v * r : v / r; } return v; }
    function unary() { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return post(); }
    function post() { let v = atom(); while (peek() === '%') { i++; v /= 100; } return v; }
    function atom() {
      if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw 0; i++; return v; }
      const m = s.slice(i).match(/^\d*\.?\d+|^\d+\.?/); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]);
    }
    const v = expr(); if (i !== s.length) throw 0; return v;
  }
  const fmt = n => (Number.isFinite(n) ? String(+n.toPrecision(10)) : '–');
  const ke = $('ke'), kr = $('kr');
  function live() {
    if (!ke.value.trim()) { kr.textContent = '0'; kr.dataset.v = ''; return; }
    try { const v = evaluate(ke.value); kr.textContent = fmt(v); kr.dataset.v = Number.isFinite(v) ? fmt(v) : ''; } catch { kr.textContent = '…'; kr.dataset.v = ''; }
  }
  const commit = () => { if (kr.dataset.v) { ke.value = kr.dataset.v; live(); } };
  ke.oninput = live;
  ke.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  const rows = ['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '(', '0', '.', '='];
  rows.forEach(k => {
    const b = document.createElement('button'); b.textContent = k;
    if ('÷×−+%'.includes(k) || k === 'C' || k === '⌫') b.className = 'op'; if (k === '=') b.className = 'eq';
    b.onclick = () => {
      if (k === 'C') ke.value = ''; else if (k === '⌫') ke.value = ke.value.slice(0, -1); else if (k === '=') { commit(); return; } else ke.value += k;
      ke.focus(); live();
    };
    $('keys').appendChild(b);
  });
  $('kc').onclick = () => { if (kr.dataset.v) { window.api.copy(kr.dataset.v); const b = $('kc'); b.textContent = '✓'; setTimeout(() => { b.innerHTML = '&#10064;'; }, 1000); } };
})();
