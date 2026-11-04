// 旅（Trip）の組み立てと編集（設計書 §8.2）。

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

function officialFromRefs(name, refs) {
  const hit = (refs || []).find((r) => r && typeof r.title === 'string' && r.title.includes(name) && /^https:\/\//i.test(r.uri || ''));
  return hit ? hit.uri : null;
}

/** ごはん枠の決め方（設計書 §16.4）：昼は全コースで時刻が合えば、晩は 1日コースか遅い終わり。 */
export function scheduleOpts(course) {
  return { lunch: true, dinner: course === 'full' };
}

/** Gemini の形（snake_case）＋確認結果 → Trip（camelCase・時刻入り）。 */
export function buildTrip({ destination, course, startTime, model, normalized, refs = [], verifyResults = [], searchHtml = null, now = new Date(), mode = 'classic', wanted = null, note = null }) {
  const n = normalized || { spots: [] };
  const spots = (n.spots || []).map((s, i) => {
    const v = verifyResults[i] || {};
    const m = s.move_to_next;
    return {
      n: i + 1,
      name: s.name,
      wikiTitle: s.wikiTitle ?? null,
      kind: s.kind ?? null,
      summary: s.summary ?? null,
      stayMinutes: s.stay_minutes ?? null,
      costYen: s.cost_yen ?? null,
      costNote: s.cost_note ?? null,
      hours: s.hours ?? null,
      officialUrl: s.official_url || officialFromRefs(s.name, refs),
      moveToNext: m ? { mode: m.mode ?? null, minutes: m.minutes ?? null, note: m.note ?? null } : null,
      verified: v.verified || 'none',
      wiki: v.wiki || null,
      photo: v.photo || (v.wiki && v.wiki.thumb ? { thumb: v.wiki.thumb, source: 'wiki', url: v.wiki.url || null } : null),
      lat: v.lat ?? null,
      lng: v.lng ?? null,
      removed: false,
    };
  });
  const sched = computeSchedule(spots, startTime, scheduleOpts(course));
  return {
    id: newTripId(now),
    createdAt: now.toISOString(),
    destination: n.destination || destination,
    area: n.area || '',
    course,
    mode,
    startTime,
    model,
    spots: sched.spots,
    lunch: sched.lunch,
    dinner: sched.dinner,
    wanted: wanted ?? spots.length,
    note: note || null,
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
