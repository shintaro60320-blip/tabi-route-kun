// Gemini への問いの文（設計書 §17.4）。Gemini は候補の id から「どれを選ぶか＋一言」だけを返す。純粋関数だけ。

import { formatCandidates } from './candidates.js';
import { monthOf } from './season.js';

// 場所の数は昼ごはんを抜いた数（昼は §16.4 の枠で別に置く）。時間の予算は route.js（§17.6）。
export const COURSES = {
  walk: {
    id: 'walk',
    name: 'お散歩',
    count: 3,
    hours: '約2時間',
    desc: '歩いて行ける近場だけ',
    rule: '徒歩だけで回る。目的地から約2km以内。',
  },
  half: {
    id: 'half',
    name: '半日',
    count: 4,
    hours: '約4時間半',
    desc: '電車やバスも使って',
    rule: '徒歩と電車・バス。目的地から約10km以内。近い場所を優先する。',
  },
  full: {
    id: 'full',
    name: '1日たっぷり',
    count: 6,
    hours: '約8時間',
    desc: '少し遠くまで大きく回る',
    rule: '徒歩と電車・バス。目的地から約30km以内。',
  },
};

export const MODES = {
  classic: {
    id: 'classic',
    name: '定番',
    desc: '初めてならここ',
    rule: '初めて来た人が外せない有名な場所を優先する。★印（定番候補）を優先する。',
  },
  second: {
    id: 'second',
    name: '2回目',
    desc: '定番は外して、知る人ぞ知る所',
    rule: '★印の場所と前に提案した場所は一覧から外してある。地元の人が勧めるような、知る人ぞ知る場所を選ぶ。',
  },
};

export const START_TIMES = ['9:00', '10:00', '11:00', '13:00'];
export const KINDS = ['観光', '自然', '買い物', '体験', '温泉'];

export const SYSTEM_INSTRUCTION = `あなたは日本国内の旅行案内です。利用者は年配の方で、娘さんと旅行します。
渡された候補の一覧から、その日に回ると楽しい場所を選びます。回る順番と時間はアプリが決めるので、あなたは「どれを選ぶか」と「一言の紹介」だけを返します。

守ること：
- 候補の一覧からだけ選ぶ。id は一覧の id をそのまま使う。一覧に無い場所は入れない。
- 同じ id を二度入れない。頼まれた数より多く入れない。ふさわしい所が少なければ少なくてよい。
- 食事の店は入れない（ごはんの場所は別に探す）。
- 同じ種類ばかりにせず、見る・歩く・買う・くつろぐが混ざるようにする。
- 繁華街や地区の名前（〇〇の街・〇〇地区）より、具体的に見て回れる場所を優先する。
- 紹介（reason）は 1〜2 文・やさしい言葉。候補の説明文にあることだけを書き、知らないことは書かない。
- 滞在の分数と料金は目安でよいが、明らかに違う数字は書かない。料金が分からなければ null。
- 出力は JSON だけ。前後に説明文や \`\`\` を付けない。`;

/** 行く日の季節（春・夏・秋・冬）。日付が読めんかったら null。 */
export function seasonWord(dateIso) {
  const m = monthOf(dateIso);
  if (m === null) return null;
  if (m >= 3 && m <= 5) return '春';
  if (m >= 6 && m <= 8) return '夏';
  if (m >= 9 && m <= 11) return '秋';
  return '冬';
}

/**
 * 利用者の文。candidates は除外済み（§17.3）・id 付き（§17.2）。count は頼む場所の数。
 */
export function buildPickPrompt({ destination, course, mode = 'classic', travelDate, candidates = [], count }) {
  const c = COURSES[course];
  if (!c) throw new Error(`unknown course: ${course}`);
  const m = MODES[mode] || MODES.classic;
  const list = Array.isArray(candidates) ? candidates : [];
  const n = Math.max(1, Math.min(Number(count) || c.count, list.length || c.count));
  const season = seasonWord(travelDate);
  const head = [
    `目的地：${destination}`,
    `コース：${c.name}（${c.rule}）`,
    `選び方：${m.name}（${m.rule}）`,
    `行く日：${travelDate}${season ? `（${season}）` : ''}`,
    `場所の数：${n}`,
  ];
  const firstId = list[0] ? list[0].id : 'c1';
  return [
    head.join('\n'),
    `候補の一覧（この中からだけ選ぶ。id をそのまま使う）：\n${formatCandidates(list)}`,
    `次の JSON の形で返してください（${n} 件まで・ふさわしい順に）：
{
  "picks": [
    {
      "id": "${firstId}",
      "kind": "${KINDS.join(' | ')}",
      "reason": "1〜2文の紹介（やさしい言葉で）",
      "stay_minutes": 60,
      "cost_yen": 600,
      "cost_note": "入場料（大人）または null"
    }
  ]
}`,
  ].join('\n\n');
}

/** generateContent の responseSchema（§17.4）。id は候補の enum・picks は場所の数まで。 */
export function pickSchema(ids, max) {
  return {
    type: 'OBJECT',
    properties: {
      picks: {
        type: 'ARRAY',
        maxItems: String(Math.max(1, Number(max) || 1)),
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING', enum: ids.slice() },
            kind: { type: 'STRING', enum: KINDS.slice() },
            reason: { type: 'STRING' },
            stay_minutes: { type: 'INTEGER' },
            cost_yen: { type: 'INTEGER', nullable: true },
            cost_note: { type: 'STRING', nullable: true },
          },
          required: ['id', 'kind', 'reason', 'stay_minutes'],
          propertyOrdering: ['id', 'kind', 'reason', 'stay_minutes', 'cost_yen', 'cost_note'],
        },
      },
    },
    required: ['picks'],
  };
}
