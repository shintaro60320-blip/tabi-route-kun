// 生成の流れ（設計書 §17）：候補を集める → 季節と除外 → Gemini が選ぶ → 順番と時間はアプリ → 組む → 保存。

import { SYSTEM_INSTRUCTION, buildPickPrompt, pickSchema, COURSES } from './prompt.js';
import { MODEL_PREFERENCE, generate, extractJson, normalizePicks, GeminiError, DEFAULT_STAY } from './gemini.js';
import { createNominatim, defaultNominatim, normalizeTitle } from './verify.js';
import { collectCandidates, scoreCandidates, distanceKm, matchSpotToCandidates, CandidateError, COURSE_RADIUS_KM, firstSentence } from './candidates.js';
import { applySeason, todayJst } from './season.js';
import { fitToBudget } from './route.js';
import { buildTrip, spotFromPick } from './trip.js';
import { loadCands, saveCands } from './candcache.js';

export const COORD_FILL_MAX = 6; // 座標を補う候補の数（§17.2-5・§18.8）

// 同じ行き先・コースの候補はセッション内で使い回す（作り直しで Wikipedia を叩き直さん）。部分取得（partial）は入れん。テスト（fetchImpl 差し替え）では使わん。
const candidateCache = new Map();

function hasCoord(c) {
  return typeof c.lat === 'number' && Number.isFinite(c.lat) && typeof c.lng === 'number' && Number.isFinite(c.lng);
}

/** 座標の無い地元候補を点数順に最大 4 件、Nominatim で補う（§17.2-5）。それでも無い候補は落とし、コースの範囲で切る。 */
export async function completeCoords(cands, course, nominatim, signal) {
  const list = cands.candidates.map((c) => ({ ...c }));
  // 記事のある候補（座標だけ無い）を先に、次に名前だけの候補。目的地の周り ±0.5 度に絞って名前だけで引く（実測：「庄原上野公園」が引ける）
  // 主役の記事に出てくる所（linked）→ 記事のある地元候補 → 名前だけの地元候補 の順
  const lacking = list.filter((c) => !hasCoord(c) && (c.local || c.linked));
  const rank = (c) => (c.linked ? 0 : c.wikiTitle ? 1 : 2);
  const need = lacking.slice().sort((a, b) => rank(a) - rank(b)).slice(0, COORD_FILL_MAX);
  const failed0 = Number(nominatim.failures) || 0;
  for (const c of need) {
    const got = await nominatim(c.name, { signal, viewbox: cands.center || null });
    if (got) {
      c.lat = got.lat; c.lng = got.lng; c.coordSource = 'osm';
      c.distKm = cands.center ? distanceKm(cands.center, got) : null;
    }
  }
  const r = COURSE_RADIUS_KM[course] ?? COURSE_RADIUS_KM.half;
  // 地図に断られた回は部分取得（減った候補を使い回し・保存に入れん）
  const failed = (Number(nominatim.failures) || 0) > failed0;
  return { ...cands, partial: Boolean(cands.partial) || failed, candidates: list.filter((c) => hasCoord(c) && (typeof c.distKm !== 'number' || c.distKm <= r)) };
}

/** 候補集め＋座標の補完。落ちたら投げる（§17.2-7：候補なしの自由生成はせん）。 */
async function candidatesFor(destination, course, { fetchImpl, signal, useCache, nominatim, storage = null }) {
  const key = `${destination}|${course}`;
  if (useCache && candidateCache.has(key)) return candidateCache.get(key);
  // 端末に残した候補（7 日・§18.7）：同じ行き先は Wikipedia を叩き直さず、すぐ出す
  const saved = useCache ? loadCands(storage, key) : null;
  if (saved) { candidateCache.set(key, saved); return saved; }
  const raw = await collectCandidates(destination, { course, fetchImpl, signal });
  if (!raw.ok) return raw;
  const r = await completeCoords(raw, course, nominatim, signal);
  if (useCache && !r.partial) { candidateCache.set(key, r); saveCands(storage, key, r); }
  return r;
}

