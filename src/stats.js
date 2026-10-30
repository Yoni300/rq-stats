// Turns a list of chat events into the numbers the overlay shows.

const DPS_WINDOW_MS = 10_000;
const CHART_BUCKETS = 60;  // 60 bars x 2 s = last 2 minutes
const CHART_STEP_MS = 2_000;

function computeStats(events, start, now) {
  const durationMs = Math.max(0, now - start);
  const hours = Math.max(durationMs, 60_000) / 3_600_000; // at least 1 min, so the first numbers are not huge
  const perHour = (n) => n / hours;

  let dealt = 0, recv = 0, heal = 0, hits = 0, misses = 0, exp = 0, gold = 0;
  let level = null, levelsGained = 0;
  let maxHit = { amount: 0, target: '' };
  const kills = new Map();
  const items = new Map();
  const dmg = [];
  const feed = [];

  for (const e of events) {
    switch (e.type) {
      case 'dmg':
        dealt += e.amount; hits++; dmg.push(e);
        if (e.amount > maxHit.amount) maxHit = { amount: e.amount, target: e.target };
        break;
      case 'miss': misses++; break;
      case 'recv': recv += e.amount; break;
      case 'heal': heal += e.amount; break;
      case 'gold': gold += e.amount; break;
      case 'level': level = e.level; levelsGained++; break;
      case 'kill': {
        const k = kills.get(e.mob) || { count: 0, exp: 0 };
        k.count++; k.exp += e.exp;
        kills.set(e.mob, k);
        exp += e.exp;
        break;
      }
      case 'item': {
        const it = items.get(e.name) || { qty: 0, rarity: null, last: 0 };
        it.qty += e.qty;
        it.last = Math.max(it.last, e.time);
        if (e.rarity && e.rarity !== '#FFFFFF') it.rarity = e.rarity;
        items.set(e.name, it);
        break;
      }
    }
    if (e.type !== 'dmg' && e.type !== 'miss' && e.type !== 'other') feed.push(e);
  }

  let dpsSum = 0;
  for (const d of dmg) if (d.time > now - DPS_WINDOW_MS && d.time <= now) dpsSum += d.amount;

  let peak = 0;
  for (let i = 0, j = 0, sum = 0; i < dmg.length; i++) {
    sum += dmg[i].amount;
    while (dmg[i].time - dmg[j].time >= DPS_WINDOW_MS) sum -= dmg[j++].amount;
    peak = Math.max(peak, sum);
  }

  const chart = new Array(CHART_BUCKETS).fill(0);
  for (const d of dmg) {
    const age = now - d.time;
    if (age >= 0 && age < CHART_BUCKETS * CHART_STEP_MS) {
      chart[CHART_BUCKETS - 1 - Math.floor(age / CHART_STEP_MS)] += d.amount / (CHART_STEP_MS / 1000);
    }
  }

  const itemList = [...items].map(([name, it]) => ({
    name, qty: it.qty, rarity: it.rarity, last: it.last, perHour: perHour(it.qty), card: /^карта/i.test(name),
  })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'ru'));

  return {
    start, now, durationMs,
    dps: dpsSum / (DPS_WINDOW_MS / 1000),
    avgDps: dealt / Math.max(durationMs / 1000, DPS_WINDOW_MS / 1000),
    peakDps: peak / (DPS_WINDOW_MS / 1000),
    gold, goldPerHour: perHour(gold),
    exp, expPerHour: perHour(exp),
    level, levelsGained,
    dealt, recv, heal, hits, misses, maxHit,
    totalKills: [...kills.values()].reduce((s, k) => s + k.count, 0),
    mobs: [...kills].map(([name, k]) => ({ name, count: k.count, exp: k.exp, perHour: perHour(k.count) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')),
    items: itemList,
    totalItems: itemList.reduce((s, it) => s + it.qty, 0),
    cards: itemList.filter((it) => it.card).reduce((s, it) => s + it.qty, 0),
    chart,
    feed: feed.slice(-6).map((e) => ({ type: e.type, text: e.text, time: e.time })),
  };
}

module.exports = { computeStats };
