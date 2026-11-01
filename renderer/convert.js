(() => {
  'use strict';
  // factor = how many base units in 1 of this unit (temperature handled separately)
  const T = {
    Length: { base: 'm', u: { mm: 0.001, cm: 0.01, m: 1, km: 1000, 'in (inch)': 0.0254, 'ft (feet)': 0.3048, 'yd (yard)': 0.9144, 'mile': 1609.344 } },
    Weight: { u: { g: 0.001, kg: 1, 'tonne': 1000, oz: 0.028349523125, 'lb (pound)': 0.45359237 } },
    Volume: { u: { ml: 0.001, 'L (litre)': 1, 'm³': 1000, 'US gallon': 3.785411784, 'UK gallon': 4.54609, 'fl oz (US)': 0.0295735295625 } },
    Area: { u: { 'mm²': 1e-6, 'cm²': 1e-4, 'm²': 1, 'ha': 10000, 'in²': 0.00064516, 'ft²': 0.09290304, 'yd²': 0.83612736, 'acre': 4046.8564224 } },
    Pressure: { u: { bar: 1, kPa: 0.01, MPa: 10, psi: 0.0689475729, 'atm': 1.01325, 'm head (water)': 0.0980665 } },
    Power: { u: { W: 1, kW: 1000, hp: 745.699872, 'BTU/h': 0.29307107 } },
    Temperature: { temp: true, u: { '°C': 1, '°F': 1, K: 1 } },
  };
  const $ = id => document.getElementById(id);
  const cu = $('cu'), cf = $('cf'), ct = $('ct'), cv = $('cv'), co = $('co');
  Object.keys(T).forEach(k => cu.add(new Option(k, k)));
  function fill() {
    const names = Object.keys(T[cu.value].u);
    [cf, ct].forEach(s => { s.innerHTML = ''; names.forEach(n => s.add(new Option(n, n))); });
    const def = { Length: ['ft (feet)', 'mm'], Weight: ['kg', 'lb (pound)'], Volume: ['L (litre)', 'US gallon'], Area: ['m²', 'ft²'], Pressure: ['bar', 'psi'], Power: ['kW', 'hp'], Temperature: ['°C', '°F'] }[cu.value];
    cf.value = def[0]; ct.value = def[1]; calc();
  }
  const num = s => {                                    // accepts 3/4, 2 1/2, 2-1/2, 1,5 and plain numbers
    s = String(s).trim().replace(',', '.');
    let m = s.match(/^(\d+)[\s-]+(\d+)\/(\d+)$/); if (m) return +m[1] + m[2] / m[3];
    m = s.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/); if (m) return m[1] / m[2];
    return s === '' || isNaN(+s) ? NaN : +s;
  };
  const fmt = n => { const a = Math.abs(n); return (a >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : +n.toPrecision(6)).toString(); };
  function calc() {
    const g = T[cu.value], v = num(cv.value);
    if (isNaN(v)) { co.textContent = '–'; return; }
    let r;
    if (g.temp) {
      const c = cf.value === '°F' ? (v - 32) * 5 / 9 : cf.value === 'K' ? v - 273.15 : v;
      r = ct.value === '°F' ? c * 9 / 5 + 32 : ct.value === 'K' ? c + 273.15 : c;
    } else r = v * g.u[cf.value] / g.u[ct.value];
    co.textContent = fmt(r) + ' ' + ct.value.split(' ')[0];
    co.dataset.v = +r.toPrecision(8);
  }
  cu.onchange = fill; cf.onchange = ct.onchange = calc; cv.oninput = calc;
  $('cs').onclick = () => { const a = cf.value; cf.value = ct.value; ct.value = a; calc(); };
  $('cc').onclick = () => { if (co.dataset.v) { window.api.copy(co.dataset.v); const b = $('cc'); b.textContent = '✓'; setTimeout(() => { b.innerHTML = '&#10064;'; }, 1000); } };
  fill();
})();
