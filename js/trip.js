// 旅（Trip）の組み立てと編集（設計書 §8.2・§17）。場所は候補の情報＋Gemini の一言から組む。

import { computeSchedule } from './schedule.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

export function newTripId(date = new Date(), rand = Math.random) {
  const d = date;
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const suffix = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0').slice(-4);
  return `t_${stamp}_${suffix}`;
}

/** ごはん枠の決め方（設計書 §16.4）：昼は全コースで時刻が合えば、晩は 1日コースか遅い終わり。 */
export function scheduleOpts(course) {
  return { lunch: true, dinner: course === 'full' };
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Gemini の選択（normalizePicks の 1 件）→ 場所（camelCase）。記事名・URL・写真・座標・説明文は候補から（§17.7：確認通信はせん）。
 * 営業時間・公式 URL は持たん（作らせんため・§17.4）。
 */
export function spotFromPick(pick) {
  const c = pick.candidate || {};
  const lat = num(c.lat);
  const lng = num(c.lng);
  const wiki = c.wikiTitle ? { title: c.wikiTitle, url: c.url || null, thumb: c.thumb || null, extract: c.extract || null } : null;
  return {
    name: c.name,
    wikiTitle: c.wikiTitle || null,
    kind: pick.kind || null,
    summary: pick.reason || null,
    stayMinutes: num(pick.stay_minutes),
    costYen: num(pick.cost_yen),
    costNote: pick.cost_note || null,
    hours: null,
    officialUrl: null,
    moveToNext: null,
    verified: wiki ? 'wiki' : lat !== null && lng !== null ? 'osm' : 'none',
    wiki,
    photo: c.thumb ? { thumb: c.thumb, source: 'wiki', url: c.url || null } : null,
    lat,
    lng,
    hero: Boolean(c.hero),
    priority: Number.isFinite(Number(pick.priority)) ? Number(pick.priority) : 0,
    removed: false,
  };
}

/** 並び済みの場所（moveToNext 付き）→ Trip（番号・時刻入り）。 */
export function buildTrip({ destination, area = '', course, startTime, model, now = new Date(), mode = 'classic', travelDate = null, spots = [], wanted = null, note = null, dropped = [], refs = [], searchHtml = null }) {
  const list = (spots || []).map((s, i) => ({ ...s, n: i + 1, removed: Boolean(s.removed) }));
  const sched = computeSchedule(list, startTime, scheduleOpts(course));
  return {
    id: newTripId(now),
    createdAt: now.toISOString(),
    destination,
    area: area || '',
    course,
    mode,
    travelDate: travelDate || null,
    startTime,
    model,
    spots: sched.spots,
    lunch: sched.lunch,
    dinner: sched.dinner,
    wanted: wanted ?? list.length,
    note: note || null,
    dropped: Array.isArray(dropped) ? dropped.slice() : [],
    refs: (refs || []).map((r) => ({ title: r.title || '', uri: r.uri })),
    searchHtml: typeof searchHtml === 'string' && searchHtml ? searchHtml : null,
    totalMinutes: sched.totalMinutes,
    totalCostYen: sched.totalCostYen,
  };
}

/** n 番目を外して時刻と合計を計算し直す。元は変えない。 */
export function removeSpot(trip, n) {
  const spots = trip.spots.map((s) => (s.n === n ? { ...s, removed: true } : { ...s }));
  const sched = computeSchedule(spots, trip.startTime, scheduleOpts(trip.course));
  return { ...trip, spots: sched.spots, lunch: sched.lunch, dinner: sched.dinner, totalMinutes: sched.totalMinutes, totalCostYen: sched.totalCostYen };
}
