// 画面2 コース選び（設計書 §3.2）→ 生成の流れを起こして読み込み画面へ
import { el, icon } from '../ui.js';
import { COURSES, MODES, START_TIMES } from '../prompt.js';
import { generateTrip, errorMessage } from '../flow.js';
import { todayJst } from '../season.js';

const ICON = { walk: 'walk', half: 'train', full: 'sun' };
const TIMEOUT_MS = 150000; // 候補集め（Wikipedia 十数回・混んどる日は 50 秒かかった＝2026-11-10 実測）＋ Gemini

export function render(root, { state, nav, store }) {
  if (!state.current.destination) { nav('/home'); return; }
  const cur = state.current;

  const cards = Object.values(COURSES).map((c) => {
    const btn = el('button', { class: 'course', type: 'button', ariaPressed: cur.course === c.id, dataset: { course: c.id } }, [
      el('div', { class: 'course__icon' }, [icon(ICON[c.id])]),
      el('div', { class: 'course__name', text: c.name }),
      el('div', { class: 'course__time', text: c.hours }),
      el('div', { class: 'course__desc', text: `${c.desc}・${c.count}か所` }),
      pathSvg(c.count),
    ]);
    if (c.id === 'half') btn.append(el('span', { class: 'tag tag--brass course__badge', text: 'おすすめ' }));
    btn.addEventListener('click', () => {
      cur.course = c.id;
      cards.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.course === c.id)));
    });
    return btn;
  });

  // 選び方（設計書 §16.5）：定番／2回目
  if (!MODES[cur.mode]) cur.mode = 'classic';
  const modeDesc = el('div', { class: 'note modes__desc', text: MODES[cur.mode].desc });
  const modeBtns = Object.values(MODES).map((m) => el('button', { type: 'button', ariaPressed: cur.mode === m.id, text: m.name, on: { click() {
    cur.mode = m.id;
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === m.name)));
    modeDesc.textContent = m.desc;
  } } }));
  const modes = el('div', { class: 'modes', role: 'group', ariaLabel: '選び方' }, [
    el('div', { class: 'seg' }, modeBtns),
    modeDesc,
  ]);

  // 行く日（設計書 §17.5）：既定＝今日（日本時間）。季節の見どころの判定に使う
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cur.travelDate || '')) cur.travelDate = todayJst();
  const dateInput = el('input', { class: 'date', type: 'date', value: cur.travelDate, min: todayJst(), ariaLabel: '行く日', on: { change() { if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) cur.travelDate = dateInput.value; } } });
  const dateRow = el('div', { class: 'times' }, [el('span', { class: 'times__label', text: '行く日' }), dateInput]);

  const times = el('div', { class: 'times', role: 'group', ariaLabel: '出発時刻' }, [el('span', { class: 'times__label', text: '出発' })]);
  const timeBtns = START_TIMES.map((t) => el('button', { type: 'button', ariaPressed: cur.startTime === t, text: t, on: { click() { cur.startTime = t; timeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === t))); } } }));
  times.append(...timeBtns);

  const go = el('button', { class: 'btn btn--primary', type: 'button', on: { click: () => startJob({ state, nav, store }) } }, ['このコースで出す', icon('arrow')]);

  root.append(el('section', { class: 'screen', dataset: { screen: 'course' }, style: 'padding-top:max(56px, env(safe-area-inset-top))' }, [
    el('button', { class: 'back', type: 'button', on: { click: () => nav('/home') } }, [icon('back'), 'もどる']),
    el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
      el('div', { class: 'kicker', text: `${cur.destination}のまわり` }),
      el('h1', { class: 'h1 h1--s' }, ['どのくらい', el('br'), '回りますか？']),
      el('div', { class: 'rule', ariaHidden: true }),
    ]),
    modes,
    el('div', { style: 'display:flex;flex-direction:column;gap:14px' }, cards),
    dateRow,
    times,
    el('div', { class: 'spacer' }),
    go,
  ]));
}

/** 道のりの点線図：場所の数だけ点を並べる（長さは 3→56 / 5→100 / 7→146）。 */
function pathSvg(count) {
  const ns = 'http://www.w3.org/2000/svg';
  const len = count <= 3 ? 56 : count <= 5 ? 100 : 146;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 150 14'); svg.setAttribute('width', '150'); svg.setAttribute('height', '14');
  svg.setAttribute('class', 'course__path'); svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(ns, 'path');
  line.setAttribute('d', `M4 7 H${len}`); line.setAttribute('stroke', '#9A7B3C'); line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-dasharray', '2 5'); line.setAttribute('stroke-linecap', 'round'); line.setAttribute('fill', 'none');
  svg.append(line);
  for (let i = 0; i < count; i++) {
    const cx = 4 + ((len - 4) * i) / (count - 1);
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', String(cx)); c.setAttribute('cy', '7');
    if (i === 0) { c.setAttribute('r', '3.5'); c.setAttribute('fill', '#15202B'); }
    else if (i === count - 1) { c.setAttribute('r', '3.5'); c.setAttribute('fill', '#B5432A'); }
    else { c.setAttribute('r', '3'); c.setAttribute('fill', '#FFFFFF'); c.setAttribute('stroke', '#15202B'); c.setAttribute('stroke-width', '1.8'); }
    svg.append(c);
  }
  return svg;
}

/** 生成を起こし、読み込み画面に渡す。 */
export function startJob({ state, nav, store }) {
  const { destination, course, startTime } = state.current;
  const mode = MODES[state.current.mode] ? state.current.mode : 'classic';
  const travelDate = /^\d{4}-\d{2}-\d{2}$/.test(state.current.travelDate || '') ? state.current.travelDate : todayJst();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const job = { stage: 'collect', onStage: null };
  const promise = generateTrip({ destination, course, startTime, mode, travelDate, settings: store.getSettings(), store, signal: ac.signal, onStage(s) { job.stage = s; if (job.onStage) job.onStage(s); } })
    .finally(() => clearTimeout(timer));
  promise.catch(() => {}); // 読み込み画面が受ける
  state.pending = ac;
  state.job = Object.assign(job, {
    destination,
    promise,
    settled: false,
    cancel() { clearTimeout(timer); ac.abort(); },
    retry() { startJob({ state, nav, store }); },
    describeError(err) { return errorMessage(err && err.kind); },
  });
  if (location.hash === '#/loading') window.dispatchEvent(new HashChangeEvent('hashchange'));
  else nav('/loading');
}
