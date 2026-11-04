// Gemini への問いの文（設計書 §5.4 §5.5 → v1.1 は §16.3 で置き換え）。純粋関数だけ。

import { formatCandidates } from './candidates.js';

// 場所の数は昼ごはんを抜いた数（昼は §16.4 の枠で別に置く）
export const COURSES = {
  walk: {
    id: 'walk',
    name: 'お散歩',
    count: 3,
    hours: '約2時間',
    desc: '歩いて行ける近場だけ',
    rule: '徒歩のみ。目的地から約2km以内。滞在と移動を合わせて約2時間に収める。',
  },
  half: {
    id: 'half',
    name: '半日',
    count: 4,
    hours: '約4時間',
    desc: '電車やバスも使って',
    rule: '徒歩と公共交通。目的地から約10km以内。滞在と移動を合わせて約3時間に収める（別に昼ごはん1時間が入る）。近い場所を優先する。',
  },
  full: {
    id: 'full',
    name: '1日たっぷり',
    count: 6,
    hours: '約8時間',
    desc: '少し遠くまで大きく回る',
    rule: '徒歩と公共交通。目的地から約30km以内。滞在と移動を合わせて約7時間に収める（別に昼ごはん1時間が入る）。',
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
    rule: '★印の場所と「すでに行った場所」は入れない。地元の人が勧めるような、知る人ぞ知る場所を選ぶ。',
  },
};

export const START_TIMES = ['9:00', '10:00', '11:00', '13:00'];

export const SYSTEM_INSTRUCTION = `あなたは日本国内の旅行案内です。利用者は年配の方で、娘さんと旅行します。
目的地の周りで、実在する観光地だけを選び、回りやすい順番に並べたルートを作ります。

守ること：
- 場所は必ず実在するものだけ。自信がない場所は入れない。
- 候補の一覧が渡されたら、その中からだけ選ぶ。名前は一覧の表記を一字一句そのまま使う。
- 場所の名前は、Googleマップや看板で使われている正式な名前にする（略さない・言い換えない）。
- 食事の店は入れない（ごはんの場所は別に探すので、観光地だけを並べる）。
- コンサートホール・劇場・商業ビルのように、催しが無ければ見る物が無い所は入れない。
- 料金と時間はあくまで目安でよいが、明らかに違う数字は書かない。分からなければ null。
- 歩く距離は控えめに（年配の方が無理なく回れる量）。
- 出力は JSON だけ。前後に説明文や \`\`\` を付けない。`;

/**
 * 利用者の文。candidates があれば一覧を入れ、場所の数は min(コースの数, 候補の数)。
 * visited（すでに行った場所の名前）は 2回目モードで「入れない」一覧として渡す。
 */
export function buildUserPrompt({ destination, course, startTime, today, mode = 'classic', candidates = [], visited = [] }) {
  const c = COURSES[course];
  if (!c) throw new Error(`unknown course: ${course}`);
  const m = MODES[mode] || MODES.classic;
  const list = Array.isArray(candidates) ? candidates : [];
  const count = list.length ? Math.min(c.count, list.length) : c.count;
  const head = [
    `目的地：${destination}`,
    `コース：${c.name}（${c.rule}）`,
    `選び方：${m.name}（${m.rule}）`,
    `出発時刻：${startTime}`,
    `場所の数：${count}`,
    `今日の日付：${today}`,
  ];
  const blocks = [head.join('\n')];
  if (list.length) {
    blocks.push(`候補の一覧（この中からだけ選ぶ。一覧に無い場所は入れない。名前は一覧の表記のまま）：\n${formatCandidates(list)}`);
  }
  const seen = (visited || []).map((v) => String(v ?? '').trim()).filter(Boolean);
  if (seen.length) {
    blocks.push(`すでに行った場所（入れない）：\n${seen.map((v) => `- ${v}`).join('\n')}`);
  }
  blocks.push(`次の JSON の形で返してください：
{
  "destination": "正式な名前",
  "area": "市区町村（例：大阪市中央区）",
  "spots": [
    {
      "name": "正式な名前",
      "kind": "観光 | 自然 | 買い物 | 体験",
      "summary": "1〜2文の紹介（やさしい言葉で）",
      "stay_minutes": 60,
      "cost_yen": 600,
      "cost_note": "入場料（大人）",
      "hours": "9:00〜17:00 または null",
      "official_url": "公式サイトの URL または null",
      "move_to_next": { "mode": "walk | transit | taxi", "minutes": 10, "note": "谷町線で2駅 など、または null" }
    }
  ]
}
最後の場所の move_to_next は null にしてください。`);
  return blocks.join('\n\n');
}
