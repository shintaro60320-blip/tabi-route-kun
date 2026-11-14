// 候補の集め方（設計書 §16.2・§17.2）：Gemini の記憶ではなく Wikipedia から「その土地の場所」を集め、Gemini には選ぶだけをさせる。
// 前半＝純粋関数（ふるい・節の読み方・並べ方）、後半＝通信（createWikiClient・collectCandidates）。

import { normalizeTitle, titlesMatch, parseWikiPage } from './verify.js';

const WIKI = 'https://ja.wikipedia.org/w/api.php';
const UA = 'TabiRouteKun/1.3 (https://shintaro60320-blip.github.io/tabi-route-kun/)'; // Wikimedia の決まり：連絡先（URL）入りの名乗り
const HEADERS = { 'Api-User-Agent': UA };
export const MAX_CANDIDATES = 40;
export const MIN_LENGTH_NEARBY = 2500; // 近傍だけで拾った記事は、これより短ければ無名と見なす
export const MAX_TITLES = 300; // 記事名の一覧はここまで（50 件×6 通信が上限・§18.8）
export const MAX_LINKED = 60; // 主役の記事のリンクは近い順にここまで（大坂城の記事は市内だけで数百ある）
export const COURSE_RADIUS_KM = { walk: 2, half: 10, full: 30 };

// ---- ふるい（§16.2-5）：近傍で拾った記事のうち、観光と関係ない施設を落とす
const NOISE = /郵便局|警察|消防|学校|大学|高校|幼稚園|保育|病院|医院|診療|役所|役場|庁舎|庁$|銀行|信用|協同組合|株式会社|会社|放送|テレビ|ラジオ|新聞|営業所|支店|センタービル|ビル$|マンション|団地|住宅|ホテル|インターチェンジ|ジャンクション|サービスエリア|パーキングエリア|出入口|バイパス|国道|県道|道路|線$|トンネル|\d+号墳|遺跡$|変電所|発電所|工場|浄水|処理場|下水|用水|ダム$|選挙区|郡$|市$|町$|村$|区$|丁目|領事館|大使館|宿舎|寮$|周年|交通$|センター$|組合|法人|機構|事務所|本部|王朝|年$|府$|県$|検車場|気象台|車両基地|事件|事故$|殺害|殺人|の戦い$|合戦$|学園|中等部|高等部|図書館|競艇|競馬場|競輪|サッカー場|野球場|テニスコート|停留場|停留所|乗り場|フェリーターミナル|バスターミナル|空港$|宗$|教$|地震|台風|豪雨|水害|空襲|噴火|津波|台地$|店$|イオン|ゆめタウン|ラフォーレ/;
// 駅は外す。道の駅と「旧〜駅」（駅舎が名所になっとる所）は残す
const STATION = /(?<!道の)駅$/;
const OLD_STATION = /^旧/;
// 催し物が無ければ見る物が無い所（全部の源に掛ける。観光地カテゴリにはコンサートホールや劇場も入っとる）
const VENUE = /ホール$|劇場$|シアター|歌舞伎座|松竹座|花月$|ライブハウス|スタジアム|球場$|競技場|アリーナ$|百貨店$|ショッピングセンター|モール$|アウトレット|映画館|シネマ|会館$|音楽堂$|能楽堂$|センター$|ドーム$/;
// 記事の最初の一文で分かる催し物会場・商業施設・会社（実例：楽屋A「お笑い劇場」・ほたるまち「複合施設」・伊藤忠食品「株式会社」）
const TAIL_LEN = 14; // 文の終わりの「それが何か」を言う所だけ見る（32 字やと途中の「放送局に隣接して建つ」まで入った）
const EXTRACT_VENUE = /劇場|ライブハウス|ホール|映画館|複合施設|商業施設|オフィスビル|株式会社|企業|放送局|本社|検車場|気象台/;

