// 場所の実在確認（設計書 §6）：日本語 Wikipedia → 無ければ Nominatim で座標だけ。

const WIKI = 'https://ja.wikipedia.org/w/api.php';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'TabiRouteKun/1.0 (personal use)'; // ヘッダは ISO-8859-1 のみ（日本語を入れると fetch が例外）
const WIKI_HEADERS = { 'Api-User-Agent': UA };

/** 比べるための正規化：NFKC・空白と「・」を除く・丸括弧の中を除く・小文字。 */
export function normalizeTitle(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s・]/g, '')
    .toLowerCase();
}

/** 片方がもう一方を含めば一致。空は不一致。 */
export function titlesMatch(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

function firstSentences(text, max = 3, limit = 120) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const parts = t.split('。').filter(Boolean);
  let out = parts.slice(0, max).join('。');
  if (parts.length) out += '。';
  if (out.length > limit) out = out.slice(0, limit - 1) + '…';
  return out;
}

/** action=query の返事から最初のページを読む。無い／missing なら null。 */
export function parseWikiPage(json) {
  const pages = json && json.query && json.query.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page || 'missing' in page) return null;
  const extract = firstSentences(page.extract);
  const coord = Array.isArray(page.coordinates) && page.coordinates[0];
  const disambiguation = Boolean(page.pageprops && 'disambiguation' in page.pageprops)
    || /は、以下/.test(String(page.extract ?? ''));
  return {
    title: page.title ?? null,
    url: page.fullurl ?? null,
    thumb: (page.thumbnail && page.thumbnail.source) || null,
    extract,
    lat: coord && Number.isFinite(Number(coord.lat)) ? Number(coord.lat) : null,
    lng: coord && Number.isFinite(Number(coord.lon)) ? Number(coord.lon) : null,
    disambiguation,
  };
}

/** 検索結果から名前と一致する最初の記事名。 */
export function pickSearchHit(name, searchJson) {
  const hits = (searchJson && searchJson.query && searchJson.query.search) || [];
  const hit = hits.find((h) => h && titlesMatch(name, h.title));
  return hit ? hit.title : null;
}

function pageUrl(title) {
  const q = new URLSearchParams({
    action: 'query', titles: title, prop: 'extracts|pageimages|coordinates|info|pageprops',
    exintro: '1', explaintext: '1', pithumbsize: '640', inprop: 'url', ppprop: 'disambiguation',
    format: 'json', origin: '*',
  });
  return `${WIKI}?${q}`;
}

