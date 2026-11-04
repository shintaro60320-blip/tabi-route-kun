// 設定（設計書 §3.6）
import { el, icon, downloadText } from '../ui.js';
import { listModels, pickModel, classifyError } from '../gemini.js';
import { quotaDay } from '../store.js';
import { APP_VERSION } from '../app.js';

export function render(root, { nav, store }) {
  const s = store.getSettings();

  // キー
  const key = el('input', { id: 'apikey', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'AIza… で始まる文字列', value: s.apiKey });
  const toggle = el('button', { class: 'btn btn--small', type: 'button', ariaLabel: 'キーを表示', on: { click() { key.type = key.type === 'password' ? 'text' : 'password'; } } }, [icon('eye')]);
  const status = el('div', { class: 'note' });
  if (s.model && s.apiKey) { status.textContent = `使えます（モデル：${s.model}）`; status.className = 'status-ok'; }
  // キーを書き換えたら「使えます」は無効（確かめ直すまで）
  key.addEventListener('input', () => { status.className = 'note'; status.textContent = '変えたら「キーを確かめる」を押してください。'; });
  const check = el('button', { class: 'btn', type: 'button' }, ['キーを確かめる']);
  check.addEventListener('click', async () => {
    const apiKey = key.value.trim();
    const saved = store.saveSettings({ apiKey, model: '', models: [], lastKeyCheckAt: null, useSearch: true });
    if (!saved) { status.className = 'status-ng'; status.textContent = 'この端末に保存できませんでした（容量不足かプライベートモード）。'; return; }
    if (!apiKey) { status.className = 'status-ng'; status.textContent = 'キーが入っていません。'; return; }
    check.disabled = true; status.className = 'note'; status.textContent = '確かめています…';
    try {
      const names = await listModels({ apiKey });
      const model = pickModel(names);
      if (!model) { status.className = 'status-ng'; status.textContent = '使えるモデルが見つかりませんでした。'; return; }
      store.saveSettings({ model, models: names.map((n) => String(n).replace(/^models\//, '')), lastKeyCheckAt: new Date().toISOString() });
      status.className = 'status-ok'; status.textContent = `使えます（モデル：${model}）`;
    } catch (e) {
      const kind = classifyError(e && e.status);
      status.className = 'status-ng';
      status.textContent = kind === 'key' ? 'キーが正しくないようです。もう一度確かめてください。'
        : kind === 'quota' ? '今日の分を使い切っているようです。明日（夕方以降）また試してください。'
          : (navigator.onLine === false ? 'インターネットにつながっていません。' : '確かめられませんでした。しばらくしてからもう一度お試しください。');
      console.error('key check failed', e && e.status);
    } finally {
      check.disabled = false;
    }
  });

  // 今日の残り
  const used = store.getUsage(new Date());
  const usage = el('div', { class: 'note', text: `今日 ${used} 回使いました（目安の上限 ${s.dailyLimit} 回・${quotaDay(new Date())} の分）` });

  // 文字の大きさ
  const seg = el('div', { class: 'seg', role: 'group', ariaLabel: '文字の大きさ' });
  const mk = (label, scale) => el('button', { type: 'button', ariaPressed: s.fontScale === scale, on: { click() { store.saveSettings({ fontScale: scale }); window.dispatchEvent(new Event('trk:settings')); render(root, { nav, store }); } } }, [label]);
  seg.append(mk('ふつう', 1), mk('大きい', 1.15));

  const exportBtn = el('button', { class: 'btn', type: 'button', on: { click() { downloadText(`tabi-route-${quotaDay(new Date())}.json`, store.exportTripsJson()); } } }, ['保存した旅を書き出す']);
  const clearBtn = el('button', { class: 'btn', type: 'button', on: { click() { if (confirm('保存した旅をすべて消します。よろしいですか？')) { store.clearTrips(); render(root, { nav, store }); } } } }, ['保存した旅を消す']);

  // キーの取り方（取ってくるのが一番の難所なので、リンクと手順を目の前に置く）
  const getKey = el('div', { class: 'setting', style: 'border-top:0;padding-top:0;gap:12px' }, [
    el('div', { class: 'setting__label', text: 'キーをまだ持っていない時' }),
    el('div', { class: 'note', text: 'Google の「AI Studio」というページで、自分の Google アカウントのキーを無料で作れます（カード登録は要りません）。' }),
    el('a', { class: 'linkrow linkrow--primary', href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, [
      el('span', {}, [icon('globe'), 'キーを作るページを開く']),
      extIcon(),
    ]),
    el('ol', { class: 'note', style: 'padding-left:20px;margin:0' }, [
      el('li', { text: '開いたページで Google にログイン（初回は利用規約に同意）。' }),
      el('li', { text: '青い「API キーを作成」を押す →「新しいプロジェクトで作成」。' }),
      el('li', { text: '「AIza…」で始まる文字列の横の「コピー」を押す。' }),
      el('li', { text: 'この画面に戻り、上の欄を長押し →「貼り付け」→「キーを確かめる」。' }),
    ]),
    el('div', { class: 'note', text: 'キーは自分だけのものです。人に送ったり、画面を撮って見せたりしないでください。' }),
  ]);

  const howto = el('details', {}, [
    el('summary', { style: 'font-weight:700;min-height:44px;display:flex;align-items:center;cursor:pointer', text: '使い方' }),
    el('ol', { class: 'note', style: 'padding-left:20px' }, [
      el('li', { text: 'キーを貼って「キーを確かめる」を押します（上の手順）。' }),
      el('li', { text: 'Chrome の右上「⋮」→「ホーム画面に追加」で、アプリとして置けます。' }),
      el('li', { text: '行き先を1つ入れて「おすすめを出す」。料金と時間は目安です。' }),
      el('li', { text: '「今日の分を使い切りました」と出たら、夕方以降にまた使えます。' }),
    ]),
  ]);

  root.replaceChildren();
  root.append(el('section', { class: 'screen', dataset: { screen: 'settings' } }, [
    el('button', { class: 'back', type: 'button', on: { click: () => nav('/home') } }, [icon('back'), 'もどる']),
    el('h1', { class: 'h1 h1--s', text: '設定' }),
    el('div', { class: 'setting' }, [
      el('label', { class: 'setting__label', for: 'apikey', text: 'Gemini のキー' }),
      el('div', { class: 'setting__row' }, [el('div', { class: 'field field--pw' }, [key]), toggle]),
      check, status,
      el('div', { class: 'note', text: 'このキーはこのスマホの中にだけ保存されます。画面を人に見せる時は隠してください。' }),
    ]),
    getKey,
    el('div', { class: 'setting' }, [el('div', { class: 'setting__label', text: '今日の残り' }), usage]),
    el('div', { class: 'setting' }, [el('div', { class: 'setting__label', text: '文字の大きさ' }), seg]),
    el('div', { class: 'setting' }, [el('div', { class: 'setting__label', text: '保存した旅' }), exportBtn, clearBtn]),
    el('div', { class: 'setting' }, [howto]),
    el('div', { class: 'note', text: `版：${APP_VERSION}` }),
  ]));
}

function extIcon() {
  const i = icon('external', 20); i.classList.add('ext'); return i;
}