/** 説明文の最初の一文から、観光地として渡さん方がよいと分かる所。 */
export function isVenueByExtract(extract) {
  // 文の「終わり方」＝その物が何か、で見る。途中の語では落とさん
  //（大阪歴史博物館「NHK大阪放送局に隣接して建つ…博物館」を放送局として落としとった＝2026-11-10 実測）
  const first = firstSentence(extract, 300);
  if (!first) return false;
  return EXTRACT_VENUE.test(first.slice(-TAIL_LEN)) || /株式会社|有限会社|合同会社/.test(first.slice(0, 40));
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
  return NOISE.test(b) || (STATION.test(b) && !OLD_STATION.test(b));
}

// ---- 記事の最初の一文で分かる「観光地やない物」（§18.2・2026-11-10 実測：旅館・和菓子店・駅ビル・キャバレー・宗教団体・町名が候補に入っとった）
const NOT_SIGHT_TAIL = /旅館|ホテル|和菓子店|洋菓子店|菓子店|飲食店|レストラン|料亭|喫茶店|居酒屋|キャバレー|駅ビル|商業ビル|ショッピングセンター|スーパーマーケット|新宗教|宗教法人|財団法人|社団法人|中学校|高等学校|小学校|学校法人|図書館|停留場|停留所|競艇場|競馬場|競輪場|サッカー場|野球場|ビジネス街|オフィス街|再開発地区|再開発地域|業務地区|住宅地|住宅街|工業団地|出城|曲輪/;
const PLACE_NAME = /町丁|町名|地名|地域名|大字/;
const PLACE_KEEP = /繁華街|歓楽街|観光地|商店街|温泉|名所|景勝/; // 道頓堀「繁華街および町名」は残す
const SET_INDEX = /以下に大別|以下のものがある|以下の.{0,12}を指す|複数の意味/; // 曖昧さ回避に近いページ（地主神社）

/** 最初の一文の終わり方（最後の 14 字＝「〜にある〇〇。」の〇〇）から、観光地として渡さん方がよいと分かる物。二文目以降は見ん。 */
export function isNotSightByExtract(extract) {
  const first = firstSentence(extract, 300);
  if (!first) return false;
  if (SET_INDEX.test(first)) return true;
  const tail = first.slice(-TAIL_LEN);
  if (NOT_SIGHT_TAIL.test(tail)) return true;
  if (PLACE_NAME.test(tail) && !PLACE_KEEP.test(first)) return true;
  return false;
}

/** 通りの記事（河原町通・四条通）。候補には残すが、下げて★にせん。 */
export function isStreetByExtract(extract) {
  return /通りの(ひとつ|一つ)|の通りである|主要な.{0,6}通り|道路の(名称|通称)/.test(firstSentence(extract, 300));
}

/** 言語版の無い橋・遺跡・古墳＝わざわざ回る所やない（残すが下げて★にせん）。有名な物（渡月橋・吉野ヶ里遺跡）は言語版があるので当たらん。 */
export function isMinorSight(c) {
  const name = baseName((c && c.name) || '');
  const tier = langTier(c && c.langs);
  if (/川$/.test(name)) return true; // 川は回る場所やない（斐伊川に★が付いた＝2026-11-10 実測）
  if (/橋$/.test(name)) return tier <= 1; // 高麗橋（言語版 3）に★が付いた＝2026-11-10 実測
  return /遺跡$|古墳$|墳丘墓$|貝塚$/.test(name) && tier === 0;
}

// ---- 登りの印（§18.5）：年配の方向けなので、山道・洞窟は「登りあり」と Gemini に伝えて下げる
const CLIMB_NAME = /トレイル|登山|洞窟|鍾乳洞|原始林|自然歩道/;

export function detectClimb(c) {
  const name = String((c && c.name) || '');
  if (CLIMB_NAME.test(name)) return true;
  const head = String((c && c.extract) || '').slice(0, 160);
  const m = head.match(/標高\s*([0-9０-９,，.]+)\s*(?:m|ｍ|メートル)/);
  if (!m) return false;
  const h = parseFloat(m[1].normalize('NFKC').replace(/,/g, ''));
  return Number.isFinite(h) && h >= 200 && /山|岳|峰|峠/.test(name + head);
}