async function getJson(fetchImpl, url, headers, signal) {
  const res = await fetchImpl(url, { headers, signal });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

/** §6.2 の 2 段：redirects=1 で直接 → 無ければ検索上位 3 件から一致する記事。失敗は null。中断は投げる。 */
export async function wikiLookup(name, { fetchImpl = fetch, signal } = {}) {
  try {
    const direct = new URLSearchParams({
      action: 'query', titles: name, redirects: '1', prop: 'extracts|pageimages|coordinates|info|pageprops',
      exintro: '1', explaintext: '1', pithumbsize: '640', inprop: 'url', ppprop: 'disambiguation',
      format: 'json', origin: '*',
    });
    const p1 = parseWikiPage(await getJson(fetchImpl, `${WIKI}?${direct}`, WIKI_HEADERS, signal));
    if (p1 && !p1.disambiguation) return p1;

    const search = new URLSearchParams({ action: 'query', list: 'search', srsearch: name, srlimit: '3', format: 'json', origin: '*' });
    const title = pickSearchHit(name, await getJson(fetchImpl, `${WIKI}?${search}`, WIKI_HEADERS, signal));
    if (!title) return null;
    const p2 = parseWikiPage(await getJson(fetchImpl, pageUrl(title), WIKI_HEADERS, signal));
    return p2 && !p2.disambiguation ? p2 : null;
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    return null;
  }
}

/**
 * Nominatim（直列・前回から 1,100ms 空ける）。query → {lat,lng}|null
 * 規約の「1秒1回」はアプリ全体の約束なので、本番は defaultNominatim（1 本）を共有する。
 * 呼び出しは (query, { signal, viewbox }) 。viewbox＝{lat,lng} を渡すと、その周り ±0.5 度（約 50km）に絞る（bounded=1・§17.2-5）。中断された予約は通信せずに null。
 */
export function createNominatim({ fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const GAP = 1100;
  let last = -Infinity;
  let chain = Promise.resolve();
  return (query, { signal, viewbox = null } = {}) => {
    const job = async () => {
      if (signal && signal.aborted) return null;
      const wait = last + GAP - now();
      if (wait > 0) await sleep(wait);
      if (signal && signal.aborted) return null;
      last = now();
      try {
        const q = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', countrycodes: 'jp' });
        if (viewbox && Number.isFinite(viewbox.lat) && Number.isFinite(viewbox.lng)) {
          q.set('viewbox', `${viewbox.lng - 0.5},${viewbox.lat + 0.5},${viewbox.lng + 0.5},${viewbox.lat - 0.5}`);
          q.set('bounded', '1');
        }
        const res = await fetchImpl(`${NOMINATIM}?${q}`, { headers: { Accept: 'application/json' }, signal });
        if (!res.ok) return null;
        const arr = await res.json();
        const hit = Array.isArray(arr) && arr[0];
        if (!hit) return null;
        const lat = Number(hit.lat); const lng = Number(hit.lon);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
      } catch {
        return null;
      }
    };
    const p = chain.then(job, job);
    chain = p.catch(() => {});
    return p;
  };
}

/** アプリ全体で 1 本の Nominatim 待ち行列（規約：1 秒 1 回）。 */
export const defaultNominatim = createNominatim();

const COMMONS = 'https://commons.wikimedia.org/w/api.php';

/** Commons の geosearch の返事から、最初の jpeg/png を 1 枚。 */
export function parseCommonsNearby(json) {
  const pages = json && json.query && json.query.pages;
  if (!pages) return null;
  for (const p of Object.values(pages)) {
    const ii = Array.isArray(p.imageinfo) && p.imageinfo[0];
    if (!ii || !/^image\/(jpeg|png)$/.test(String(ii.mime))) continue;
    if (!ii.thumburl) continue;
    return { thumb: ii.thumburl, url: ii.descriptionurl || null, title: p.title || null };
  }
  return null;
}

/** その座標の近く（半径 120m）で撮られた写真を 1 枚（記事が無い店・施設の代わり）。失敗は null。 */
export async function commonsNearby(lat, lng, { fetchImpl = fetch, signal } = {}) {
  try {
    const q = new URLSearchParams({
      action: 'query', generator: 'geosearch', ggscoord: `${lat}|${lng}`, ggsradius: '120', ggsnamespace: '6', ggslimit: '5',
      prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '640', format: 'json', origin: '*',
    });
    return parseCommonsNearby(await getJson(fetchImpl, `${COMMONS}?${q}`, WIKI_HEADERS, signal));
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    return null;
  }
}

/**
 * 1 か所の確認。verified: 'wiki' | 'osm' | 'none'。中断（AbortError）は投げる。
 * photo: {thumb, source:'wiki'|'commons', url} | null（wiki の記事写真 → 無ければ座標の近くの写真）
 */
export async function verifySpot(spot, area, { fetchImpl = fetch, nominatim, signal } = {}) {
  const name = spot && spot.name ? String(spot.name) : '';
  const out = { verified: 'none', wiki: null, lat: null, lng: null, photo: null };
  if (!name) return out;
  // 候補から来た場所は記事名が分かっとる（§16）ので、それで直接引く（検索で別の記事に当たるのを防ぐ）
  const page = await wikiLookup((spot.wikiTitle && String(spot.wikiTitle)) || name, { fetchImpl, signal });
  if (page) {
    out.verified = 'wiki';
    out.wiki = { title: page.title, url: page.url, thumb: page.thumb, extract: page.extract };
    out.lat = page.lat; out.lng = page.lng;
    if (page.thumb) out.photo = { thumb: page.thumb, source: 'wiki', url: page.url };
  }
  if ((out.lat === null || out.lng === null) && nominatim) {
    let c = await nominatim(area ? `${name} ${area}` : name, { signal });
    if (!c && area) c = await nominatim(name, { signal }); // 市区町村を付けると引けん名前がある（施設名に地名が入っとる等）
    if (c) {
      out.lat = c.lat; out.lng = c.lng;
      if (out.verified === 'none') out.verified = 'osm';
    }
  }
  if (!out.photo && out.lat !== null && out.lng !== null) {
    const near = await commonsNearby(out.lat, out.lng, { fetchImpl, signal });
    if (near) out.photo = { thumb: near.thumb, source: 'commons', url: near.url };
  }
  return out;
}

/** 全部の場所。Wikipedia は並列、Nominatim は 1 本を共有。どれかが落ちても全体は落とさない（中断だけは投げる）。 */
export async function verifyAll(spots, area, { fetchImpl = fetch, nominatim, signal } = {}) {
  const nom = nominatim ?? defaultNominatim;
  return Promise.all((spots || []).map(async (s) => {
    try {
      return await verifySpot(s, area, { fetchImpl, nominatim: nom, signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      return { verified: 'none', wiki: null, lat: null, lng: null, photo: null };
    }
  }));
}
