// 読み込み中・失敗（設計書 §3.7 §9）。生成そのものは course 画面が呼び、この画面は見せるだけ。
import { el, dots } from '../ui.js';

export function render(root, { state, nav }) {
  const job = state.job; // { destination, promise } を course 画面が置く
  if (!job) { nav('/home'); return; }

  const msg = el('h2', { class: 'h2', text: 'おすすめを考えています…' });
  const more = el('div', { class: 'sub', hidden: true, text: 'もう少しかかっています' });
  const box = el('section', { class: 'screen loading', dataset: { screen: 'loading' } }, [
    el('div', { class: 'spacer' }),
    msg,
    el('div', { class: 'kicker', text: job.destination }),
    dots(160),
    more,
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn btn--text', type: 'button', on: { click() { job.cancel(); nav('/course'); } } }, ['もどる']),
  ]);
  root.append(box);

  // 済んだ仕事を開き直した時（Android の「戻る」で戻ってきた等）は、もう一度結果へ飛ばさずコース選びへ
  if (job.settled) { nav('/course', { replace: true }); return; }

  const slow = setTimeout(() => { more.hidden = false; }, 15000);
  const mine = () => location.hash === '#/loading' && state.job === job; // 古い仕事の結果で画面を動かさん
  job.promise.then((trip) => {
    clearTimeout(slow);
    job.settled = true;
    if (!mine()) return;
    nav(`/trip/${trip.id}`, { replace: true }); // 履歴に読み込み画面を残さん
  }).catch((err) => {
    clearTimeout(slow);
    job.settled = true;
    if (!mine()) return;
    showError(root, box, err, { nav, job });
  });
}

function showError(root, box, err, { nav, job }) {
  const { text, action } = job.describeError(err);
  const retry = el('button', { class: 'btn btn--primary', type: 'button', on: { click() { job.retry(); } } }, ['もう一度']);
  const back = el('button', { class: 'btn', type: 'button', on: { click: () => nav('/course') } }, ['もどる']);
  const toSettings = el('button', { class: 'btn btn--primary', type: 'button', on: { click: () => nav('/settings') } }, ['設定へ']);
  const buttons = action === 'settings' ? [toSettings, back] : action === 'retry' ? [retry, back] : [back];
  box.replaceChildren(
    el('div', { class: 'spacer' }),
    el('div', { class: 'error', text }),
    ...buttons,
    el('div', { class: 'spacer' }),
  );
}