// ---- 有名さ（§18.3）：他の言語版がいくつあるか（清水寺 76・八坂神社 21・河原町通 3・京都一周トレイル 0＝2026-11-10 実測）
export function langTier(n) {
  const v = Number(n) || 0;
  return v >= 20 ? 3 : v >= 8 ? 2 : v >= 3 ? 1 : 0;
}

/** `prop=langlinks` の返事 → Map(記事名 or 引いた名前 → 言語版の数)。 */
export function parseLangCounts(json) {
  const map = new Map();
  const q = json && json.query;
  if (!q || !q.pages) return map;
  for (const p of Object.values(q.pages)) {
    if (!p || 'missing' in p || !p.title) continue;
    map.set(p.title, Array.isArray(p.langlinks) ? p.langlinks.length : 0);
  }
  const alias = [...(q.normalized || []), ...(q.redirects || [])];
  for (const a of alias) {
    const hit = map.has(a.to) ? a.to : (alias.find((x) => x.from === a.to) || {}).to;
    if (hit !== undefined && map.has(hit) && !map.has(a.from)) map.set(a.from, map.get(hit));
  }
  return map;
}

// ---- 市町村記事の「観光」節（§16.2-3 A）
const KANKO_HEAD = /観光|名所|名勝|見どころ|レジャー/;
const SKIP_SUB = /祭|催事|産品|土産|文化|人物|料理|特産|グルメ|名物|作品|出身|イベント|方言|食/;
const CLOSED = /閉鎖|閉園|閉館|廃止|休業|休止|廃校|撤去|営業終了|解体/;
// 記事の冒頭で分かる「もう無い」所（実例：スノーリゾート猫山「…にあったスキー場」）
const CLOSED_EXTRACT = /にあった[^、。にをがで]{1,20}(?:である)?。?$|かつて(?:存在|営業|あった)|閉鎖され|閉園し|閉館し|廃止され|営業を終了|廃業|取り壊され/;

