// Google マップへのリンク（設計書 §7.2）。名前で渡す（座標は使わない）。

const DIR = 'https://www.google.com/maps/dir/?api=1';
const SEARCH = 'https://www.google.com/maps/search/?api=1';

export function placeQuery(name, area) {
  const a = area ? ` ${area}` : '';
  return encodeURIComponent(`${name}${a}`);
}

export function searchUrl(name, area) {
  return `${SEARCH}&query=${placeQuery(name, area)}`;
}

/** 経由地つきの全行程。2 件なら waypoints 無し。 */
export function fullRouteUrl(names, area, travelmode) {
  const list = names.map((n) => placeQuery(n, area));
  const origin = list[0];
  const destination = list[list.length - 1];
  const mid = list.slice(1, -1);
  const wp = mid.length ? `&waypoints=${mid.join('%7C')}` : '';
  return `${DIR}&origin=${origin}&destination=${destination}${wp}&travelmode=${travelmode}`;
}

/** ごはん枠（設計書 §16.4）：店は名指しせず、直前の場所の近くを Google マップで探す。type: 'lunch' | 'dinner' */
export function mealUrl(type, spotName, area) {
  const word = type === 'dinner' ? 'ディナー' : 'ランチ';
  return `${SEARCH}&query=${placeQuery(`${word} ${spotName}`, area)}`;
}

export function legUrl(from, to, area) {
  return `${DIR}&origin=${placeQuery(from, area)}&destination=${placeQuery(to, area)}&travelmode=transit`;
}

/**
 * お散歩＝徒歩の 1 本。半日／1日＝公共交通は経由地が使えないので区間ごと（＋車の全体）。
 * removed は除く。1 か所しか無ければその場所を開くだけ。
 */
export function routeLinks(trip) {
  const spots = (trip.spots || []).filter((s) => !s.removed);
  const area = trip.area || '';
  if (spots.length <= 1) {
    const s = spots[0];
    return { kind: 'single', url: s ? searchUrl(s.name, area) : SEARCH };
  }
  const names = spots.map((s) => s.name);
  if (trip.course === 'walk') {
    return { kind: 'single', url: fullRouteUrl(names, area, 'walking') };
  }
  const legs = [];
  for (let i = 0; i < spots.length - 1; i++) {
    legs.push({ label: `${spots[i].n}→${spots[i + 1].n} を開く`, url: legUrl(spots[i].name, spots[i + 1].name, area) });
  }
  return { kind: 'legs', overview: fullRouteUrl(names, area, 'driving'), legs };
}
