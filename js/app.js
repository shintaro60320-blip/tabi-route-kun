// 起動・ハッシュで画面切替・状態（設計書 §11.1）。

import { createStore } from './store.js';
import { COURSES } from './prompt.js';
import * as home from './screens/home.js';
import * as settings from './screens/settings.js';
import * as loading from './screens/loading.js';

export const APP_VERSION = '1.0.1';

const store = createStore();
export const state = {
  store,
  get settings() { return store.getSettings(); },
  current: { destination: '', course: 'half', startTime: '10:00' },
  trip: null,
  pending: null, // 読み込み中の AbortController
};

const screens = {
  home, settings, loading,
};

// 後のタスクで足す画面（無ければ home に戻す）
async function loadExtra() {
  const names = ['course', 'trip', 'map', 'spot'];
  await Promise.all(names.map(async (n) => {
    try {
      screens[n] = await import(`./screens/${n}.js`);
    } catch {
      /* まだ無い */
    }
  }));
}

export function nav(path, { replace = false } = {}) {
  const hash = path.startsWith('#') ? path : `#${path}`;
  if (replace) {
    // 履歴を増やさん（読み込み画面→結果など、「戻る」で戻ってほしくない所）
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

function parse(hash) {
  const h = (hash || '').replace(/^#/, '') || '/home';
  const seg = h.split('/').filter(Boolean);
  if (seg[0] === 'trip' && seg[1]) {
    if (seg[2] === 'map') return { name: 'map', id: seg[1] };
    if (seg[2] === 'spot' && seg[3]) return { name: 'spot', id: seg[1], n: Number(seg[3]) };
    return { name: 'trip', id: seg[1] };
  }
  return { name: seg[0] || 'home' };
}

function applyFontScale() {
  document.documentElement.dataset.fs = state.settings.fontScale >= 1.15 ? 'large' : 'normal';
}

function render() {
  const route = parse(location.hash);
  const mod = screens[route.name] || screens.home;
  const root = document.getElementById('app');
  if (state.pending && route.name !== 'loading') {
    state.pending.abort();
    state.pending = null;
  }
  root.replaceChildren();
  window.scrollTo(0, 0);
  mod.render(root, { state, nav, route, store, COURSES });
}

applyFontScale();
window.addEventListener('hashchange', render);
window.addEventListener('trk:settings', applyFontScale);
loadExtra().then(render);
if (!location.hash) location.hash = '#/home';

// 殻のキャッシュ（ホーム画面追加・圏外でも画面が出る）。開発中（localhost）は登録しない。
const isDev = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && !isDev) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.error('sw register failed', e));
  });
}
