// 画面5 場所の詳細（設計書 §3.5）
import { el, icon, yen } from '../ui.js';
import { searchUrl } from '../maplinks.js';
import { askRemove, photoOf } from './trip.js';

export function render(root, { nav, store, route }) {
  const trip = store.getTrip(route.id);
  const spot = trip && trip.spots.find((s) => s.n === route.n);
  if (!trip || !spot) { nav(trip ? `/trip/${trip.id}` : '/home'); return; }
  const live = trip.spots.filter((s) => !s.removed);
  const order = live.indexOf(spot) + 1;
  const p = photoOf(spot);
  const photo = p && p.thumb;
  const credit = p ? (p.source === 'commons' ? '近くの写真：Wikimedia Commons' : '写真：Wikipedia') : '';

  const chips = el('div', { class: 'chips' });
  if (spot.costYen !== null && spot.costYen !== undefined) {
    chips.append(el('span', { class: 'chip' }, [`${spot.kind === '食事' ? '目安' : '入場'} ${spot.costYen === 0 ? '無料' : yen(spot.costYen)}`, spot.costYen === 0 ? null : el('small', { text: '目安' })]));
  }
  if (spot.stayMinutes) chips.append(el('span', { class: 'chip', text: `${spot.kind === '食事' ? '' : '見学 '}${fmt(spot.stayMinutes)}` }));
  if (spot.hours) chips.append(el('span', { class: 'chip', style: 'font-variant-numeric:tabular-nums', text: spot.hours }));

  const desc = (spot.wiki && spot.wiki.extract) || spot.summary || '';
  const links = el('div', { class: 'links' });
  if (spot.officialUrl) links.append(linkRow('globe', '公式サイト', spot.officialUrl));
  if (spot.wiki && spot.wiki.url) links.append(linkRow('book', 'Wikipedia で読む', spot.wiki.url));
  links.append(linkRow('pin', 'Googleマップ', searchUrl(spot.name, trip.area), { primary: true, small: '写真・口コミ' }));

  root.append(el('section', { class: 'screen screen--bare', dataset: { screen: 'spot' } }, [
    el('div', { class: 'photo' }, [
      photo ? el('img', { src: photo, alt: spot.name }) : el('div', { class: 'ph', text: spot.name.slice(0, 2) }),
      el('div', { class: 'hero__shade hero__shade--top', style: 'position:absolute;inset:0' }),
      el('button', { class: 'back back--pill', type: 'button', on: { click: () => nav(`/trip/${trip.id}`) } }, [icon('back', 18), 'ルートにもどる']),
      photo ? el('span', { class: 'hero__credit', text: credit }) : null,
    ]),
    el('div', { class: 'detail' }, [
      el('div', { class: 'detail__head' }, [
        el('div', { class: 'seal', ariaHidden: true }, [el('span', { class: 'seal__num', text: String(order || spot.n) }), el('span', { class: 'seal__label', text: 'か所目' })]),
        el('div', { style: 'display:flex;flex-direction:column;gap:4px' }, [
          el('div', { class: 'kicker', text: spot.start ? `${spot.start} から${spot.stayMinutes ? `・${fmt(spot.stayMinutes)}` : ''}` : '' }),
          el('h1', { class: 'h2', text: spot.name }),
        ]),
      ]),
      chips.childElementCount ? chips : null,
      desc ? el('p', { text: desc }) : null,
      spot.verified === 'none' ? el('div', { class: 'note', text: '場所の確認ができませんでした。Googleマップで確かめてください。' }) : null,
      el('div', { class: 'spacer' }),
      links,
      spot.removed ? null : el('button', { class: 'btn btn--text', type: 'button', style: 'align-self:center', on: { click: () => askRemove(trip, spot, { store, nav }) } }, ['このルートから外す']),
    ]),
  ]));
}

function fmt(m) {
  const h = Math.floor(m / 60); const r = m % 60;
  return h ? (r ? `${h}時間${r}分` : `${h}時間`) : `${r}分`;
}

function linkRow(iconName, label, href, { primary = false, small = null } = {}) {
  const ext = icon('external', 20); ext.classList.add('ext');
  const body = el('span', {}, [icon(iconName), label, small ? el('small', { text: small }) : null]);
  return el('a', { class: `linkrow${primary ? ' linkrow--primary' : ''}`, href, target: '_blank', rel: 'noopener' }, [body, ext]);
}
