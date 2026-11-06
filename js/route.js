// 順番と時間（設計書 §17.6）。座標から直線距離で回る順を決め、移動の目安を付け、予算を超えたら場所を減らす。純粋関数だけ。

import { distanceKm } from './candidates.js';
import { computeSchedule, LUNCH_MINUTES } from './schedule.js';

// 見学と移動の時間の予算（昼ごはんの 60 分は除く・2026-11-06 実測：込みにするとお散歩が昼の枠だけで予算を食う）
export const BUDGET_MINUTES = { walk: 120, half: 210, full: 420 };
export const BUDGET_SLACK = 15;
const ROAD_FACTOR = 1.35; // 直線距離 → 道のり
const WALK_KMH = 4; // 年配の方
const TRANSIT_KMH = 25;
const TRANSIT_OVERHEAD = 12; // 待ち・乗り換えの目安
const WALK_MAX_KM = 1.5; // 半日・1日でここまでは徒歩

function hasCoord(s) {
  return s && typeof s.lat === 'number' && Number.isFinite(s.lat) && typeof s.lng === 'number' && Number.isFinite(s.lng);
}

/** a → b の移動の目安。路線名は出さん（estimated:true）。座標が無ければ 0 分・mode null。 */
export function estimateMove(a, b, course) {
  if (!hasCoord(a) || !hasCoord(b)) return { mode: null, minutes: 0, note: null, estimated: true };
  const road = distanceKm(a, b) * ROAD_FACTOR;
  if (road < 0.05) return { mode: 'walk', minutes: 0, note: null, estimated: true };
  if (course === 'walk' || road <= WALK_MAX_KM) {
    return { mode: 'walk', minutes: Math.max(1, Math.round((road / WALK_KMH) * 60)), note: null, estimated: true };
  }
  return { mode: 'transit', minutes: Math.round(TRANSIT_OVERHEAD + (road / TRANSIT_KMH) * 60), note: null, estimated: true };
}

/** 温泉（入浴目的）は最後に回す。 */
export function isOnsen(s) {
  return Boolean(s) && (s.kind === '温泉' || /温泉|の湯|スパ/.test(String(s.name ?? '')));
}

function* permutations(arr) {
  if (arr.length <= 1) { yield arr.slice(); return; }
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

function pathCost(path, start, course) {
  let cost = 0;
  let prev = start;
  for (const s of path) {
    cost += estimateMove(prev, s, course).minutes;
    prev = s;
  }
  return cost;
}

/** 近い所から順に（最も近いものを取っていく）。場所が多すぎて全順列を見られん時の代わり。 */
function greedy(list, start, course) {
  const rest = list.slice();
  const out = [];
  let prev = start;
  while (rest.length) {
    let best = 0;
    for (let i = 1; i < rest.length; i++) if (estimateMove(prev, rest[i], course).minutes < estimateMove(prev, rest[best], course).minutes) best = i;
    const s = rest.splice(best, 1)[0];
    out.push(s);
    prev = s;
  }
  return out;
}

/**
 * 起点（目的地の座標）から全順列で移動の合計が最小の順。温泉は最後（最後でない順は採らん）。
 * 座標の無い場所は最後に付ける。各場所に moveToNext（目安）を付け、最後は null。元の配列は変えない。
 */
export function orderSpots(spots, center, course) {
  const all = (spots || []).map((s) => ({ ...s }));
  const withC = all.filter(hasCoord);
  const without = all.filter((s) => !hasCoord(s));
  const start = hasCoord(center) ? center : withC[0] || null;
  let best = null;
  if (withC.length <= 7) {
    let bestCost = Infinity;
    const hasOnsen = withC.some(isOnsen);
    for (const p of permutations(withC)) {
      if (hasOnsen && !isOnsen(p[p.length - 1])) continue;
      const c = pathCost(p, start, course);
      if (c < bestCost) { bestCost = c; best = p; }
    }
  }
  if (!best) {
    const onsen = withC.filter(isOnsen);
    best = [...greedy(withC.filter((s) => !isOnsen(s)), start, course), ...onsen];
  }
  const ordered = [...best, ...without];
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].moveToNext = i < ordered.length - 1 ? estimateMove(ordered[i], ordered[i + 1], course) : null;
  }
  return ordered;
}

// 滞在を短くする下限（§17.6）：お散歩は 30 分・ほかは 45 分。主役は 45 分より短くせん。15 分ずつ。
const STAY_FLOOR = { walk: 30, half: 45, full: 45 };
const HERO_FLOOR = 45;
const STAY_STEP = 15;

function floorOf(s, course) {
  return s.hero ? Math.max(HERO_FLOOR, STAY_FLOOR[course] ?? 45) : (STAY_FLOOR[course] ?? 45);
}

/**
 * 並べて時間を計り、予算（＋15 分）を超えたら：
 *  ① 滞在の一番長い場所から 15 分ずつ短くする（下限まで）
 *  ② それでも超えたら、主役（hero）以外で priority の一番大きい（Gemini の優先順の後ろ）場所を外す（最低 1 か所）
 * → { spots（並び済み・moveToNext 付き）, dropped, shortened（短くした回数）, totalMinutes }。元の配列は変えない。
 */
export function fitToBudget(spots, center, course, startTime) {
  const budget = (BUDGET_MINUTES[course] ?? BUDGET_MINUTES.half) + BUDGET_SLACK;
  let live = (spots || []).map((s) => ({ ...s }));
  const dropped = [];
  let shortened = 0;
  for (;;) {
    const ordered = orderSpots(live, center, course);
    const sched = computeSchedule(ordered.map((s, i) => ({ ...s, n: i + 1 })), startTime, { lunch: true });
    const total = sched.totalMinutes;
    const used = total - (sched.lunch ? LUNCH_MINUTES : 0);
    if (used <= budget || (live.length <= 1 && !live.some((s) => (Number(s.stayMinutes) || 0) > floorOf(s, course)))) {
      return { spots: ordered, dropped, shortened, totalMinutes: total };
    }
    const shrinkable = live.filter((s) => (Number(s.stayMinutes) || 0) > floorOf(s, course));
    if (shrinkable.length) {
      const longest = shrinkable.reduce((a, b) => ((Number(b.stayMinutes) || 0) > (Number(a.stayMinutes) || 0) ? b : a));
      longest.stayMinutes = Math.max(floorOf(longest, course), (Number(longest.stayMinutes) || 0) - STAY_STEP);
      shortened++;
      continue;
    }
    const removable = live.filter((s) => !s.hero);
    if (!removable.length || live.length <= 1) return { spots: ordered, dropped, shortened, totalMinutes: total };
    const victim = removable.reduce((a, b) => ((Number(b.priority) || 0) > (Number(a.priority) || 0) ? b : a));
    live = live.filter((s) => s !== victim);
    dropped.push(victim);
  }
}