/** 端末に残っとる同じ行き先の旅の場所（外した分は除く）＝2回目モードの「前に提案した場所」。 */
export function visitedNames(store, destination) {
  const key = normalizeTitle(destination);
  const names = [];
  for (const t of store.getTrips()) {
    if (normalizeTitle(t.destination) !== key) continue;
    for (const s of t.spots || []) if (!s.removed && s.name && !names.includes(s.name)) names.push(s.name);
  }
  return names;
}

/** モードの除外（§17.3）：2回目は★と前に提案した場所を外す。 */
export function selectable(candidates, mode, visited) {
  if (mode !== 'second') return candidates.slice();
  const seen = (visited || []).filter(Boolean);
  return candidates.filter((c) => !c.star && !seen.some((v) => matchSpotToCandidates(v, [c])));
}

export class FlowError extends Error {
  constructor(kind, cause) {
    super(kind);
    this.name = 'FlowError';
    this.kind = kind; // offline | nokey | key | quota | parse | timeout | empty | wiki | nomore | other
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
  wiki: { text: '場所の情報を調べるサービス（Wikipedia）が混み合っていて、情報が取れませんでした。1分ほど待ってから、もう一度お試しください。', action: 'retry' },
  nomore: { text: 'この範囲で、まだ行っていない場所が見つかりませんでした。定番に戻すか、行き先を変えてみてください。', action: 'back' },
  other: { text: 'うまく作れませんでした。もう一度お試しください。', action: 'retry' },
};

export function errorMessage(kind) {
  return MESSAGES[kind] || MESSAGES.other;
}

function toFlowError(e) {
  if (e instanceof FlowError) return e;
  if (e && e.name === 'AbortError') return new FlowError('timeout', e);
  if (e instanceof CandidateError) return new FlowError('wiki', e);
  if (e instanceof GeminiError) return new FlowError(e.kind === 'other' ? 'other' : e.kind, e);
  if (e instanceof TypeError) return new FlowError('offline', e); // fetch の失敗
  return new FlowError('other', e);
}

/**
 * 1 回の生成。成功なら Trip（保存済み）。失敗は FlowError。
 * deps: { fetchImpl, now, sleep }（テストで差し替え）
 */
export async function generateTrip({ destination, course, startTime, mode = 'classic', travelDate = null, settings, store, deps = {}, signal, onStage = null } = {}) {
  // 途中の表示（§18.7）：collect＝まわりを調べる／pick＝Gemini が選ぶ／build＝ルートを組む
  const stage = (s) => { if (typeof onStage === 'function') { try { onStage(s); } catch { /* 表示の失敗で止めん */ } } };
  const fetchImpl = deps.fetchImpl || fetch;
  const now = deps.now || Date.now;
  const sleep = deps.sleep;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new FlowError('offline');
  if (!settings || !settings.apiKey) throw new FlowError('nokey');
  const courseCount = (COURSES[course] && COURSES[course].count) || 0;
  if (!courseCount) throw new FlowError('other');
  // テストで差し替えた時だけ専用の待ち行列。本番はアプリ全体で 1 本（規約：1 秒 1 回）
  const nominatim = deps.fetchImpl ? createNominatim({ fetchImpl, ...(deps.now ? { now } : {}), ...(sleep ? { sleep } : {}) }) : defaultNominatim;

  // 候補（§16.2・§17.2）：Wikipedia から。取れんかったら止める
  let cands;
  try {
    stage('collect');
    const storage = !deps.fetchImpl && typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
    cands = await candidatesFor(destination, course, { fetchImpl, signal, useCache: !deps.fetchImpl, nominatim, storage });
  } catch (e) {
    throw toFlowError(e);
  }
  if (!cands.ok) throw new FlowError('empty');

  // 季節（§17.5）→ 並べ直し（季節の加点・id の振り直し）→ モードの除外（§17.3）
  const date = travelDate || todayJst(now);
  const ranked = scoreCandidates(applySeason(cands.candidates, date));
  const visited = mode === 'second' ? visitedNames(store, destination) : [];
  const pool = selectable(ranked, mode, visited);
  if (pool.length === 0) throw new FlowError(mode === 'second' ? 'nomore' : 'empty');
  const wanted = Math.min(courseCount, pool.length);
  const notes = [];
  if (pool.length < courseCount) notes.push(`この範囲で見つかった場所は${pool.length}か所でした。`);
  const destName = String(destination ?? '').trim() || (cands.dest && cands.dest.title) || '';

  const apiKey = settings.apiKey;
  let useSearch = settings.useSearch !== false;
  let useSchema = settings.useSchema !== false;
  const preferred = settings.model || MODEL_PREFERENCE[0];
  // 切替先は「キー確認で使えると分かったモデル」の中から（分からん時は好みの順）
  const known = Array.isArray(settings.models) && settings.models.length ? settings.models.map((m) => String(m).replace(/^models\//, '')) : null;
  const poolModels = known ? MODEL_PREFERENCE.filter((m) => known.includes(m)) : MODEL_PREFERENCE;
  const order = [preferred, ...poolModels.filter((m) => m !== preferred)];
  let modelIndex = 0;
  let model = order[modelIndex];
  const system = SYSTEM_INSTRUCTION;
  const user = buildPickPrompt({ destination: destName, course, mode, travelDate: date, candidates: pool, count: wanted });
  const schema = pickSchema(pool.map((c) => c.id), wanted);

  // 1 回の呼び出し＋立て直し：
  //  ・検索根拠づけ付きで 429 → 同じモデルで根拠づけを外して再試行（通れば以後は外したまま覚える。実測：無料枠では tools が 429）
  //  ・スキーマ付きで 400 → スキーマを外して再試行（通れば以後は外したまま覚える・§17.4）
  //  ・それでも 429、または 404（一覧にあっても使えんモデル）→ 次の使えるモデルへ 1 回だけ
  async function call(userText) {
    store.bumpUsage(new Date());
    return generate({ apiKey, model, system, user: userText, useSearch, schema: useSchema ? schema : null, fetchImpl, signal });
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
      if (e.status === 400 && useSchema) {
        useSchema = false;
        try {
          const r = await call(userText);
          store.saveSettings({ useSchema: false });
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

  try {
    stage('pick');
    let res = await ask(user);
    let picks = normalizePicks(extractJson(res.text), pool);
    if (!picks) {
      res = await ask(`${user}\n\nJSON だけを返してください。`);
      picks = normalizePicks(extractJson(res.text), pool);
      if (!picks) throw new FlowError('parse');
    }
    // 主役（目的地そのもの）は Gemini が選ばんでも 1 か所目（§17.2-2）
    const hero = pool.find((c) => c.hero);
    if (hero && !picks.some((p) => p.candidate.id === hero.id)) {
      picks.unshift({ candidate: hero, kind: '観光', reason: firstSentence(hero.extract, 80) || null, stay_minutes: DEFAULT_STAY['観光'], cost_yen: null, cost_note: null, priority: -1 });
    }
    if (picks.length === 0) throw new FlowError('empty');
    picks = picks.slice(0, wanted);

    // 順番と時間（§17.6）
    stage('build');
    const spots = picks.map(spotFromPick);
    const fit = fitToBudget(spots, cands.center, course, startTime);
    if (signal && signal.aborted) throw new FlowError('timeout');
    if (fit.dropped.length) notes.push(`時間に収まるよう${fit.spots.length}か所にしました。`);
    else if (fit.shortened) notes.push('時間に収まるよう、見学の時間を短めにしています。');
    const trip = buildTrip({
      destination: destName, area: cands.area || '', course, startTime, model, now: new Date(), mode, travelDate: date,
      spots: fit.spots, wanted, note: notes.join(' ') || null, dropped: fit.dropped.map((s) => s.name), refs: res.refs, searchHtml: res.searchHtml,
    });
    store.addTrip(trip);
    return trip;
  } catch (e) {
    throw toFlowError(e);
  }
}
