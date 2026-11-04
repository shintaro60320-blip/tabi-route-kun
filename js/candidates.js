// 候補の集め方（設計書 §16.2）：Gemini の記憶ではなく Wikipedia から「その土地の場所」を集め、Gemini には選んで並べるだけをさせる。
// 前半＝純粋関数（ふるい・節の読み方・並べ方）、後半＝通信（collectCandidates）。

import { normalizeTitle, titlesMatch, parseWikiPage, wikiLookup } from './verify.js';

const WIKI = 'https://ja.wikipedia.org/w/api.php';
const UA = 'TabiRouteKun/1.0 (personal use)';
const HEADERS = { 'Api-User-Agent': UA };
export const MAX_CANDIDATES = 40;
export const MIN_LENGTH_NEARBY = 2500; // 近傍だけで拾った記事は、これより短ければ無名と見なす
export const COURSE_RADIUS_KM = { walk: 2, half: 10, full: 30 };

// ---- ふるい（§16.2-5）：近傍で拾った記事のうち、観光と関係ない施設を落とす
const NOISE = /郵便局|警察|消防|学校|大学|高校|幼稚園|保育|病院|医院|診療|役所|役場|庁舎|庁$|銀行|信用|協同組合|株式会社|会社|放送|テレビ|ラジオ|新聞|営業所|支店|センタービル|ビル$|マンション|団地|住宅|ホテル|インターチェンジ|ジャンクション|サービスエリア|パーキングエリア|出入口|バイパス|国道|県道|道路|線$|トンネル|\d+号墳|遺跡$|変電所|発電所|工場|浄水|処理場|下水|用水|ダム$|選挙区|郡$|市$|町$|村$|区$|丁目|領事館|大使館|宿舎|寮$|周年|交通$|センター$|組合|法人|機構|事務所|本部|王朝|年$/;
const STATION = /(?<!道の)駅$/;
// 催し物が無ければ見る物が無い所（全部の源に掛ける。観光地カテゴリにはコンサートホールや劇場も入っとる）
const VENUE = /ホール$|劇場$|シアター|歌舞伎座|松竹座|花月$|ライブハウス|スタジアム|球場$|競技場|アリーナ$|百貨店$|ショッピングセンター|モール$|アウトレット|映画館|シネマ|会館$|音楽堂$|センター$/;

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
    const link = links.find((l) => titlesMatch(name, l.title) || titlesMatch(name, l.label) && titlesMatch(l.label, l.title));
    const wikiTitle = link && !LISTY.test(link.title) ? link.title : null;
    out.push({ name, wikiTitle: wikiTitle && titlesMatch(name, wikiTitle) ? wikiTitle : null });
  }
  return out;
}

