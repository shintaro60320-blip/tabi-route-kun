// 候補の集め方（設計書 §16.2・§17.2）：Gemini の記憶ではなく Wikipedia から「その土地の場所」を集め、Gemini には選ぶだけをさせる。
// 前半＝純粋関数（ふるい・節の読み方・並べ方）、後半＝通信（createWikiClient・collectCandidates）。

import { normalizeTitle, titlesMatch, parseWikiPage, wikiLookup } from './verify.js';

const WIKI = 'https://ja.wikipedia.org/w/api.php';
const UA = 'TabiRouteKun/1.2 (personal use)';
const HEADERS = { 'Api-User-Agent': UA };
export const MAX_CANDIDATES = 40;
export const MIN_LENGTH_NEARBY = 2500; // 近傍だけで拾った記事は、これより短ければ無名と見なす
export const MAX_TITLES = 200; // 記事名の一覧は近い順にここまで（50 件×4 通信が上限・§17.2-6）
export const COURSE_RADIUS_KM = { walk: 2, half: 10, full: 30 };

// ---- ふるい（§16.2-5）：近傍で拾った記事のうち、観光と関係ない施設を落とす
const NOISE = /郵便局|警察|消防|学校|大学|高校|幼稚園|保育|病院|医院|診療|役所|役場|庁舎|庁$|銀行|信用|協同組合|株式会社|会社|放送|テレビ|ラジオ|新聞|営業所|支店|センタービル|ビル$|マンション|団地|住宅|ホテル|インターチェンジ|ジャンクション|サービスエリア|パーキングエリア|出入口|バイパス|国道|県道|道路|線$|トンネル|\d+号墳|遺跡$|変電所|発電所|工場|浄水|処理場|下水|用水|ダム$|選挙区|郡$|市$|町$|村$|区$|丁目|領事館|大使館|宿舎|寮$|周年|交通$|センター$|組合|法人|機構|事務所|本部|王朝|年$|府$|県$|検車場|気象台|車両基地/;
const STATION = /(?<!道の)駅$/;
// 催し物が無ければ見る物が無い所（全部の源に掛ける。観光地カテゴリにはコンサートホールや劇場も入っとる）
const VENUE = /ホール$|劇場$|シアター|歌舞伎座|松竹座|花月$|ライブハウス|スタジアム|球場$|競技場|アリーナ$|百貨店$|ショッピングセンター|モール$|アウトレット|映画館|シネマ|会館$|音楽堂$|能楽堂$|センター$/;
// 記事の最初の一文で分かる催し物会場・商業施設・会社（実例：楽屋A「お笑い劇場」・ほたるまち「複合施設」・伊藤忠食品「株式会社」）
const EXTRACT_VENUE = /劇場|ライブハウス|ホール|映画館|複合施設|商業施設|オフィスビル|株式会社|企業|放送局|本社|検車場|気象台/;

/** 説明文の最初の一文から、観光地として渡さん方がよいと分かる所。 */
export function isVenueByExtract(extract) {
  return EXTRACT_VENUE.test(firstSentence(extract, 200));
}

/** 観光地として渡さん方がよい所（催し物会場・商業施設）。 */
export function isVenue(title) {
  return VENUE.test(baseName(title));
}

function baseName(title) {
  return String(title ?? '').replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
}

export function isNoise(title) {
  const b = baseName(title);
  if (!b) return true;
  return NOISE.test(b) || STATION.test(b);
}

// ---- 市町村記事の「観光」節（§16.2-3 A）
const KANKO_HEAD = /観光|名所|名勝|見どころ|レジャー/;
const SKIP_SUB = /祭|催事|産品|土産|文化|人物|料理|特産|グルメ|名物|作品|出身|イベント|方言|食/;
const CLOSED = /閉鎖|閉園|閉館|廃止|休業|休止|廃校|撤去|営業終了|解体/;
// 記事の冒頭で分かる「もう無い」所（実例：スノーリゾート猫山「…にあったスキー場」）
const CLOSED_EXTRACT = /にあった|かつて(?:存在|営業|あった)|閉鎖され|閉園し|閉館し|廃止され|営業を終了|廃業|取り壊され/;

