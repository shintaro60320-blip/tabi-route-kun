// 季節（設計書 §17.5）。記事の説明文から「その月の見どころ」を読む。名前では判断せん。純粋関数だけ。

// ctx:true＝その語と同じ文に「名所・見頃・知られる・咲く…」がある時だけ数える（§18.6）。
// 実測（2026-11-10）：和菓子店の記事の「もみじ饅頭」で「今の季節：紅葉」が付いた。
const FEATURES = [
  { note: '桜', re: /桜|サクラ|花見/, months: [3, 4], ctx: true },
  { note: '梅', re: /梅(?!雨)/, months: [2, 3], ctx: true },
  { note: '藤', re: /藤の花|藤棚|フジの花/, months: [4, 5] },
  { note: '紫陽花', re: /紫陽花|あじさい|アジサイ/, months: [6], ctx: true },
  { note: 'ホタル', re: /ホタル|蛍/, months: [6], ctx: true },
  { note: 'ラベンダー', re: /ラベンダー/, months: [7], ctx: true },
  { note: 'ひまわり', re: /ひまわり|ヒマワリ|向日葵/, months: [7, 8], ctx: true },
  { note: 'コスモス', re: /コスモス/, months: [9, 10], ctx: true },
  { note: '彼岸花', re: /彼岸花|ヒガンバナ/, months: [9], ctx: true },
  { note: '紅葉', re: /紅葉|もみじ|モミジ/, months: [10, 11], ctx: true },
  { note: '雪', re: /雪景色|樹氷|氷瀑|雪まつり/, months: [12, 1, 2] },
];
const CONTEXT = /名所|見頃|見ごろ|知られ|有名|並木|群生|自生|咲|色づ|狩り|まつり|祭|ライトアップ|百選|100選|美し|見られ|楽しめ|彩|花見/;
// 食べ物・商品の名前に入っとる語は季節やない
const NOT_SEASON = /饅頭|まんじゅう|餅|もち|菓子|漬|干し|酒/;


// 季節限定の施設（名前で分かるもの）と、説明文の冬季閉鎖
const SEASONAL_NAME = [
  { re: /スキー|スノー/, months: [12, 1, 2, 3] },
  { re: /海水浴場/, months: [7, 8] },
  { re: /ホタルの里/, months: [6] },
];
const WINTER_CLOSED = /冬季閉鎖|冬期閉鎖|冬季休業|冬期休業|冬季通行止|冬期通行止/;
const WINTER = [12, 1, 2, 3];

/** 説明文（extract）にある語のうち、旅行月に合う見どころの名前の一覧（重複なし）。 */
export function seasonFeatures(extract, month) {
  const t = String(extract ?? '');
  if (!t) return [];
  const sentences = t.split('。');
  const out = [];
  for (const f of FEATURES) {
    if (!f.months.includes(month) || out.includes(f.note)) continue;
    const hit = sentences.some((sn) => {
      const m = sn.match(f.re);
      if (!m) return false;
      if (!f.ctx) return true;
      const after = sn.slice(m.index, m.index + m[0].length + 6);
      return CONTEXT.test(sn) && !NOT_SEASON.test(after);
    });
    if (hit) out.push(f.note);
  }
  return out;
}

/** 季節限定の施設で時期外れなら true（渡さん）。通年の場所は false。 */
export function seasonDrop(c, month) {
  const name = String((c && c.name) || '');
  for (const s of SEASONAL_NAME) {
    if (s.re.test(name)) return !s.months.includes(month);
  }
  if (WINTER.includes(month) && WINTER_CLOSED.test(String((c && c.extract) || ''))) return true;
  return false;
}

/** 日付（YYYY-MM-DD）の月。読めんかったら null。 */
export function monthOf(dateIso) {
  const m = String(dateIso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const n = Number(m[2]);
  return n >= 1 && n <= 12 ? n : null;
}

/** 候補の一覧に seasonNote（最初の見どころ）・seasonBonus（+2）を付け、時期外れの季節施設を外す。日付が読めんかったらそのまま。 */
export function applySeason(list, dateIso) {
  const month = monthOf(dateIso);
  const src = list || [];
  if (month === null) return src.map((c) => ({ ...c, seasonNote: null, seasonBonus: 0 }));
  return src.filter((c) => !seasonDrop(c, month)).map((c) => {
    const notes = seasonFeatures(c.extract, month);
    return { ...c, seasonNote: notes[0] || null, seasonBonus: notes.length ? 2 : 0 };
  });
}

/** 今日の日付（日本時間・YYYY-MM-DD）。now は Date.now 相当。 */
export function todayJst(now = Date.now) {
  const t = Number(now());
  const ms = Number.isFinite(t) ? t : Date.now();
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
