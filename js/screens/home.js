// 画面1 行き先を入れる（設計書 §3.1）
import { el, icon, formatDateJa } from '../ui.js';
import { COURSES } from '../prompt.js';
import { isSpeechAvailable, listenOnce } from '../speech.js';

export function render(root, { state, nav, store }) {
  const last = store.getTrips()[0] || null;

  const input = el('input', {
    id: 'dest', type: 'text', placeholder: '例：大阪城', autocomplete: 'off', enterkeyhint: 'go', maxlength: 40,
    value: state.current.destination || '',
  });
  const go = el('button', { class: 'btn btn--primary', type: 'submit', disabled: !input.value.trim() }, ['おすすめを出す', icon('arrow')]);
  input.addEventListener('input', () => { go.disabled = !input.value.trim(); });

  const voice = el('button', { class: 'btn', type: 'button' }, [icon('mic'), '声で言う']);
  const voiceNote = el('div', { class: 'note', hidden: true });
  if (!isSpeechAvailable()) {
    voice.disabled = true;
    voiceNote.hidden = false;
    voiceNote.textContent = 'この端末では声の入力が使えません';
  } else {
    voice.addEventListener('click', () => {
      voice.replaceChildren(icon('mic'), '聞いています…');
      voice.disabled = true;
      listenOnce({
        onResult(text) { input.value = text; go.disabled = !text.trim(); },
        onError(kind) {
          voiceNote.hidden = false;
          voiceNote.textContent = kind === 'denied' ? 'マイクの使用が許可されていません。文字で入れてください。' : '聞き取れませんでした。もう一度押してください。';
        },
        onEnd() { voice.replaceChildren(icon('mic'), '声で言う'); voice.disabled = false; },
      });
    });
  }

  const form = el('form', {
    on: {
      submit(e) {
        e.preventDefault();
        const v = input.value.trim();
        if (!v) return;
        state.current.destination = v.slice(0, 40);
        nav('/course');
      },
    },
  }, [
    el('label', { for: 'dest', class: 'sr', text: '行きたい場所' }),
    el('div', { class: 'field' }, [icon('pin'), input]),
    voice,
    voiceNote,
  ]);
  form.style.display = 'flex'; form.style.flexDirection = 'column'; form.style.gap = '12px'; form.style.margin = '0';

  const head = el('div', { style: 'display:flex;flex-direction:column;gap:10px;position:relative' }, [
    el('div', { class: 'row row--between' }, [
      el('div', { class: 'sub', style: 'font-weight:500;letter-spacing:.06em', text: formatDateJa(new Date()) }),
      el('span', { class: 'date-mark' }, [icon('sun'), 'おでかけ日和']),
    ]),
    el('h1', { class: 'h1' }, ['どこへ', el('br'), '行きますか？']),
    el('div', { class: 'rule', ariaHidden: true }),
  ]);

  const gear = el('button', { class: 'gear', type: 'button', ariaLabel: '設定', on: { click: () => nav('/settings') } }, [icon('gear')]);

  const children = [gear, head, form];
  if (last) children.push(lastTrip(last, nav));
  children.push(el('div', { class: 'spacer' }), go);

  const screen = el('section', { class: 'screen', dataset: { screen: 'home' }, style: 'position:relative;padding-top:max(64px, env(safe-area-inset-top))' }, children);
  // 主ボタンは form の送信にする
  go.addEventListener('click', (e) => { e.preventDefault(); form.requestSubmit(); });
  root.append(screen);
  if (!last) setTimeout(() => input.focus({ preventScroll: true }), 50);
}

function lastTrip(trip, nav) {
  const first = (trip.spots || []).find((s) => !s.removed && ((s.photo && s.photo.thumb) || (s.wiki && s.wiki.thumb)));
  const course = COURSES[trip.course];
  const count = (trip.spots || []).filter((s) => !s.removed).length;
  const d = new Date(trip.createdAt);
  const photo = first
    ? el('img', { src: (first.photo && first.photo.thumb) || first.wiki.thumb, alt: '' })
    : el('div', { class: 'ph', text: trip.destination.slice(0, 2) });
  return el('div', { style: 'display:flex;flex-direction:column;gap:10px' }, [
    el('div', { class: 'row kicker' }, ['このまえの旅', el('span', { style: 'flex:1;height:1px;background:#E3E6EA', ariaHidden: true })]),
    el('a', { class: 'ticket', href: `#/trip/${trip.id}`, ariaLabel: `このまえの旅 ${trip.destination} を開く` }, [
      el('div', { class: 'ticket__photo' }, [photo, el('div', { class: 'ticket__shade' }), el('div', { class: 'ticket__text' }, [
        el('div', { class: 'ticket__title', text: trip.destination }),
        el('div', { class: 'ticket__sub', text: `${course ? course.name + 'コース' : ''}・${count}か所` }),
      ])]),
      el('div', { class: 'ticket__stub' }, [
        el('div', { class: 'ticket__vert', text: '行きました' }),
        el('div', { class: 'ticket__date', text: `${d.getMonth() + 1}.${d.getDate()}` }),
      ]),
    ]),
  ]);
}