/** 説明文（記事の冒頭）から「もう無い」と分かる所。 */
export function isClosedByExtract(extract) {
  return CLOSED_EXTRACT.test(String(extract ?? ''));
}
const LISTY = /100選|一覧|^\d+年$|^\d+月\d+日$|^\d+月$/;

/** `action=parse&prop=sections` の一覧から観光の level-2 節の index。無ければ null。 */
export function pickKankoSection(sections) {
  const hit = (sections || []).find((s) => s && String(s.level) === '2' && KANKO_HEAD.test(String(s.line ?? '')));
  return hit ? String(hit.index) : null;
}

const LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

function stripMarkup(s) {
  return s
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[https?:[^\s\]]+\s*([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** 観光節の wikitext → [{name, wikiTitle|null}]（閉鎖・催事・産品・100選を除く）。 */
export function parseKankoSection(wikitext) {
  const lines = String(wikitext ?? '').split(/\r?\n/);
  const out = [];
  const seen = new Set();
  let skipSub = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const head = raw.match(/^(={2,})\s*(.+?)\s*\1\s*$/);
    if (head) {
      skipSub = head[1].length >= 3 && SKIP_SUB.test(head[2]);
      continue;
    }
    if (skipSub) continue;
    const m = raw.match(/^(\*+)\s*(.+)$/);
    if (!m) continue;
    const next = lines[i + 1] || '';
    const nextDepth = (next.match(/^(\*+)/) || ['', ''])[1].length;
    if (nextDepth > m[1].length) continue; // 下に段がある行＝「スキー場」のような見出し代わり
    const body = m[2];
    if (CLOSED.test(body)) continue;
    const links = [];
    const text = stripMarkup(body.replace(LINK, (_, t, label) => {
      const title = t.trim();
      links.push({ title, label: (label ?? title).trim() });
      return (label ?? title).trim();
    }));
    const name = text.split(/[（(]/)[0].replace(/[\s:：・]+$/, '').trim();
    if (!name || name.length > 30 || LISTY.test(name) || /ISBN/.test(name)) continue;
    const key = normalizeTitle(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // 記事は「名前がそのリンクそのもの」の時だけ（`[[福寿草]]自生地` の 福寿草 は花の記事＝場所やない・2026-11-06 実測）
    const link = links.find((l) => normalizeTitle(l.title) === key || (normalizeTitle(l.label) === key && titlesMatch(l.label, l.title)));
    const wikiTitle = link && !LISTY.test(link.title) ? link.title : null;
    out.push({ name, wikiTitle });
  }
  return out;
}

// ---- 市町村の決め方（§16.2-2・§17.2-3：県は返さん）
export function pickMunicipality(page) {
  const title = page && page.title ? String(page.title) : '';
  const cats = ((page && page.categories) || []).map(String);
  if (cats.some((c) => /の市町村$/.test(c) || /^Category:.+[都道府県市]の(市|町|村|区)$/.test(c))) return title || null;
  for (const c of cats) {
    const m = c.match(/^Category:(.+?)の観光地$/);
    if (m && /[市町村区]$/.test(m[1])) return m[1];
  }
  for (const c of cats) {
    const m = c.match(/^Category:(.+?[市町村])の/);
    if (m && !/^日本/.test(m[1])) return m[1];
  }
  return null;
}

// ---- 距離・並べ方・コース
export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function hasDist(c) {
  return typeof c.distKm === 'number' && Number.isFinite(c.distKm);
}

/**
 * 地元一覧（local＝市町村記事の観光節・観光地カテゴリ：+3）・記事の長さ（≥8,000: +2・≥3,000: +1）・写真（+1）・近さ（≤1km: +3・≤3km: +2・≤6km: +1）・
 * 季節の見どころ（seasonBonus・§17.5）。主役（hero＝目的地そのもの）は必ず先頭。同点は近い順（距離不明は後）。上位 40 件。
 * ★定番候補＝主役＋地元一覧の中の上位 1/3（最低 3 件）だけ。残りの地元一覧が「2回目」の玉になる。
 * 並べた後に id（c1, c2, …）を付ける（Gemini はこの id で選ぶ・§17.4）。
 */
export function scoreCandidates(list) {
  const scored = (list || []).map((c) => {
    const len = Number(c.length) || 0;
    const local = Boolean(c.local);
    const d = hasDist(c) ? c.distKm : Infinity;
    const nearRaw = d <= 1 ? 3 : d <= 3 ? 2 : d <= 6 ? 1 : 0; // 目的地の周りを優先（都市で市内全域の有名所に引っ張られんため）
    const near = local ? nearRaw : Math.min(nearRaw, 1); // 近傍だけの記事（古墳・運動公園）が近さだけで上に来んように（2026-11-06 実測）
    const score = (c.hero ? 100 : 0) + (local ? 3 : 0) + (len >= 8000 ? 2 : len >= 3000 ? 1 : 0) + (c.thumb ? 1 : 0) + near + (Number(c.seasonBonus) || 0);
    return { ...c, local, score, star: Boolean(c.hero) };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = hasDist(a) ? a.distKm : Infinity;
    const db = hasDist(b) ? b.distKm : Infinity;
    return da - db;
  });
  const top = scored.slice(0, MAX_CANDIDATES);
  const locals = top.filter((c) => c.local && !c.hero);
  const starN = Math.min(locals.length, Math.max(3, Math.ceil(locals.length / 3)));
  locals.slice(0, starN).forEach((c) => { c.star = true; });
  top.forEach((c, i) => { c.id = `c${i + 1}`; });
  return top;
}

/** お散歩＝2km 以内（距離不明は外す）／半日＝10km／1日＝30km（距離不明はここでは残し、座標の補完（§17.2-5）の後で落とす）。 */
export function filterByCourse(list, course) {
  const r = COURSE_RADIUS_KM[course] ?? COURSE_RADIUS_KM.half;
  return (list || []).filter((c) => (hasDist(c) ? c.distKm <= r : course !== 'walk'));
}

function fmtKm(d) {
  if (!Number.isFinite(d)) return '距離不明';
  const v = d < 10 ? Math.round(d * 10) / 10 : Math.round(d);
  return `約${v}km`;
}

/** 説明文の最初の一文（60 字まで）。 */
export function firstSentence(text, limit = 60) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const i = t.indexOf('。');
  let s = i >= 0 ? t.slice(0, i + 1) : t;
  if (s.length > limit) s = s.slice(0, limit - 1) + '…';
  return s;
}

/** Gemini に渡す行（§17.4）：`[c1] 名前（約1.2km・★定番候補・今の季節：紅葉）— 冒頭の一文`。 */
export function formatCandidates(list) {
  return (list || []).map((c) => {
    const parts = [fmtKm(hasDist(c) ? c.distKm : NaN)];
    if (c.star) parts.push('★定番候補');
    if (c.seasonNote) parts.push(`今の季節：${c.seasonNote}`);
    const first = firstSentence(c.extract);
    return `[${c.id}] ${c.name}（${parts.join('・')}）${first ? `— ${first}` : ''}`;
  }).join('\n');
}

/** 50 件まとめ引きの返事 → Map(記事名 or 引いた名前 → {title,length,url,thumb,lat,lng,extract})。曖昧さ回避と欠落は入れん。 */
export function parseBatchPages(json) {
  const map = new Map();
  const q = json && json.query;
  if (!q || !q.pages) return map;
  for (const p of Object.values(q.pages)) {
    if (!p || 'missing' in p || !p.title) continue;
    if (p.pageprops && 'disambiguation' in p.pageprops) continue;
    const coord = Array.isArray(p.coordinates) && p.coordinates[0];
    map.set(p.title, {
      title: p.title,
      length: Number(p.length) || 0,
      url: p.fullurl || null,
      thumb: (p.thumbnail && p.thumbnail.source) || null,
      lat: coord && Number.isFinite(Number(coord.lat)) ? Number(coord.lat) : null,
      lng: coord && Number.isFinite(Number(coord.lon)) ? Number(coord.lon) : null,
      extract: typeof p.extract === 'string' && p.extract.trim() ? p.extract.replace(/\s+/g, ' ').trim() : null,
    });
  }
  // 正規化・リダイレクトの元の名前でも引けるように
  const alias = [...(q.normalized || []), ...(q.redirects || [])];
  for (const a of alias) {
    const target = map.get(a.to) || (() => { const n = alias.find((x) => x.from === a.to); return n && map.get(n.to); })();
    if (target && !map.has(a.from)) map.set(a.from, target);
  }
  return map;
}

/** Gemini が返した名前を候補に寄せる。まず正規化して同じ、次に片方が含む。無ければ null。 */
export function matchSpotToCandidates(name, candidates) {
  const n = normalizeTitle(name);
  if (!n) return null;
  const list = candidates || [];
  const exact = list.find((c) => normalizeTitle(c.name) === n || (c.wikiTitle && normalizeTitle(c.wikiTitle) === n));
  if (exact) return exact;
  return list.find((c) => titlesMatch(name, c.name) || (c.wikiTitle && titlesMatch(name, c.wikiTitle))) || null;
}

// ---- 通信（§17.2-6）：Wikipedia は同時 1 本・前の通信から gapMs 空ける・429 の後は cooldownMs の間は通信せん
export class CandidateError extends Error {
  constructor(message, status, cooling = false) {
    super(message);
    this.name = 'CandidateError';
    this.status = status;
    this.cooling = cooling;
  }
}

function abortError() {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

export function createWikiClient({ fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 150, cooldownMs = 60000 } = {}) {
  let chain = Promise.resolve();
  let last = -Infinity;
  let coolUntil = -Infinity;
  function getJson(params, signal) {
    const job = async () => {
      if (signal && signal.aborted) throw abortError();
      if (now() < coolUntil) throw new CandidateError('cooling after 429', 429, true);
      const wait = last + gapMs - now();
      if (wait > 0) await sleep(wait);
      if (signal && signal.aborted) throw abortError();
      last = now();
      const q = new URLSearchParams({ format: 'json', origin: '*', ...params });
      const res = await fetchImpl(`${WIKI}?${q}`, { headers: HEADERS, signal });
      if (!res.ok) {
        if (res.status === 429) coolUntil = now() + cooldownMs;
        throw new CandidateError(`http ${res.status}`, res.status);
      }
      return res.json();
    };
    const p = chain.then(job, job);
    chain = p.catch(() => {});
    return p;
  }
  return { getJson };
}

/** アプリ全体で 1 本の Wikipedia の待ち行列。 */
export const defaultWikiClient = createWikiClient();

function isAbort(e) {
  return e && e.name === 'AbortError';
}

/** 落ちても空で続ける（中断だけは投げる）。落ちたら state.partial を立てる。 */
async function soft(fn, fallback, state) {
  try {
    return await fn();
  } catch (e) {
    if (isAbort(e)) throw e;
    state.partial = true;
    return fallback;
  }
}

async function destPage(name, client, fetchImpl, signal) {
  const q = (titles) => client.getJson({
    action: 'query', titles, redirects: '1', prop: 'extracts|pageimages|coordinates|info|pageprops|categories',
    exintro: '1', explaintext: '1', pithumbsize: '640', inprop: 'url', ppprop: 'disambiguation', cllimit: 'max',
  }, signal);
  const withCats = (json) => {
    const page = parseWikiPage(json);
    if (!page || page.disambiguation) return null;
    const raw = Object.values(json.query.pages)[0];
    return { ...page, length: Number(raw.length) || 0, categories: (raw.categories || []).map((c) => c.title) };
  };
  let p = withCats(await q(name));
  if (p) return p;
  const found = await wikiLookup(name, { fetchImpl, signal }); // 検索の道（§6.2）
  if (!found || !found.title) return null;
  p = withCats(await q(found.title));
  return p;
}

async function kankoList(muni, client, signal) {
  const sec = await client.getJson({ action: 'parse', page: muni, prop: 'sections' }, signal);
  const idx = pickKankoSection(sec && sec.parse && sec.parse.sections);
  if (!idx) return [];
  const body = await client.getJson({ action: 'parse', page: muni, section: idx, prop: 'wikitext' }, signal);
  const text = body && body.parse && body.parse.wikitext && body.parse.wikitext['*'];
  return parseKankoSection(text);
}

async function categoryList(muni, client, signal) {
  const json = await client.getJson({ action: 'query', list: 'categorymembers', cmtitle: `Category:${muni}の観光地`, cmlimit: '200', cmnamespace: '0' }, signal);
  return ((json && json.query && json.query.categorymembers) || []).map((m) => m.title).filter(Boolean);
}

async function geoList(center, course, client, signal, state) {
  const points = [center];
  if (course === 'full') {
    const dLat = 0.13;
    const dLng = 0.13 / Math.max(0.2, Math.cos((center.lat * Math.PI) / 180));
    points.push({ lat: center.lat + dLat, lng: center.lng }, { lat: center.lat - dLat, lng: center.lng }, { lat: center.lat, lng: center.lng + dLng }, { lat: center.lat, lng: center.lng - dLng });
  }
  const lists = await Promise.all(points.map((p) => soft(async () => {
    const json = await client.getJson({ action: 'query', list: 'geosearch', gscoord: `${p.lat}|${p.lng}`, gsradius: '10000', gslimit: '100', gsnamespace: '0' }, signal);
    return ((json && json.query && json.query.geosearch) || []).map((g) => g.title).filter(Boolean);
  }, [], state)));
  return [...new Set(lists.flat())];
}

async function batchPages(titles, client, signal, state) {
  const map = new Map();
  const uniq = [...new Set(titles.filter(Boolean))].slice(0, MAX_TITLES);
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50);
    const json = await soft(() => client.getJson({
      action: 'query', titles: chunk.join('|'), redirects: '1', prop: 'info|pageprops|pageimages|coordinates',
      inprop: 'url', ppprop: 'disambiguation', pithumbsize: '640', pilimit: 'max', colimit: 'max', // 既定は写真 1 件・座標 10 件しか返らん（2026-11-06 実測）
    }, signal), null, state);
    if (json) for (const [k, v] of parseBatchPages(json)) map.set(k, v);
  }
  return map;
}

/** 上位の候補の記事の冒頭（§17.2-4）。20 件ずつ（extracts の上限）。 */
async function fillExtracts(cands, client, signal, state) {
  const need = cands.filter((c) => c.wikiTitle && !c.extract);
  for (let i = 0; i < need.length; i += 20) {
    const chunk = need.slice(i, i + 20);
    const json = await soft(() => client.getJson({
      action: 'query', titles: chunk.map((c) => c.wikiTitle).join('|'), redirects: '1', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: '20',
    }, signal), null, state);
    if (!json) continue;
    const map = parseBatchPages(json);
    for (const c of chunk) {
      const p = map.get(c.wikiTitle);
      if (p && p.extract) c.extract = p.extract;
    }
  }
}

/**
 * 目的地 → {ok, partial, area, center, dest, candidates}。
 * 目的地が Wikipedia に無ければ ok:false。目的地の取得そのものが落ちたら CandidateError を投げる（§17.2-7）。中断は投げる。
 * partial:true＝どれかの源が落ちた（使い回しに入れん）。
 */
export async function collectCandidates(destination, { course = 'half', fetchImpl = fetch, signal, client = null } = {}) {
  const cli = client || (fetchImpl === fetch ? defaultWikiClient : createWikiClient({ fetchImpl, sleep: async () => {} }));
  const state = { partial: false };
  const dest = await destPage(String(destination ?? '').trim(), cli, fetchImpl, signal);
  if (!dest) return { ok: false, partial: false, area: null, center: null, dest: null, candidates: [] };
  const center = dest.lat !== null && dest.lng !== null ? { lat: dest.lat, lng: dest.lng } : null;
  const muni = pickMunicipality(dest);

  const [local, catMembers, nearby] = await Promise.all([
    muni ? soft(() => kankoList(muni, cli, signal), [], state) : [],
    muni ? soft(() => categoryList(muni, cli, signal), [], state) : [],
    center ? geoList(center, course, cli, signal, state) : [],
  ]);

  const pages = await batchPages([...local.map((c) => c.wikiTitle), ...catMembers, ...nearby], cli, signal, state);
  const exclude = new Set([normalizeTitle(dest.title), muni ? normalizeTitle(muni) : '']);
  const byKey = new Map();
  const order = [];
  // 同じ場所は統合する（§17.2-1）：空いとる項目を埋め、local はどちらかが真なら真
  const add = (c) => {
    const key = normalizeTitle(c.name);
    if (!key || exclude.has(key) || isVenue(c.name)) return;
    const p = c.wikiTitle ? pages.get(c.wikiTitle) : null;
    const next = {
      name: c.name, wikiTitle: p ? p.title : null, local: Boolean(c.local), length: p ? p.length : 0,
      url: p ? p.url : null, thumb: p ? p.thumb : null, lat: p ? p.lat : null, lng: p ? p.lng : null, extract: p ? p.extract : null,
    };
    const cur = byKey.get(key);
    if (!cur) { byKey.set(key, next); order.push(key); return; }
    cur.local = cur.local || next.local;
    if (cur.lat === null && next.lat !== null) { cur.lat = next.lat; cur.lng = next.lng; }
    for (const k of ['wikiTitle', 'url', 'thumb', 'extract']) if (cur[k] === null && next[k] !== null) cur[k] = next[k];
    if (next.length > cur.length) cur.length = next.length;
  };
  for (const c of local) add({ ...c, local: true });
  for (const t of catMembers) if (!isNoise(t)) add({ name: baseName(t), wikiTitle: t, local: true }); // カテゴリにはホテル・ビルも入っとる（大阪市で実測）
  for (const t of nearby) {
    const p = pages.get(t);
    if (!p) continue;
    const known = byKey.has(normalizeTitle(baseName(t)));
    if (!known && (isNoise(t) || p.length < MIN_LENGTH_NEARBY)) continue;
    add({ name: baseName(t), wikiTitle: t, local: false });
  }
  const out = order.map((k) => byKey.get(k)).map((c) => ({
    ...c,
    distKm: center && c.lat !== null && c.lng !== null ? distanceKm(center, { lat: c.lat, lng: c.lng }) : null,
  }));
  // 目的地そのものが観光地なら主役として入れる（§17.2-2）
  const hero = muni !== dest.title && center && !isVenue(dest.title)
    ? { name: baseName(String(destination ?? '').trim()) || baseName(dest.title), wikiTitle: dest.title, local: true, hero: true, length: dest.length, url: dest.url, thumb: dest.thumb, lat: dest.lat, lng: dest.lng, extract: dest.extract || null, distKm: 0 }
    : null;
  let candidates = scoreCandidates([...(hero ? [hero] : []), ...filterByCourse(out, course)]);
  await fillExtracts(candidates, cli, signal, state);
  candidates = candidates.filter((c) => c.hero || (!isClosedByExtract(c.extract) && !isVenueByExtract(c.extract)));

  return {
    ok: true,
    partial: state.partial,
    area: muni,
    center,
    dest: { title: dest.title, url: dest.url, extract: dest.extract, thumb: dest.thumb, lat: dest.lat, lng: dest.lng },
    candidates,
  };
}
