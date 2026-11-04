// Gemini への問いの文（設計書 §5.4 §5.5）。純粋関数だけ。

export const COURSES = {
  walk: {
    id: 'walk',
    name: 'お散歩',
    count: 3,
    hours: '約2時間',
    desc: '歩いて行ける近場だけ',
    rule: '徒歩のみ。目的地から約2km以内。',
  },
  half: {
    id: 'half',
    name: '半日',
    count: 5,
    hours: '約4時間',
    desc: '電車やバスも使って',
    rule: '徒歩と公共交通。目的地から約10km以内。昼ごはんを1か所入れる。',
  },
  full: {
    id: 'full',
    name: '1日たっぷり',
    count: 7,
    hours: '約8時間',
    desc: '少し遠くまで大きく回る',
    rule: '徒歩と公共交通。目的地から約30km以内。昼ごはんと休憩（喫茶など）を入れる。',
  },
};

export const START_TIMES = ['9:00', '10:00', '11:00', '13:00'];

export const SYSTEM_INSTRUCTION = `あなたは日本国内の旅行案内です。利用者は年配の方で、娘さんと旅行します。
目的地の周りで、実在する場所だけを選び、回りやすい順番に並べたルートを作ります。

守ること：
- 場所は必ず実在するものだけ。自信がない場所は入れない。Google検索で確かめること。
- 場所の名前は、Googleマップや看板で使われている正式な名前にする（略さない・言い換えない）。
- 料金と時間はあくまで目安でよいが、明らかに違う数字は書かない。分からなければ null。
- 歩く距離は控えめに（年配の方が無理なく回れる量）。
- 昼ごはんは 12:00 前後に入れる。店は有名で入りやすい所にする。
- 出力は JSON だけ。前後に説明文や \`\`\` を付けない。`;

export function buildUserPrompt({ destination, course, startTime, today }) {
  const c = COURSES[course];
  if (!c) throw new Error(`unknown course: ${course}`);
  return `目的地：${destination}
コース：${c.name}（${c.rule}）
出発時刻：${startTime}
場所の数：${c.count}
今日の日付：${today}

次の JSON の形で返してください：
{
  "destination": "正式な名前",
  "area": "市区町村（例：大阪市中央区）",
  "spots": [
    {
      "name": "正式な名前",
      "kind": "観光 | 食事 | 休憩 | 買い物 | 自然",
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
最後の場所の move_to_next は null にしてください。`;
}
