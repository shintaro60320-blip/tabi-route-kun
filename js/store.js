// 端末に持つデータ（設計書 §8）。localStorage が無い／書けない時はメモリで動く。

const KEY_SETTINGS = 'trk.settings';
const KEY_USAGE = 'trk.usage';
const KEY_TRIPS = 'trk.trips';
const MAX_TRIPS = 10;
const KEEP_DAYS = 30;

const DEFAULT_SETTINGS = Object.freeze({
  v: 1, apiKey: '', model: '', fontScale: 1, dailyLimit: 100, lastKeyCheckAt: null, useSearch: true,
});
// models（キー確認で取れた使えるモデルの一覧）は任意の項目。既定には入れん（テストの既定値を変えんため）

/** 太平洋時間の日付（Google の無料枠が戻る時刻に合わせる）。3〜11 月は UTC-7、それ以外は UTC-8。 */
export function quotaDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  const month = d.getUTCMonth() + 1;
  const offsetHours = month >= 3 && month <= 11 ? 7 : 8;
  const shifted = new Date(d.getTime() - offsetHours * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function readJson(storage, key) {
  try {
    const raw = storage ? storage.getItem(key) : null;
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export function createStore(storage = (typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null)) {
  // メモリ上の正。storage は「書けたら書く」。
  const mem = {
    settings: { ...DEFAULT_SETTINGS, ...(readJson(storage, KEY_SETTINGS) || {}) },
    usage: readJson(storage, KEY_USAGE) || { v: 1, days: {} },
    trips: readJson(storage, KEY_TRIPS) || { v: 1, items: [] },
  };
  if (!mem.usage.days || typeof mem.usage.days !== 'object') mem.usage.days = {};
  if (!Array.isArray(mem.trips.items)) mem.trips.items = [];

  let failed = false;
  function persist(key, value) {
    if (!storage) { failed = false; return true; }
    try {
      storage.setItem(key, JSON.stringify(value));
      failed = false;
      return true;
    } catch {
      // 容量超え・プライベートモード：メモリで動き続け、画面に「保存できん」と出せるよう印だけ残す
      failed = true;
      return false;
    }
  }

  return {
    /** 直近の保存が端末に書けんかったか（画面で知らせる用） */
    saveFailed() {
      return failed;
    },
    getSettings() {
      return { ...mem.settings };
    },
    saveSettings(partial) {
      mem.settings = { ...mem.settings, ...(partial || {}), v: 1 };
      return persist(KEY_SETTINGS, mem.settings);
    },
    setDailyLimit(n) {
      this.saveSettings({ dailyLimit: n });
    },

    bumpUsage(date = new Date()) {
      const day = quotaDay(date);
      const cutoff = quotaDay(new Date(new Date(date).getTime() - KEEP_DAYS * 86400 * 1000));
      for (const k of Object.keys(mem.usage.days)) if (k < cutoff) delete mem.usage.days[k];
      mem.usage.days[day] = (mem.usage.days[day] || 0) + 1;
      persist(KEY_USAGE, mem.usage);
      return mem.usage.days[day];
    },
    getUsage(date = new Date()) {
      return mem.usage.days[quotaDay(date)] || 0;
    },

    addTrip(trip) {
      mem.trips.items = [trip, ...mem.trips.items.filter((t) => t.id !== trip.id)].slice(0, MAX_TRIPS);
      return persist(KEY_TRIPS, mem.trips);
    },
    getTrips() {
      return mem.trips.items.slice();
    },
    getTrip(id) {
      return mem.trips.items.find((t) => t.id === id) || null;
    },
    updateTrip(trip) {
      const i = mem.trips.items.findIndex((t) => t.id === trip.id);
      if (i < 0) return this.addTrip(trip);
      mem.trips.items[i] = trip;
      persist(KEY_TRIPS, mem.trips);
    },
    clearTrips() {
      mem.trips = { v: 1, items: [] };
      persist(KEY_TRIPS, mem.trips);
    },
    exportTripsJson() {
      return JSON.stringify(mem.trips, null, 2);
    },
  };
}
