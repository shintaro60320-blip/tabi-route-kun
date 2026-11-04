// 声で言う（設計書 §4.2）。ブラウザの音声認識。無ければ使えないと返す。

function Recognition() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

export function isSpeechAvailable() {
  return Boolean(Recognition());
}

/** 1 回だけ聞く。onResult(text) / onError('denied'|'nothing'|'other') / onEnd() */
export function listenOnce({ lang = 'ja-JP', onResult, onError, onEnd } = {}) {
  const R = Recognition();
  if (!R) { onError && onError('other'); onEnd && onEnd(); return; }
  const rec = new R();
  rec.lang = lang;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  let done = false;
  rec.onresult = (e) => {
    const text = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : '';
    done = true;
    if (text) onResult && onResult(text.trim());
    else onError && onError('nothing');
  };
  rec.onerror = (e) => {
    done = true;
    const kind = e && (e.error === 'not-allowed' || e.error === 'service-not-allowed') ? 'denied' : (e && e.error === 'no-speech' ? 'nothing' : 'other');
    onError && onError(kind);
  };
  rec.onend = () => {
    if (!done) onError && onError('nothing');
    onEnd && onEnd();
  };
  try {
    rec.start();
  } catch {
    onError && onError('other');
    onEnd && onEnd();
  }
}