/** 説明文（記事の冒頭）から「もう無い」と分かる所。 */
export function isClosedByExtract(extract) {
  // 最初の一文だけ見る。二文目の「松江市内にあった古代文化センター…」で、今ある古代出雲歴史博物館を落としとった（2026-11-10 実測）
  return CLOSED_EXTRACT.test(firstSentence(extract, 300));
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
 * 並べ方（§16.2-6・§18.3）。点＝
 *   載っとる所（local＝市町村記事の観光節・観光地カテゴリ／linked＝主役の記事に出てくる：どちらか +2・両方 +3）
 *   ＋記事の長さ（≥8,000: +2・≥3,000: +1）＋有名さ（他の言語版の数：≥20 +3・≥8 +2・≥3 +1）＋写真（+1）
 *   ＋近さ（≤1km +3・≤3km +2・≤6km +1。載っとらん・言語版も少ない記事は +1 まで＝近いだけの古墳を上げん）
 *   ＋季節（seasonBonus）−登りあり（2）−通り（2）。主役（hero）は必ず先頭。同点は近い順（距離不明は後）。上位 max 件。
 * ★定番候補＝主役＋「有名さ（言語版の段×2＋長さの点＋載っとれば 1）＋近さの点×2」の上位（全体の 1/5・最低 3 件・有名さ 2 以上・通り／小さな所／登りは除く）。
 *   v1.2 までは「地元の一覧に載っとる」で★を付けとったが、都市のカテゴリは通り・地区が多く、寺社に★が付かんかった（2026-11-10 実測）。
 * 並べた後に id（c1, c2, …）を付ける（Gemini はこの id で選ぶ・§17.4）。
 */
export function scoreCandidates(list, max = MAX_CANDIDATES) {
  const scored = (list || []).map((c) => {
    const len = Number(c.length) || 0;
    const local = Boolean(c.local);
    const linked = Boolean(c.linked);
    const lt = langTier(c.langs);
    const lenPts = len >= 8000 ? 2 : len >= 3000 ? 1 : 0;
    const d = hasDist(c) ? c.distKm : Infinity;
    const nearRaw = d <= 1 ? 3 : d <= 3 ? 2 : d <= 6 ? 1 : 0; // 目的地の周りを優先（都市で市内全域の有名所に引っ張られんため）
    // 言語版の数がまだ分からん時（粗い絞り込み）は近さを満額で数える。そうせんと、近所の博物館が数を取る前に落ちる（大阪歴史博物館・古代出雲歴史博物館＝2026-11-10 実測）
    const known = c.langs !== undefined && c.langs !== null;
    const near = local || linked || lt >= 1 || !known ? nearRaw : Math.min(nearRaw, 1);
    const listed = local && linked ? 3 : local || linked ? 2 : 0;
    const score = (c.hero ? 100 : 0) + listed + lenPts + lt + (c.thumb ? 1 : 0) + near + (Number(c.seasonBonus) || 0) - (c.climb ? 2 : 0) - (c.street ? 2 : 0) - (c.minor ? 2 : 0);
    const fame = lt * 2 + lenPts + (local || linked ? 1 : 0);
    return { ...c, local, linked, score, fame, starKey: fame + 2 * nearRaw, star: Boolean(c.hero) };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = hasDist(a) ? a.distKm : Infinity;
    const db = hasDist(b) ? b.distKm : Infinity;
    return da - db;
  });
  const top = scored.slice(0, max);
  // ★は「有名さ＋近さ×2」の上位。遠い超有名（清水寺から 4〜6km の東寺・二条城）より、近い有名（700m の高台寺）に付ける
  const pool = top.filter((c) => !c.hero && !c.street && !c.minor && !c.climb && c.fame >= 2).sort((a, b) => b.starKey - a.starKey || b.score - a.score);
  const starN = Math.min(pool.length, Math.max(3, Math.ceil(top.length / 5)));
  pool.slice(0, starN).forEach((c) => { c.star = true; });
  top.forEach((c, i) => { c.id = `c${i + 1}`; });
  return top;
}

/** お散歩＝2km 以内（距離不明は外す）／半日＝10km／1日＝30km（距離不明はここでは残し、座標の補完（§17.2-5）の後で落とす）。 */
export function filterByCourse(list, course) {
  const r = COURSE_RADIUS_KM[course] ?? COURSE_RADIUS_KM.half;
  return (list || []).filter((c) => (hasDist(c) ? c.distKm <= r : course !== 'walk' || Boolean(c.linked)));
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

/** Gemini に渡す行（§17.4・§18.5）：`[c1] 名前（約1.2km・★定番候補・今の季節：紅葉・登りあり）— 冒頭の一文`。 */
export function formatCandidates(list) {
  return (list || []).map((c) => {
    const parts = [fmtKm(hasDist(c) ? c.distKm : NaN)];
    if (c.star) parts.push('★定番候補');
    if (c.seasonNote) parts.push(`今の季節：${c.seasonNote}`);
    if (c.climb) parts.push('登りあり');
    const first = firstSentence(c.extract);
    return `[${c.id}] ${c.name}（${parts.join('・')}）${first ? `— ${first}` : ''}`;
  }).join('\n');
}

/** 座標の選び方：主（primary）があれば主、無ければ最初の副。通天閣・道頓堀・宮島水族館は副しか無い（2026-11-10 実測）。 */
function pickCoord(coords) {
  if (!Array.isArray(coords) || !coords.length) return null;
  return coords.find((c) => c && 'primary' in c) || coords[0];
}

/** 50 件まとめ引きの返事 → Map(記事名 or 引いた名前 → {title,length,url,thumb,lat,lng,extract})。曖昧さ回避と欠落は入れん。 */
export function parseBatchPages(json) {
  const map = new Map();
  const q = json && json.query;
  if (!q || !q.pages) return map;
  for (const p of Object.values(q.pages)) {
    if (!p || 'missing' in p || !p.title) continue;
    if (p.pageprops && 'disambiguation' in p.pageprops) continue;
    const coord = pickCoord(p.coordinates);
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
    this.code = null; // API が 200 の中身で返した error.code（§18.1）
  }
}

function abortError() {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

const RETRY_CODES = /too-busy|maxlag|ratelimited|readonly|internal_api_error/;

// 429（混雑）の扱い（2026-11-14 とと「全然ヒットせん」）：Retry-After（無ければ 5 秒）だけ待ってやり直す（2 回まで）。
// それでも 429 なら、言われた秒数だけ問い合わせを止めて CandidateError を投げる（画面は「混み合っています」）。
// 以前は 1 回目の 429 で即失敗＋60 秒止めとって、続けて試した検索が全部「見つかりませんでした」になっとった。
export const RETRY_429 = 2;
export function retryAfterMs(res, fallback = 5000, cap = 20000) {
  const v = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null;
  const n = Number(v);
  const ms = Number.isFinite(n) && n >= 0 ? n * 1000 : fallback;
  return Math.min(Math.max(ms, 1000), cap);
}

export function createWikiClient({ fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 150, cooldownMs = 20000, retryMs = 1500 } = {}) {
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
      // Wikipedia は混雑時に 200 のまま {error:{code:'cirrussearch-too-busy-error'}} を返す（2026-11-10 実測）。
      // 中身の error を見んと「近くに何も無い」と受け取って黙って候補が減る → 失敗として扱い、混雑の類は 1 回だけ間を置いてやり直す
      const once = async () => {
        last = now();
        const q = new URLSearchParams({ format: 'json', origin: '*', ...params });
        const res = await fetchImpl(`${WIKI}?${q}`, { headers: HEADERS, signal });
        if (!res.ok) {
          const err = new CandidateError(`http ${res.status}`, res.status);
          if (res.status === 429) err.waitMs = Math.min(retryAfterMs(res), cooldownMs);
          throw err;
        }
        const json = await res.json();
        if (json && json.error) {
          const err = new CandidateError(`api ${json.error.code}`, 200);
          err.code = String(json.error.code || '');
          throw err;
        }
        return json;
      };
      let busyRetried = false;
      for (let attempt = 0; ; attempt++) {
        try {
          return await once();
        } catch (e) {
          if (!(e instanceof CandidateError)) throw e;
          if (e.status === 429) {
            if (attempt < RETRY_429) {
              await sleep(e.waitMs);
              if (signal && signal.aborted) throw abortError();
              continue;
            }
            coolUntil = now() + e.waitMs;
            throw e;
          }
          if (busyRetried || !e.code || !RETRY_CODES.test(e.code)) throw e;
          busyRetried = true;
          await sleep(retryMs);
          if (signal && signal.aborted) throw abortError();
        }
      }
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

// 行き先の名前が案内ページ（曖昧さ回避）や記事なしの時の選び方（2026-11-14 とと「全然ヒットせん」）。
// 実例：「京都」→ 検索 1 位の「京都府」（府の記事からは名所が 0）／「宮島」→「宮島競艇場」を選びかけ、本当の行き先「厳島」に届かんかった。
// ①「〇〇市・町・村」の記事があればそれ ②無ければ検索上位から、位置があり・府県や会場やない・観光や地理の分類に入る記事を選ぶ。
const PREF_TITLE = /[都道府県]$/;
const PLACE_CAT = /観光|地理|島|山|温泉|名所|史跡|公園|寺|神社|城|景勝|峡|滝|湖|川|海岸|半島|町並み|宿場|庭園|遺跡/;
export function choosePlaceTitle(name, pages) {
  const ok = (pages || []).filter((p) => p && !p.missing && !p.disambiguation && p.hasCoord && !PREF_TITLE.test(p.title) && !isVenue(p.title));
  for (const suf of ['市', '町', '村']) {
    const hit = ok.find((p) => p.title === `${name}${suf}`);
    if (hit) return hit.title;
  }
  const scored = ok.map((p) => ({
    title: p.title,
    place: (p.categories || []).some((c) => PLACE_CAT.test(String(c).replace(/^Category:/, ''))) ? 1 : 0,
    match: titlesMatch(name, p.title) ? 1 : 0,
    len: Number(p.length) || 0,
  }));
  scored.sort((a, b) => (b.place - a.place) || (b.match - a.match) || (b.len - a.len));
  return scored.length ? scored[0].title : null;
}

async function pickPlaceTitle(name, client, signal) {
  const hits = await client.getJson({ action: 'query', list: 'search', srsearch: name, srlimit: '8' }, signal);
  const found = ((hits && hits.query && hits.query.search) || []).map((h) => h && h.title).filter(Boolean);
  const titles = [...new Set([`${name}市`, `${name}町`, `${name}村`, ...found])].slice(0, 12);
  const j = await client.getJson({
    action: 'query', titles: titles.join('|'), redirects: '1', prop: 'coordinates|pageprops|categories|info', ppprop: 'disambiguation', cllimit: 'max',
  }, signal);
  const pages = Object.values((j && j.query && j.query.pages) || {}).map((pg) => ({
    title: pg.title,
    missing: 'missing' in pg || 'invalid' in pg,
    disambiguation: Boolean(pg.pageprops && 'disambiguation' in pg.pageprops),
    hasCoord: Array.isArray(pg.coordinates) && pg.coordinates.length > 0,
    categories: (pg.categories || []).map((c) => c.title),
    length: pg.length,
  }));
  return choosePlaceTitle(name, pages);
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
  // 検索の道（§6.2）。同じ待ち行列を通す＝混雑（429）を「該当なし」と取り違えん（以前は wikiLookup が失敗を null にしとった）
  const title = await pickPlaceTitle(name, client, signal);
  if (!title) return null;
  p = withCats(await q(title));
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
      inprop: 'url', ppprop: 'disambiguation', pithumbsize: '640', pilimit: 'max', colimit: 'max', coprimary: 'all', // 既定は写真 1 件・座標 10 件・主の座標だけ（2026-11-06／11-10 実測）
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

/** 候補の記事の「他の言語版の数」（§18.3）。50 件ずつ・続きは 2 回まで。 */
async function fillLangs(cands, client, signal, state) {
  const need = cands.filter((c) => c.wikiTitle);
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    const counts = new Map();
    let cont = {};
    let got = false;
    for (let k = 0; k < 3; k++) {
      const json = await soft(() => client.getJson({
        action: 'query', titles: chunk.map((c) => c.wikiTitle).join('|'), redirects: '1', prop: 'langlinks', lllimit: 'max', ...cont,
      }, signal), null, state);
      if (!json) break;
      got = true;
      for (const [t, n] of parseLangCounts(json)) counts.set(t, (counts.get(t) || 0) + n);
      if (!json.continue) break;
      cont = json.continue;
    }
    if (got) for (const c of chunk) if (counts.has(c.wikiTitle)) c.langs = counts.get(c.wikiTitle);
  }
}

/** 主役の記事のリンクのうち、座標があって範囲内の記事名（§18.4）。約 500 件ずつ・続きは 1 回まで。 */
// 座標が無くても候補に残す名前（宮島水族館・紅葉谷公園・道後商店街は Wikipedia に座標が無い＝2026-11-10 実測）。場所は後で地図（Nominatim）で引く
const SIGHT_NAME = /.{2,}(?:公園$|水族館$|美術館$|博物館$|記念館$|資料館$|庭園$|植物園$|動物園$|商店街$|市場$|寺$|院$|神社$|大社$|城$|城跡$|塔$|滝$|浜$|岬$|灯台$|温泉$|渓谷$|峡$|展望台$|ロープウエー$|ロープウェイ$)/;
const NO_COORD_MAX = 20;

async function heroLinks(title, center, radiusKm, client, signal, state) {
  const out = [];
  const noCoord = [];
  let cont = {};
  for (let k = 0; k < 2; k++) {
    const json = await soft(() => client.getJson({
      action: 'query', generator: 'links', titles: title, redirects: '1', gplnamespace: '0', gpllimit: 'max', prop: 'coordinates', colimit: 'max', coprimary: 'all', ...cont,
    }, signal), null, state);
    const pages = json && json.query && json.query.pages;
    if (!pages) break;
    for (const p of Object.values(pages)) {
      const c = pickCoord(p.coordinates);
      if (!p.title) continue;
      if (!c) { if (noCoord.length < NO_COORD_MAX && SIGHT_NAME.test(baseName(p.title))) noCoord.push(p.title); continue; }
      const lat = Number(c.lat);
      const lng = Number(c.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const d = distanceKm(center, { lat, lng });
      if (d <= radiusKm) out.push({ title: p.title, d });
    }
    if (!json.continue) break;
    cont = json.continue;
  }
  out.sort((a, b) => a.d - b.d);
  return [...out.slice(0, MAX_LINKED).map((x) => x.title), ...noCoord];
}

export const PRELIM_MAX = 120; // 言語版の数を取る前の粗い絞り込み（60 やと密な街で近所の博物館・道頓堀が落ちた＝2026-11-10 実測）
export const EXTRACT_MAX = 50; // 説明文を取る数（20 件ずつ＝3 通信）
export const MIN_LENGTH_LINKED = 1000;

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
  // 目的地そのものが観光地（市町村やない・座標あり・会場やない）＝主役（§17.2-2）
  const isHero = Boolean(muni !== dest.title && center && !isVenue(dest.title));
  const radius = COURSE_RADIUS_KM[course] ?? COURSE_RADIUS_KM.half;

  const [local, catMembers, nearby, linkedRaw] = await Promise.all([
    muni ? soft(() => kankoList(muni, cli, signal), [], state) : [],
    muni ? soft(() => categoryList(muni, cli, signal), [], state) : [],
    center ? geoList(center, course, cli, signal, state) : [],
    isHero ? heroLinks(dest.title, center, radius, cli, signal, state) : [],
  ]);
  const linked = linkedRaw.filter((t) => !isNoise(t));

  // 調べる順＝観光節 → 主役の記事（近い順）→ 近く → 観光地カテゴリ。枠（300 件）から溢れるのは最後のカテゴリの後ろ
  const pages = await batchPages([...local.map((c) => c.wikiTitle), ...linked, ...nearby, ...catMembers], cli, signal, state);
  const exclude = new Set([normalizeTitle(dest.title), muni ? normalizeTitle(muni) : '']);
  const byKey = new Map();
  const byTitle = new Map(); // 記事名 → 候補の鍵（同じ記事を指す候補を 1 つにまとめる・§18.2）
  const order = [];
  // 同じ場所は統合する（§17.2-1）：空いとる項目を埋め、local・linked はどちらかが真なら真
  const add = (c) => {
    const p = c.wikiTitle ? pages.get(c.wikiTitle) : null;
    let key = normalizeTitle(c.name);
    if (!key || exclude.has(key) || isVenue(c.name)) return;
    if (p && exclude.has(normalizeTitle(p.title))) return; // 目的地の記事へ飛ぶ別名
    if (p && byTitle.has(p.title)) key = byTitle.get(p.title);
    const next = {
      name: c.name, wikiTitle: p ? p.title : null, local: Boolean(c.local), linked: Boolean(c.linked), length: p ? p.length : 0,
      url: p ? p.url : null, thumb: p ? p.thumb : null, lat: p ? p.lat : null, lng: p ? p.lng : null, extract: p ? p.extract : null,
    };
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, next);
      order.push(key);
      if (p) byTitle.set(p.title, key);
      return;
    }
    cur.local = cur.local || next.local;
    cur.linked = cur.linked || next.linked;
    if (cur.lat === null && next.lat !== null) { cur.lat = next.lat; cur.lng = next.lng; }
    for (const k of ['wikiTitle', 'url', 'thumb', 'extract']) if (cur[k] === null && next[k] !== null) cur[k] = next[k];
    if (next.length > cur.length) cur.length = next.length;
    if (p && !byTitle.has(p.title)) byTitle.set(p.title, key);
  };
  for (const c of local) add({ ...c, local: true });
  for (const t of linked) {
    const p = pages.get(t);
    if (!p || p.length < MIN_LENGTH_LINKED) continue;
    add({ name: baseName(t), wikiTitle: t, linked: true });
  }
  for (const t of catMembers) if (!isNoise(t)) add({ name: baseName(t), wikiTitle: t, local: true }); // カテゴリにはホテル・ビルも入っとる（大阪市で実測）
  for (const t of nearby) {
    const p = pages.get(t);
    if (!p) continue;
    const known = byKey.has(normalizeTitle(baseName(t))) || byTitle.has(p.title);
    if (!known && (isNoise(t) || p.length < MIN_LENGTH_NEARBY)) continue;
    add({ name: baseName(t), wikiTitle: t, local: false });
  }
  const out = order.map((k) => byKey.get(k)).map((c) => ({
    ...c,
    distKm: center && c.lat !== null && c.lng !== null ? distanceKm(center, { lat: c.lat, lng: c.lng }) : null,
  }));
  const hero = isHero
    ? { name: baseName(String(destination ?? '').trim()) || baseName(dest.title), wikiTitle: dest.title, local: true, hero: true, length: dest.length, url: dest.url, thumb: dest.thumb, lat: dest.lat, lng: dest.lng, extract: dest.extract || null, distKm: 0 }
    : null;

  // 粗く 120 件 → 言語版の数 → 並べ直して 50 件 → 説明文 → 説明文のふるいと印 → 並べ直して 40 件
  const rough = scoreCandidates([...(hero ? [hero] : []), ...filterByCourse(out, course)], PRELIM_MAX);
  await fillLangs(rough, cli, signal, state);
  const prelim = scoreCandidates(rough, EXTRACT_MAX);
  await fillExtracts(prelim, cli, signal, state);
  const muniBase = muni ? baseName(muni) : '';
  const heroFirst = hero ? firstSentence(hero.extract, 300) : '';
  const kept = prelim
    .filter((c) => c.hero || (!isClosedByExtract(c.extract) && !isVenueByExtract(c.extract) && !isNotSightByExtract(c.extract)))
    // 座標の無いまま主役の記事から拾った物は、説明文がその市町村の物やと言うとる時だけ残す（一般名詞の記事「五重塔」を、近くの塔として出さん）
    .filter((c) => c.hero || c.lat !== null || !c.linked || c.local || Boolean(muniBase && c.extract && c.extract.includes(muniBase)))
    // 主役が載っとる島・山地そのもの（厳島神社に対する厳島）は回る場所やない
    .filter((c) => c.hero || !(heroFirst.includes(c.name) && /(?:島|半島|山地|盆地|平野)。?$/.test(firstSentence(c.extract, 300))))
    .map((c) => (c.hero ? c : { ...c, climb: detectClimb(c), street: isStreetByExtract(c.extract), minor: isMinorSight(c) }));
  const candidates = scoreCandidates(kept);
  // 候補が 0 で、途中の問い合わせが落ちとった＝「無い」のやなく「取れんかった」。見つからん扱いにせず失敗として返す
  if (!candidates.length && state.partial) throw new CandidateError('sources failed', 0);

  return {
    ok: true,
    partial: state.partial,
    area: muni,
    center,
    dest: { title: dest.title, url: dest.url, extract: dest.extract, thumb: dest.thumb, lat: dest.lat, lng: dest.lng },
    candidates,
  };
}
