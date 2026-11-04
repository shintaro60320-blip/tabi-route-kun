// 画面4 地図（設計書 §3.4）。Leaflet ＋ OpenStreetMap。線は直線（道案内は Google マップへ）。
import { el, icon } from '../ui.js';
import { COURSES } from '../prompt.js';
import { routeLinks } from '../maplinks.js';

export function render(root, { nav, store, route }) {
  const trip = store.getTrip(route.id);
  if (!trip) { nav('/home'); return; }
  const live = trip.spots.filter((s) => !s.removed);
  const placed = live.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const missing = live.filter((s) => !Number.isFinite(s.lat) || !Number.isFinite(s.lng));
  const course = COURSES[trip.course];

  const mapNode = el('div', { id: 'leaflet', role: 'img', ariaLabel: `${trip.destination}のまわりの地図` });
  const wrap = el('div', { class: 'mapwrap' }, [mapNode]);

  // 下の板
  const legend = el('div', { class: 'legend' });
  live.forEach((s, i) => {
    if (i > 0) legend.append(icon('arrow', 16));
    legend.append(el('span', { style: 'display:inline-flex;align-items:center' }, [el('span', { class: 'legend__n', text: String(i + 1) }), shortName(s.name)]));
  });
  if (live.length) legend.append(el('span', { class: 'legend__goal' }, [icon('flag', 14), 'ゴール']));

  const links = routeLinks(trip);
  const go = links.kind === 'single'
    ? el('a', { class: 'btn btn--primary', href: links.url, target: '_blank', rel: 'noopener' }, [icon('navigate'), 'Googleマップで案内を始める'])
    : el('a', { class: 'btn btn--primary', href: `#/trip/${trip.id}`, on: { click(e) { e.preventDefault(); nav(`/trip/${trip.id}`); setTimeout(() => document.querySelector('.bottombar .btn--primary')?.click(), 350); } } }, [icon('navigate'), 'Googleマップで案内を始める']);

  const sheet = el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet__grip', ariaHidden: true }),
    el('div', { class: 'row row--between' }, [
      el('div', { class: 'h2', text: `${trip.destination} ${course ? course.name : ''}` }),
      el('div', { class: 'sub', text: moveSummary(live) }),
    ]),
    legend,
    missing.length ? el('div', { class: 'note', text: `${missing.map((s) => s.name).join('・')}は地図に出せませんでした` }) : null,
    go,
    el('div', { class: 'note', style: 'text-align:center', text: '地図 © OpenStreetMap contributors' }),
  ]);

  root.append(el('section', { class: 'screen screen--bare', dataset: { screen: 'map' }, style: 'position:relative;min-height:100dvh;background:#EDF0EA' }, [
    wrap,
    el('button', { class: 'back back--pill', type: 'button', on: { click: () => nav(`/trip/${trip.id}`) } }, [icon('back', 18), 'ルートにもどる']),
    compass(),
    sheet,
  ]));

  drawMap(mapNode, placed, live);
}

function shortName(name) {
  return name.length > 6 ? name.slice(0, 6) + '…' : name;
}

function moveSummary(live) {
  let walk = 0; let transit = 0;
  live.forEach((s, i) => {
    const m = s.moveToNext; if (!m || i === live.length - 1 || !m.minutes) return;
    if (m.mode === 'transit') transit += m.minutes; else walk += m.minutes;
  });
  const parts = [];
  if (walk) parts.push(`歩き ${walk}分`);
  if (transit) parts.push(`電車 ${transit}分`);
  return parts.join('・');
}

function drawMap(node, placed, live) {
  const L = globalThis.L;
  if (!L) { node.replaceChildren(el('div', { class: 'note', style: 'padding:80px 24px', text: '地図を読み込めませんでした（通信をご確認ください）' })); return; }
  const map = L.map(node, { zoomControl: false, attributionControl: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  if (!placed.length) { map.setView([35.68, 139.76], 5); return; }

  const pts = [];
  placed.forEach((s) => {
    const idx = live.indexOf(s) + 1;
    // 番号だけの決まった文字なので html でよい（外から来た文字は入れない）
    L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: `<div class="pin">${Number(idx)}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] }), keyboard: false }).addTo(map);
    pts.push([s.lat, s.lng]);
  });
  // 線：徒歩＝実線、公共交通＝点線
  for (let i = 0; i < placed.length - 1; i++) {
    const a = placed[i]; const b = placed[i + 1];
    const transit = a.moveToNext && a.moveToNext.mode === 'transit';
    L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
      color: '#0F766E', weight: transit ? 4 : 4, opacity: 0.9,
      className: transit ? 'leaflet-route--transit' : 'leaflet-route--walk',
    }).addTo(map);
  }
  if (pts.length === 1) map.setView(pts[0], 15);
  else map.fitBounds(pts, { padding: [40, 40] });
  setTimeout(() => map.invalidateSize(), 50);
}

function compass() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '-30 -32 60 64'); svg.setAttribute('class', 'compass'); svg.setAttribute('aria-hidden', 'true');
  const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  svg.append(
    mk('circle', { cx: 0, cy: 2, r: 24, fill: '#FFFFFF', stroke: '#9A7B3C', 'stroke-width': 1.5 }),
    mk('circle', { cx: 0, cy: 2, r: 17, fill: 'none', stroke: '#E3D9C2', 'stroke-width': 1 }),
    mk('path', { d: 'M0 -15 L5 2 L0 19 L-5 2 Z', fill: '#15202B' }),
    mk('path', { d: 'M0 -15 L5 2 L-5 2 Z', fill: '#B5432A' }),
    mk('path', { d: 'M-17 2 L0 -2 L17 2 L0 6 Z', fill: '#C9B98F' }),
  );
  const t = mk('text', { x: 0, y: -24, 'font-size': 10, 'font-weight': 700, fill: '#15202B', 'text-anchor': 'middle', 'font-family': 'Noto Sans JP, sans-serif' });
  t.textContent = '北';
  svg.append(t);
  return svg;
}
