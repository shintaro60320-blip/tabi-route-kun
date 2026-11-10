// 集めた候補を端末に残す（設計書 §18.7）。同じ行き先・コースは 7 日のあいだ Wikipedia を叩き直さず、すぐ出す。
// 保存先（localStorage）が無い・書けん・壊れとる時は、何も返さんだけで落ちん。

export const CANDS_KEY = 'trk.cands.v3'; // 候補の形を変えたら数字を上げる（古い保存を読まん）
export const CANDS_TTL_MS = 7 * 86400 * 1000;
export const CANDS_MAX = 6;
const EXTRACT_MAX = 240;

function readAll(storage) {
  try {
    const raw = storage ? storage.getItem(CANDS_KEY) : null;
    if (!raw) return { items: {} };
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && v.items && typeof v.items === 'object' ? v : { items: {} };
  } catch {
    return { items: {} };
  }
}

/** key（`行き先|コース`）の候補。無い・古い（7 日）なら null。 */
export function loadCands(storage, key, now = Date.now) {
  const all = readAll(storage);
  const hit = all.items[key];
  if (!hit || !hit.value || typeof hit.at !== 'number') return null;
  if (now() - hit.at > CANDS_TTL_MS) return null;
  return hit.value;
}

/** 候補を残す。部分取得（partial）と失敗（ok でない）は残さん。新しい順に 6 件まで。 */
export function saveCands(storage, key, value, now = Date.now) {
  if (!storage || !value || !value.ok || value.partial) return false;
  try {
    const all = readAll(storage);
    all.items[key] = {
      at: now(),
      value: {
        ...value,
        candidates: (value.candidates || []).map((c) => ({ ...c, extract: typeof c.extract === 'string' ? c.extract.slice(0, EXTRACT_MAX) : c.extract ?? null })),
      },
    };
    const keys = Object.keys(all.items).sort((a, b) => all.items[b].at - all.items[a].at);
    for (const k of keys.slice(CANDS_MAX)) delete all.items[k];
    storage.setItem(CANDS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}
