// 画面3 ルート（設計書 §3.3）
import { el, icon, yen } from '../ui.js';
import { COURSES, MODES } from '../prompt.js';
import { formatDuration } from '../schedule.js';
import { routeLinks, mealUrl } from '../maplinks.js';
import { removeSpot } from '../trip.js';
import { startJob } from './course.js';

const MOVE_ICON = { walk: 'walk', transit: 'train', taxi: 'taxi' };
const MOVE_WORD = { walk: '歩いて', transit: '電車・バスで', taxi: 'タクシーで' };

export function render(root, { state, nav, store, route }) {
  const trip = store.getTrip(route.id);
  if (!trip) { nav('/home'); return; }
  const live = trip.spots.filter((s) => !s.removed);
  const first = live.find((s) => photoOf(s));
  const course = COURSES[trip.course];

  // 写真の帯
  const hero = el('div', { class: 'hero' }, [
    first ? el('img', { src: photoOf(first).thumb, alt: trip.destination }) : el('div', { class: 'ph', text: trip.destination.slice(0, 2) }),
    el('div', { class: 'hero__shade' }),
    el('button', { class: 'back back--pill', type: 'button', on: { click: () => nav('/course') } }, [icon('back', 18), 'もどる']),
    course ? el('span', { class: 'tag tag--glass hero__tag', text: `${course.name}コース${MODES[trip.mode] ? '・' + MODES[trip.mode].name : ''}` }) : null,
    el('div', { class: 'hero__text' }, [
      el('h1', { class: 'hero__title', text: `${trip.destination}のまわり` }),
      el('div', { class: 'hero__sub', text: summary(trip, live) }),
    ]),
  ]);

  // 一覧
  const tl = el('div', { class: 'timeline' });
  tl.append(lineSvg());
  live.forEach((s, i) => {
    const row = el('a', { class: 'stop', href: `#/trip/${trip.id}/spot/${s.n}` }, [
      el('div', { class: 'stop__time', text: s.start || '' }),
      el('div', { class: 'stop__num', text: String(i + 1) }),
      el('div', { class: 'stop__body' }, [
        el('div', { style: 'display:flex;flex-direction:column;gap:3px' }, [
          el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
            el('div', { class: 'stop__name', text: s.name }),
            s.kind === '食事' ? el('span', { class: 'tag', text: lunchWord(s) }) : null,
          ]),
          metaLine(s),
        ]),
        photoOf(s) ? el('img', { class: 'stop__thumb', src: photoOf(s).thumb, alt: '', loading: 'lazy' }) : el('div', { class: 'stop__thumb' }),
      ]),
    ]);
    attachSwipe(row, () => askRemove(trip, s, { store, nav }));
    tl.append(row);
    // ごはん枠（設計書 §16.4）：店は名指しせず、近くを Google マップで探す
    if (trip.lunch && trip.lunch.afterN === s.n) tl.append(mealRow('lunch', trip.lunch.start, s, trip));
    if (trip.dinner && trip.dinner.afterN === s.n) tl.append(mealRow('dinner', null, s, trip));
    // 次の場所までの移動＝schedule が組んだ gap（間に外した場所があれば目安・路線名なし）
    const g = s.gap;
    if (i < live.length - 1 && g && g.minutes) {
      // 移動はアプリの目安（設計書 §17.6）：「歩いて 約15分（目安）」「電車・バスで 約25分（目安）」
      const word = g.estimated ? `${MOVE_WORD[g.mode] || '移動'} 約` : `${MOVE_WORD[g.mode] || '移動'} `;
      tl.append(el('div', { class: 'move' }, [icon(MOVE_ICON[g.mode] || 'walk', 16), `${word}${g.minutes}分${g.estimated ? '（目安）' : g.note ? `（${g.note}）` : ''}`]));
    } else if (i < live.length - 1) {
      tl.append(el('div', { class: 'move' }, [icon('down', 16), '次へ']));
    }
  });

  const redo = el('button', { class: 'btn btn--text', type: 'button', style: 'align-self:flex-end;margin:0 24px', on: {
    click() {
      if (!confirm('同じ行き先・コースでもう一度作ります（今日の回数を 1 回使います）。よろしいですか？')) return;
      state.current = { destination: trip.destination, course: trip.course, startTime: trip.startTime, mode: MODES[trip.mode] ? trip.mode : 'classic', travelDate: trip.travelDate || '' };
      startJob({ state, nav, store });
    },
  } }, ['作り直す']);

  // 下の帯
  const links = routeLinks(trip);
  const mapBtn = el('a', { class: 'btn btn--map', href: `#/trip/${trip.id}/map`, ariaLabel: '地図を見る' }, [icon('map'), '地図']);
  const gBtn = links.kind === 'single'
    ? el('a', { class: 'btn btn--primary', href: links.url, target: '_blank', rel: 'noopener' }, [icon('pin'), 'Googleマップで開く'])
    : el('button', { class: 'btn btn--primary', type: 'button', on: { click: () => openLegs(links, live) } }, [icon('pin'), 'Googleマップで開く']);

  root.append(el('section', { class: 'screen screen--bare', dataset: { screen: 'trip' } }, [
    hero,
    el('div', { style: 'max-width:520px;width:100%;margin:0 auto;display:flex;flex-direction:column;flex:1' }, [
      trip.note ? el('div', { class: 'note', style: 'padding:16px 24px 0', text: trip.note }) : null,
      tl,
      live.length > 1 ? el('div', { class: 'note', style: 'padding:0 24px', text: '移動の時間は目安です。電車・バスの時刻は Googleマップで確かめてください。' }) : null,
      searchSuggestions(trip), redo,
    ]),
    el('div', { class: 'bottombar' }, [mapBtn, gBtn]),
  ]));
}

