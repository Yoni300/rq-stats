// Prints statistics for one chat log file. Usage: node src/cli.js "<path to .htm>"
const fs = require('fs');
const path = require('path');
const { parseChatLog } = require('./parser');
const { computeStats } = require('./stats');

const file = process.argv[2];
if (!file) {
  console.error('Вкажіть шлях до файлу chatlogs\\*.htm');
  process.exit(1);
}

const events = parseChatLog(fs.readFileSync(file, 'utf8'), path.basename(file));
if (!events.length) {
  console.log('У файлі немає записів.');
  process.exit(0);
}
const st = computeStats(events, events[0].time, events[events.length - 1].time);
const f = (n) => Math.round(n).toLocaleString('uk-UA');
const mmss = (ms) => `${Math.floor(ms / 60000)} хв ${Math.round(ms / 1000) % 60} с`;

console.log(`Записів: ${events.length}, тривалість: ${mmss(st.durationMs)}`);
console.log(`Нанесено: ${f(st.dealt)} (ударів ${st.hits}, промахів ${st.misses}), макс. удар ${st.maxHit.amount} по ${st.maxHit.target}`);
console.log(`Сер. DPS: ${st.avgDps.toFixed(1)}, пік DPS: ${st.peakDps.toFixed(1)}`);
console.log(`Отримано урону: ${f(st.recv)}, лікування: ${f(st.heal)}`);
console.log(`Досвід: ${f(st.exp)} (${f(st.expPerHour)}/год), рівень: ${st.level ?? '—'}`);
console.log(`Золото: ${f(st.gold)} (${f(st.goldPerHour)}/год)`);
console.log(`Вбито мобів: ${st.totalKills}`);
st.mobs.forEach((m) => console.log(`  ${m.name}: ${m.count} (${f(m.perHour)}/год)`));
console.log(`Предметів: ${st.totalItems}, карт: ${st.cards}`);
st.items.forEach((it) => console.log(`  ${it.name} ×${it.qty}${it.rarity ? ' ' + it.rarity : ''}`));
const unknown = events.filter((e) => e.type === 'other');
if (unknown.length) {
  console.log('Нерозпізнані рядки:');
  unknown.forEach((e) => console.log(`  ${e.text}`));
}