// ---- 市町村の決め方（§16.2-2）
export function pickMunicipality(page) {
  const title = page && page.title ? String(page.title) : '';
  const cats = ((page && page.categories) || []).map(String);
  if (cats.some((c) => /の市町村$/.test(c) || /^Category:.+[都道府県市]の(市|町|村|区)$/.test(c))) return title || null;
  for (const c of cats) {
    const m = c.match(/^Category:(.+?)の観光地$/);
    if (m) return m[1];
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
 * 地元一覧（local＝市町村記事の観光節・観光地カテゴリ：+3）・記事の長さ（≥8,000: +2・≥3,000: +1）・写真（+1）・近さ（≤1km: +3・≤3km: +2・≤6km: +1）。
 * 同点は近い順（距離不明は後）。上位 40 件。
 * ★定番候補＝地元一覧の中の上位 1/3（最低 3 件）だけ。残りの地元一覧が「2回目」の玉になる（全部★にすると田舎で 2回目の候補が消える）。
 */
export function scoreCandidates(list) {
  const scored = (list || []).map((c) => {
    const len = Number(c.length) || 0;
    const local = Boolean(c.local);
    const d = hasDist(c) ? c.distKm : Infinity;
    const near = d <= 1 ? 3 : d <= 3 ? 2 : d <= 6 ? 1 : 0; // 目的地の周りを優先（都市で市内全域の有名所に引っ張られんため）
    const score = (local ? 3 : 0) + (len >= 8000 ? 2 : len >= 3000 ? 1 : 0) + (c.thumb ? 1 : 0) + near;
    return { ...c, local, score, star: false };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = hasDist(a) ? a.distKm : Infinity;
    const db = hasDist(b) ? b.distKm : Infinity;
    return da - db;
  });
  const top = scored.slice(0, MAX_CANDIDATES);
  const locals = top.filter((c) => c.local);
  const starN = Math.min(locals.length, Math.max(3, Math.ceil(locals.length / 3)));
  locals.slice(0, starN).forEach((c) => { c.star = true; });
  return top;
}

/** お散歩＝2km 以内（距離不明は外す）／半日＝10km／1日＝30km（距離不明は残す）。 */
export function filterByCourse(list, course) {
  const r = COURSE_RADIUS_KM[course] ?? COURSE_RADIUS_KM.half;
  return (list || []).filter((c) => (hasDist(c) ? c.distKm <= r : course !== 'walk'));
}

function fmtKm(d) {
  if (!Number.isFinite(d)) return '距離不明';
  const v = d < 10 ? Math.round(d * 10) / 10 : Math.round(d);
  return `約${v}km`;
}

/** Gemini に渡す行。 */
export function formatCandidates(list) {
  return (list || []).map((c) => {
    const parts = [fmtKm(hasDist(c) ? c.distKm : NaN)];
    if (c.star) parts.push('★定番候補');
    return `- ${c.name}（${parts.join('・')}）`;
  }).join('\n');
}

/** 50 件まとめ引きの返事 → Map(記事名 or 引いた名前 → {title,length,url,thumb,lat,lng})。曖昧さ回避と欠落は入れん。 */
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

// ---- 通信
async function getJson(fetchImpl, params, signal) {
  const q = new URLSearchParams({ format: 'json', origin: '*', ...params });
  const res = await fetchImpl(`${WIKI}?${q}`, { headers: HEADERS, signal });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

function isAbort(e) {
  return e && e.name === 'AbortError';
}

/** 落ちても空で続ける（中断だけは投げる）。 */
async function soft(fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    if (isAbort(e)) throw e;
    return fallback;
  }
}

async function destPage(name, fetchImpl, signal) {
  const q = (titles) => getJson(fetchImpl, {
    action: 'query', titles, redirects: '1', prop: 'extracts|pageimages|coordinates|info|pageprops|categories',
    exintro: '1', explaintext: '1', pithumbsize: '640', inprop: 'url', ppprop: 'disambiguation', cllimit: 'max',
  }, signal);
  const withCats = (json) => {
    const page = parseWikiPage(json);
    if (!page || page.disambiguation) return null;
    const raw = Object.values(json.query.pages)[0];
    return { ...page, categories: (raw.categories || []).map((c) => c.title) };
  };
  let p = withCats(await q(name));
  if (p) return p;
  const found = await wikiLookup(name, { fetchImpl, signal }); // 検索の道（§6.2）
  if (!found || !found.title) return null;
  p = withCats(await q(found.title));
  return p;
}

async function kankoList(muni, fetchImpl, signal) {
  const sec = await getJson(fetchImpl, { action: 'parse', page: muni, prop: 'sections' }, signal);
  const idx = pickKankoSection(sec && sec.parse && sec.parse.sections);
  if (!idx) return [];
  const body = await getJson(fetchImpl, { action: 'parse', page: muni, section: idx, prop: 'wikitext' }, signal);
  const text = body && body.parse && body.parse.wikitext && body.parse.wikitext['*'];
  return parseKankoSection(text);
}

async function categoryList(muni, fetchImpl, signal) {
  const json = await getJson(fetchImpl, { action: 'query', list: 'categorymembers', cmtitle: `Category:${muni}の観光地`, cmlimit: '200', cmnamespace: '0' }, signal);
  return ((json && json.query && json.query.categorymembers) || []).map((m) => m.title).filter(Boolean);
}

async function geoList(center, course, fetchImpl, signal) {
  const points = [center];
  if (course === 'full') {
    const dLat = 0.13;
    const dLng = 0.13 / Math.max(0.2, Math.cos((center.lat * Math.PI) / 180));
    points.push({ lat: center.lat + dLat, lng: center.lng }, { lat: center.lat - dLat, lng: center.lng }, { lat: center.lat, lng: center.lng + dLng }, { lat: center.lat, lng: center.lng - dLng });
  }
  const lists = await Promise.all(points.map((p) => soft(async () => {
    const json = await getJson(fetchImpl, { action: 'query', list: 'geosearch', gscoord: `${p.lat}|${p.lng}`, gsradius: '10000', gslimit: '100', gsnamespace: '0' }, signal);
    return ((json && json.query && json.query.geosearch) || []).map((g) => g.title).filter(Boolean);
  }, [])));
  return [...new Set(lists.flat())];
}

async function batchPages(titles, fetchImpl, signal) {
  const map = new Map();
  const uniq = [...new Set(titles.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50);
    const json = await soft(() => getJson(fetchImpl, {
      action: 'query', titles: chunk.join('|'), redirects: '1', prop: 'info|pageprops|pageimages|coordinates',
      inprop: 'url', ppprop: 'disambiguation', pithumbsize: '640',
    }, signal), null);
    if (json) for (const [k, v] of parseBatchPages(json)) map.set(k, v);
  }
  return map;
}

/**
 * 目的地 → {ok, area, center, dest, candidates}。
 * 目的地が Wikipedia に無ければ ok:false（従来どおり Gemini に任せる）。中断は投げる。
 */
export async function collectCandidates(destination, { course = 'half', fetchImpl = fetch, signal } = {}) {
  const dest = await destPage(String(destination ?? '').trim(), fetchImpl, signal);
  if (!dest) return { ok: false, area: null, center: null, dest: null, candidates: [] };
  const center = dest.lat !== null && dest.lng !== null ? { lat: dest.lat, lng: dest.lng } : null;
  const muni = pickMunicipality(dest);

  const [local, catMembers, nearby] = await Promise.all([
    muni ? soft(() => kankoList(muni, fetchImpl, signal), []) : [],
    muni ? soft(() => categoryList(muni, fetchImpl, signal), []) : [],
    center ? geoList(center, course, fetchImpl, signal) : [],
  ]);

  const pages = await batchPages([...local.map((c) => c.wikiTitle), ...catMembers, ...nearby], fetchImpl, signal);
  const exclude = new Set([normalizeTitle(dest.title), muni ? normalizeTitle(muni) : '']);
  const seen = new Set();
  const out = [];
  const push = (c) => {
    const key = normalizeTitle(c.name);
    if (!key || seen.has(key) || exclude.has(key) || isVenue(c.name)) return;
    seen.add(key);
    const p = c.wikiTitle ? pages.get(c.wikiTitle) : null;
    const lat = p ? p.lat : null;
    const lng = p ? p.lng : null;
    out.push({
      name: c.name,
      wikiTitle: p ? p.title : null,
      local: Boolean(c.local),
      length: p ? p.length : 0,
      url: p ? p.url : null,
      thumb: p ? p.thumb : null,
      lat, lng,
      distKm: center && lat !== null && lng !== null ? distanceKm(center, { lat, lng }) : null,
    });
  };
  for (const c of local) push({ ...c, local: true });
  for (const t of catMembers) push({ name: baseName(t), wikiTitle: t, local: true });
  for (const t of nearby) {
    const p = pages.get(t);
    if (!p || isNoise(t) || p.length < MIN_LENGTH_NEARBY) continue;
    push({ name: baseName(t), wikiTitle: t, local: false });
  }

  return { ok: true, area: muni, center, dest: { title: dest.title, url: dest.url, extract: dest.extract, thumb: dest.thumb }, candidates: scoreCandidates(filterByCourse(out, course)) };
}