/**
 * Google 検索根拠づけの利用条件：返ってきた検索候補（searchEntryPoint）は結果と一緒に表示する。
 * Google の HTML なので、キーを持つ本体から隔離した sandbox の iframe に入れる（スクリプト不可・リンクは新しいタブ）。
 */
function searchSuggestions(trip) {
  if (!trip.searchHtml) return null;
  const frame = el('iframe', {
    class: 'search-suggest', title: 'Google 検索の候補', sandbox: 'allow-popups allow-popups-to-escape-sandbox',
    referrerpolicy: 'no-referrer', loading: 'lazy',
  });
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{margin:0;padding:4px 0;font-family:'Noto Sans JP',sans-serif}</style>${trip.searchHtml}`;
  return el('div', { style: 'padding: 8px 24px 0' }, [el('div', { class: 'kicker', text: 'Google 検索の候補' }), frame]);
}

/** ごはん枠の行。時刻（昼だけ）・フォークの印・探すボタン。 */
function mealRow(type, time, spot, trip) {
  const label = type === 'lunch' ? 'このあたりで昼ごはん' : 'このあたりで晩ごはん';
  return el('a', { class: 'meal', href: mealUrl(type, spot.name, trip.area), target: '_blank', rel: 'noopener' }, [
    el('div', { class: 'stop__time', text: time || '' }),
    el('div', { class: 'meal__mark' }, [icon('fork', 16)]),
    el('div', { class: 'meal__body' }, [
      el('div', { class: 'meal__name', text: label }),
      el('div', { class: 'meal__sub' }, [icon('pin', 16), `${spot.name}の近くを Googleマップで探す`]),
    ]),
  ]);
}

/** 写真の出どころ：photo（wiki／commons）。古い保存分は wiki.thumb から。 */
export function photoOf(s) {
  if (s.photo && s.photo.thumb) return s.photo;
  if (s.wiki && s.wiki.thumb) return { thumb: s.wiki.thumb, source: 'wiki', url: s.wiki.url || null };
  return null;
}

function summary(trip, live) {
  const parts = [`${live.length}か所`, formatDuration(trip.totalMinutes)];
  if (trip.totalCostYen > 0) parts.push(`目安 ${yen(trip.totalCostYen)}`);
  return parts.join('・');
}

function lunchWord(s) {
  const h = parseInt((s.start || '12').split(':')[0], 10);
  return h >= 17 ? '夕ごはん' : h >= 11 ? '昼ごはん' : '食事';
}

function metaLine(s) {
  const node = el('div', { class: 'stop__meta' });
  const cost = s.costYen === null || s.costYen === undefined ? null : (s.costYen === 0 ? '無料' : yen(s.costYen));
  if (cost) {
    node.append(s.kind === '食事' ? '目安 ' : '入場 ', el('b', { text: cost }));
  }
  if (s.stayMinutes) {
    if (cost) node.append('・');
    node.append(`${s.kind === '食事' ? '' : s.kind === '自然' ? '散歩 ' : '見学 '}${formatMinutes(s.stayMinutes)}`);
  }
  return node;
}

function formatMinutes(m) {
  const h = Math.floor(m / 60); const r = m % 60;
  return h ? (r ? `${h}時間${r}分` : `${h}時間`) : `${r}分`;
}

function lineSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const wrap = el('div', { class: 'timeline__line', ariaHidden: true });
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 28 400'); svg.setAttribute('preserveAspectRatio', 'none');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M14 0 V400'); p.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(p); wrap.append(svg);
  return wrap;
}

/** 左へ払うと「外す」。年配の方の誤操作を避けるため確認を挟む。 */
function attachSwipe(row, onSwipe) {
  let x0 = null; let y0 = null;
  row.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  row.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (dx < -80 && Math.abs(dy) < 40) { e.preventDefault(); onSwipe(); }
  });
}

export function askRemove(trip, spot, { store, nav }) {
  if (!confirm(`「${spot.name}」をこのルートから外しますか？`)) return;
  const updated = removeSpot(trip, spot.n);
  store.updateTrip(updated);
  nav(`/trip/${trip.id}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function openLegs(links, live) {
  const dlg = el('dialog', { class: 'legs' });
  const close = el('button', { class: 'btn btn--text', type: 'button', on: { click: () => { dlg.close(); dlg.remove(); } } }, ['閉じる']);
  const rows = links.legs.map((l, i) => {
    const a = live[i]; const b = live[i + 1];
    return el('a', { class: 'linkrow', href: l.url, target: '_blank', rel: 'noopener' }, [
      el('span', {}, [icon('train'), `${l.label.replace(' を開く', '')}　${a.name} → ${b.name}`]),
      extIcon(),
    ]);
  });
  dlg.append(
    el('div', { class: 'h2', text: 'どこからどこまで？' }),
    el('div', { class: 'note', text: '電車やバスの道案内は区間ごとに開きます。' }),
    el('div', { class: 'links' }, [
      el('a', { class: 'linkrow', href: links.overview, target: '_blank', rel: 'noopener' }, [el('span', {}, [icon('map'), '全体を見る（車の道順）']), extIcon()]),
      ...rows,
    ]),
    close,
  );
  document.body.append(dlg);
  dlg.showModal();
}

function extIcon() {
  const i = icon('external', 20); i.classList.add('ext'); return i;
}
