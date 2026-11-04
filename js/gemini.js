// Gemini API の呼び出しと返事の取り出し（設計書 §5）。
// キーは x-goog-api-key ヘッダで送る（URL に付けない）。ログに出さない。

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const MODEL_PREFERENCE = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.kind = classifyError(status);
  }
}

export function classifyError(status) {
  if (status === 400 || status === 401 || status === 403) return 'key';
  if (status === 429) return 'quota';
  return 'other';
}

/** models.list の名前一覧（"models/…" 付きでも可）から、好みの順で最初に見つかったものを返す。 */
export function pickModel(modelNames) {
  const names = new Set((modelNames || []).map((n) => String(n).replace(/^models\//, '')));
  return MODEL_PREFERENCE.find((m) => names.has(m)) ?? null;
}

/** 返事の文から JSON オブジェクトを取り出す。``` や前置きを落とし、最初の { から最後の } まで。 */
export function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(s.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function httpsOrNull(v) {
  const s = strOrNull(v);
  return s && /^https:\/\//i.test(s) ? s : null;
}

/** Gemini の JSON を決まった形に揃える。spots が無い／name のある場所が 1 つも無ければ null。 */
export function normalizeTripJson(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (!Array.isArray(obj.spots)) return null;
  const spots = obj.spots
    .filter((s) => s && typeof s === 'object' && typeof s.name === 'string' && s.name.trim())
    .map((s) => {
      const m = s.move_to_next;
      const move = m && typeof m === 'object'
        ? { mode: strOrNull(m.mode), minutes: numOrNull(m.minutes), note: strOrNull(m.note) }
        : null;
      return {
        name: s.name.trim(),
        kind: strOrNull(s.kind),
        summary: strOrNull(s.summary),
        stay_minutes: numOrNull(s.stay_minutes),
        cost_yen: numOrNull(s.cost_yen),
        cost_note: strOrNull(s.cost_note),
        hours: strOrNull(s.hours),
        official_url: httpsOrNull(s.official_url),
        move_to_next: move,
      };
    });
  if (spots.length === 0) return null;
  return { destination: strOrNull(obj.destination), area: strOrNull(obj.area), spots };
}

/** generateContent の本文（設計書 §5.3）。 */
export function buildRequestBody({ system, user, model, useSearch = true }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
  };
  if (useSearch) body.tools = [{ googleSearch: {} }];
  if (/^gemini-2\.5/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  return body;
}

function headers(apiKey) {
  return { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' };
}

export async function listModels({ apiKey, fetchImpl = fetch, signal } = {}) {
  const res = await fetchImpl(`${BASE}/models?pageSize=200`, { headers: headers(apiKey), signal });
  if (!res.ok) throw new GeminiError(`models.list failed: ${res.status}`, res.status);
  const data = await res.json();
  return (data.models || []).map((m) => m.name);
}

/** 1 回の生成。返事の text（parts を結合）と refs（検索根拠づけの出典）。 */
export async function generate({ apiKey, model, system, user, useSearch = true, fetchImpl = fetch, signal } = {}) {
  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(buildRequestBody({ system, user, model, useSearch })),
    signal,
  });
  if (!res.ok) {
    // 原因の切り分け用（キーは含まれん）。画面には出さん。
    let head = '';
    try { head = (await res.text()).slice(0, 300); } catch { /* 本文なし */ }
    console.error('generateContent failed', res.status, model, head);
    throw new GeminiError(`generateContent failed: ${res.status}`, res.status);
  }
  const data = await res.json();
  const cand = data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
  const chunks = (cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  const refs = chunks
    .filter((c) => c && c.web && typeof c.web.uri === 'string')
    .map((c) => ({ title: c.web.title || '', uri: c.web.uri }));
  // Google 検索根拠づけの利用条件＝返ってきた検索候補（searchEntryPoint）は画面に出す
  const sep = cand && cand.groundingMetadata && cand.groundingMetadata.searchEntryPoint;
  const searchHtml = sep && typeof sep.renderedContent === 'string' && sep.renderedContent ? sep.renderedContent : null;
  return { text, refs, searchHtml };
}
