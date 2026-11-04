// 生成の流れ（設計書 §2.4 §5 §9）：問う → 取り出す → 確かめる → 組む → 保存。

import { SYSTEM_INSTRUCTION, buildUserPrompt, COURSES } from './prompt.js';
import { MODEL_PREFERENCE, generate, extractJson, normalizeTripJson, GeminiError } from './gemini.js';
import { verifyAll, createNominatim, defaultNominatim, normalizeTitle } from './verify.js';
import { collectCandidates, matchSpotToCandidates } from './candidates.js';
import { buildTrip } from './trip.js';

// 同じ行き先・コースの候補はセッション内で使い回す（作り直しで Wikipedia を叩き直さん）。テスト（fetchImpl 差し替え）では使わん。
const candidateCache = new Map();

/** 候補集め。落ちたら「候補なし」で続ける（中断だけは投げる）。 */
async function candidatesFor(destination, course, { fetchImpl, signal, useCache }) {
  const key = `${destination}|${course}`;
  if (useCache && candidateCache.has(key)) return candidateCache.get(key);
  let r;
  try {
    r = await collectCandidates(destination, { course, fetchImpl, signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    r = { ok: false, area: null, center: null, dest: null, candidates: [] };
  }
  if (useCache && r.ok) candidateCache.set(key, r);
  return r;
}

/** 端末に残っとる同じ行き先の旅の場所（外した分は除く）＝2回目モードの「すでに行った場所」。 */
export function visitedNames(store, destination) {
  const key = normalizeTitle(destination);
  const names = [];
  for (const t of store.getTrips()) {
    if (normalizeTitle(t.destination) !== key) continue;
    for (const s of t.spots || []) if (!s.removed && s.name && !names.includes(s.name)) names.push(s.name);
  }
  return names;
}

export class FlowError extends Error {
  constructor(kind, cause) {
    super(kind);
    this.name = 'FlowError';
    this.kind = kind; // offline | nokey | key | quota | parse | timeout | empty | other
    this.cause = cause;
  }
}

const MESSAGES = {
  offline: { text: 'インターネットにつながっていません。電波のある所でもう一度お試しください。', action: 'retry' },
  nokey: { text: 'はじめに設定が必要です。右上の歯車から Gemini のキーを入れてください。', action: 'settings' },
  key: { text: 'キーが正しくないようです。設定画面で確かめてください。', action: 'settings' },
  quota: { text: '今日の分を使い切りました。明日（夕方以降）また使えます。', action: 'back' },
  parse: { text: 'うまく作れませんでした。もう一度お試しください。', action: 'retry' },
  timeout: { text: '時間がかかりすぎました。もう一度お試しください。', action: 'retry' },
  empty: { text: '見つかりませんでした。行き先の名前を変えて試してください（例：大阪城 → 大阪城公園）。', action: 'back' },
  other: { text: 'うまく作れませんでした。もう一度お試しください。', action: 'retry' },
};

export function errorMessage(kind) {
  return MESSAGES[kind] || MESSAGES.other;
}

function toFlowError(e) {
  if (e instanceof FlowError) return e;
  if (e && e.name === 'AbortError') return new FlowError('timeout', e);
  if (e instanceof GeminiError) return new FlowError(e.kind === 'other' ? 'other' : e.kind, e);
  if (e instanceof TypeError) return new FlowError('offline', e); // fetch の失敗
  return new FlowError('other', e);
}

function todayIso(now) {
  const d = new Date(now());
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

/**
 * 1 回の生成。成功なら Trip（保存済み）。失敗は FlowError。
 * deps: { fetchImpl, now, sleep }（テストで差し替え）
 */
export async function generateTrip({ destination, course, startTime, mode = 'classic', settings, store, deps = {}, signal } = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const now = deps.now || Date.now;
  const sleep = deps.sleep;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new FlowError('offline');
  if (!settings || !settings.apiKey) throw new FlowError('nokey');

  // 候補（§16.2）：Wikipedia から。取れんかったら従来どおり Gemini に任せる
  let cands;
  try {
    cands = await candidatesFor(destination, course, { fetchImpl, signal, useCache: !deps.fetchImpl });
  } catch (e) {
    throw toFlowError(e);
  }
  const useCands = cands.ok && cands.candidates.length > 0;
  const courseCount = (COURSES[course] && COURSES[course].count) || 0;
  const wanted = useCands ? Math.min(courseCount, cands.candidates.length) : courseCount;
  const note = useCands && cands.candidates.length < courseCount ? `この範囲で見つかった場所は${cands.candidates.length}か所でした。` : null;
  const visited = mode === 'second' ? visitedNames(store, destination) : [];

  const apiKey = settings.apiKey;
  let useSearch = settings.useSearch !== false;
  const preferred = settings.model || MODEL_PREFERENCE[0];
  // 切替先は「キー確認で使えると分かったモデル」の中から（分からん時は好みの順）
  const known = Array.isArray(settings.models) && settings.models.length ? settings.models.map((m) => String(m).replace(/^models\//, '')) : null;
  const pool = known ? MODEL_PREFERENCE.filter((m) => known.includes(m)) : MODEL_PREFERENCE;
  const order = [preferred, ...pool.filter((m) => m !== preferred)];
  let modelIndex = 0;
  let model = order[modelIndex];
  const system = SYSTEM_INSTRUCTION;
  const user = buildUserPrompt({ destination, course, startTime, today: todayIso(now), mode, candidates: useCands ? cands.candidates : [], visited });

  // 1 回の呼び出し＋立て直し：
  //  ・検索根拠づけ付きで 429 → 同じモデルで根拠づけを外して再試行（通れば以後は外したまま覚える。実測：無料枠では tools が 429）
  //  ・それでも 429、または 404（一覧にあっても使えんモデル）→ 次の使えるモデルへ 1 回だけ
  async function call(userText) {
    store.bumpUsage(new Date());
    return generate({ apiKey, model, system, user: userText, useSearch, fetchImpl, signal });
  }
  async function ask(userText) {
    try {
      return await call(userText);
    } catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      if (e.kind === 'quota' && useSearch) {
        useSearch = false;
        try {
          const r = await call(userText);
          store.saveSettings({ useSearch: false });
          return r;
        } catch (e2) {
          if (!(e2 instanceof GeminiError)) throw e2;
          e = e2;
        }
      }
      const unavailable = e.kind === 'quota' || e.status === 404;
      if (unavailable && modelIndex === 0 && order.length > 1) {
        modelIndex = 1;
        model = order[modelIndex];
        try {
          const r = await call(userText);
          if (e.status === 404) store.saveSettings({ model });
          return r;
        } catch (e3) {
          if (e3 instanceof GeminiError && e3.kind === 'quota') store.setDailyLimit(store.getUsage(new Date()));
          throw e3;
        }
      }
      if (e.kind === 'quota') store.setDailyLimit(store.getUsage(new Date()));
      throw e;
    }
  }

  // 候補と照合（§16.3）：一覧に無い名前は捨て、名前を候補の表記に揃える
  function alignToCandidates(normalized) {
    if (!useCands) return normalized;
    const used = new Set();
    const spots = [];
    for (const s of normalized.spots) {
      const c = matchSpotToCandidates(s.name, cands.candidates);
      if (!c || used.has(c.name)) continue;
      used.add(c.name);
      spots.push({ ...s, name: c.name, wikiTitle: c.wikiTitle });
    }
    return { ...normalized, spots };
  }

  let normalized;
  try {
    let res = await ask(user);
    let obj = extractJson(res.text);
    if (!obj) {
      res = await ask(`${user}\n\nJSON だけを返してください。`);
      obj = extractJson(res.text);
      if (!obj) throw new FlowError('parse');
    }
    normalized = normalizeTripJson(obj);
    if (normalized) normalized = alignToCandidates(normalized);
    if (useCands && (!normalized || normalized.spots.length === 0)) {
      // 一覧と一つも合わん → 1 回だけ言い直す
      res = await ask(`${user}\n\n候補の一覧にある名前だけを、一字一句そのまま使ってください。`);
      obj = extractJson(res.text);
      normalized = obj ? alignToCandidates(normalizeTripJson(obj) || { spots: [] }) : null;
    }
    if (!normalized || normalized.spots.length === 0) throw new FlowError('empty');
    // コースの場所数を超えた分は切る（確認通信もその分だけ）
    const cap = wanted || normalized.spots.length;
    if (normalized.spots.length > cap) normalized.spots = normalized.spots.slice(0, cap);

    const area = normalized.area || (useCands && cands.area) || '';
    // テストで差し替えた時だけ専用の待ち行列。本番はアプリ全体で 1 本（規約：1 秒 1 回）
    const nominatim = deps.fetchImpl ? createNominatim({ fetchImpl, ...(deps.now ? { now } : {}), ...(sleep ? { sleep } : {}) }) : defaultNominatim;
    const verifyResults = await verifyAll(normalized.spots, area, { fetchImpl, nominatim, signal });
    if (signal && signal.aborted) throw new FlowError('timeout');
    const trip = buildTrip({ destination, course, startTime, model, normalized: { ...normalized, area }, refs: res.refs, verifyResults, searchHtml: res.searchHtml, now: new Date(), mode, wanted, note });
    store.addTrip(trip);
    return trip;
  } catch (e) {
    throw toFlowError(e);
  }
}
