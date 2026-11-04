// 時刻と合計（設計書 §6.5）。Gemini の時刻は使わず、滞在と移動だけから組む。

function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fromMin(total) {
  const t = ((total % 1440) + 1440) % 1440;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function addMinutes(hhmm, min) {
  return fromMin(toMin(hhmm) + min);
}

/**
 * removed:true は飛ばす。数でない分は 0。元の配列は変えない。
 * 各 live な場所に gap（次の live な場所までの移動）を付ける：
 * 間に外した場所があれば、その分の移動も足して estimated:true（路線名は信用できんので落とす）。最後は null。
 */
export function computeSchedule(spots, startTime) {
  const list = (spots || []).map((s) => ({ ...s }));
  let clock = toMin(startTime);
  let totalCostYen = 0;
  let lastEnd = clock;
  let prevLive = null;
  let pendingGap = null; // prevLive から次の live までの移動を積む
  for (const s of list) {
    const m = s.moveToNext;
    if (s.removed) {
      if (pendingGap) {
        pendingGap.minutes += num(m && m.minutes);
        if (m && m.mode === 'transit') pendingGap.mode = 'transit';
        pendingGap.estimated = true;
        pendingGap.note = null;
      }
      continue;
    }
    if (prevLive) {
      prevLive.gap = pendingGap;
      clock += pendingGap ? pendingGap.minutes : 0;
    }
    const start = clock;
    const end = start + num(s.stayMinutes);
    s.start = fromMin(start);
    s.end = fromMin(end);
    lastEnd = end;
    clock = end;
    totalCostYen += num(s.costYen);
    prevLive = s;
    pendingGap = m ? { minutes: num(m.minutes), mode: m.mode ?? null, note: m.note ?? null, estimated: false } : { minutes: 0, mode: null, note: null, estimated: false };
  }
  if (prevLive) prevLive.gap = null;
  return { spots: list, totalMinutes: Math.max(0, lastEnd - toMin(startTime)), totalCostYen };
}

export function roundHalfHour(min) {
  return Math.round(num(min) / 30) * 30;
}

export function formatDuration(min) {
  const m = roundHalfHour(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `約${r}分`;
  return r ? `約${h}時間${r}分` : `約${h}時間`;
}
