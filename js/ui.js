// 画面の小道具。文字は必ず textContent で入れる（innerHTML は使わない）。

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = String(v);
    else if (k === 'class') node.className = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'style') node.setAttribute('style', v);
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else if (k.startsWith('aria')) node.setAttribute(k.replace(/^aria([A-Z])/, (_, c) => `aria-${c.toLowerCase()}`), String(v));
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const ICONS = {
  pin: 'M12 22s7-7.5 7-12a7 7 0 1 0-14 0c0 4.5 7 12 7 12z|c:12,10,2.5',
  mic: 'r:9,3,6,11,3|M5 11a7 7 0 0 0 14 0M12 18v3',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  walk: 'M13 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM8.5 22l2-7 2 2v5M9 10l-3 7M11.5 7l-3 1.5V12M11.5 7l3 4 3 1',
  train: 'r:4,3,16,14,3|M4 11h16M8 17l-2 4M16 17l2 4M8.5 14h.01M15.5 14h.01',
  taxi: 'M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11M4 11h16v6H4zM7 17v2M17 17v2M7 14h.01M17 14h.01',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  navigate: 'M3 11l19-9-9 19-2-8-8-2z',
  external: 'M7 17L17 7M9 7h8v8',
  sun: 'c:12,12,4|M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  gear: 'c:12,12,3|M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  globe: 'c:12,12,9|M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  book: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
  down: 'M12 5v14M6 13l6 6 6-6',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z|c:12,12,3',
  x: 'M6 6l12 12M18 6L6 18',
  fork: 'M7 2v6a3 3 0 0 0 6 0V2M10 11v11M17 2c-1.5 1.5-2.5 4.5-2.5 8 0 1.5 1 2.5 2.5 2.5V22',
};

/** 線画アイコン（stroke は currentColor。装飾なので aria-hidden）。 */
export function icon(name, size = 24) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const part of (ICONS[name] || ICONS.pin).split('|')) {
    let node;
    if (part.startsWith('c:')) {
      const [cx, cy, r] = part.slice(2).split(',');
      node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      node.setAttribute('cx', cx); node.setAttribute('cy', cy); node.setAttribute('r', r);
    } else if (part.startsWith('r:')) {
      const [x, y, w, h, rx] = part.slice(2).split(',');
      node = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      node.setAttribute('x', x); node.setAttribute('y', y); node.setAttribute('width', w); node.setAttribute('height', h); node.setAttribute('rx', rx);
    } else {
      node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      node.setAttribute('d', part);
    }
    svg.append(node);
  }
  return svg;
}

/** 流れる点線（読み込み中・道のり）。 */
export function dots(width = 160) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} 14`);
  svg.setAttribute('class', 'dots');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', `M4 7 H${width - 4}`);
  svg.append(p);
  return svg;
}

export function formatDateJa(d = new Date()) {
  const w = '日月火水木金土'[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
}

export function yen(n) {
  return n === null || n === undefined ? null : `${Number(n).toLocaleString('ja-JP')}円`;
}

/** 文字ファイルをダウンロードさせる。 */
export function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
