// Understands Royal Quest chat lines (Russian client).
// Used for both sources: the chat history files (chatlogs\*.htm) and text read from the screen.
//
// A file row looks like:
// <TR style='color:#FFD20F' valign=top title='10/30 20:20:04'><TD colspan=2>Вы нанесли 12 урона. Цель: Росинка

const ROW_RE = /<TR style='color:#([0-9A-Fa-f]{6})'[^>]*title='(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})'><TD colspan=2>([\s\S]*?)(?=<TR |<\/?TABLE|<\/?BODY|$)/g;

const N = '(\\d[\\d\\s\\u00a0]*)';
const num = (s) => Number(String(s).replace(/[^\d]/g, ''));

const RULES = [
  [new RegExp('^Вы нанесли ' + N + ' урона\\.?\\s*Цель:\\s*(.+?)\\s*$', 'i'), (m) => ({ type: 'dmg', amount: num(m[1]), target: m[2] })],
  [/^Вы промахнулись по цели:\s*(.+?)\s*$/i, (m) => ({ type: 'miss', target: m[1] })],
  [new RegExp('^(.+?) наносит вам ' + N + ' урона', 'i'), (m) => ({ type: 'recv', amount: num(m[2]), source: m[1] })],
  [new RegExp('^(.+?) погибает\\.?\\s*Получено опыта:?\\s*' + N, 'i'), (m) => ({ type: 'kill', mob: m[1], exp: num(m[2]) })],
  [new RegExp('^Вы восстановили ' + N + ' здоровья', 'i'), (m) => ({ type: 'heal', amount: num(m[1]) })],
  [/^Вы достигли (\d+) уровня/i, (m) => ({ type: 'level', level: Number(m[1]) })],
  [new RegExp('^Поднято ' + N + ' золота', 'i'), (m) => ({ type: 'gold', amount: num(m[1]) })],
  [new RegExp('^Получен предмет:\\s*(.+?)(?:\\s*\\(' + N + '\\s*шт\\.?\\)?)?\\s*$', 'i'), (m) => ({ type: 'item', name: m[1], qty: m[2] ? num(m[2]) : 1 })],
];

// Turns one line of chat text into an event (without time). Unknown lines get type "other".
function parseText(text) {
  for (const [re, make] of RULES) {
    const m = re.exec(text);
    if (m) return make(m);
  }
  return { type: 'other' };
}

function decode(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// The year is not in the rows, so it comes from the file name "(2026.10...)" or the current date.
function yearFromName(fileName) {
  const m = /\((\d{4})\.\d{2}/.exec(fileName || '');
  return m ? Number(m[1]) : new Date().getFullYear();
}

// Parses a whole file (or a newly appended part of it) into events.
function parseChatLog(html, fileName) {
  const year = yearFromName(fileName);
  const events = [];
  ROW_RE.lastIndex = 0;
  let m;
  while ((m = ROW_RE.exec(html))) {
    const [, color, mo, d, h, mi, s, body] = m;
    const itemColor = (/<U style='color:#([0-9A-Fa-f]{6})'>/.exec(body) || [])[1];
    const text = decode(body.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    const ev = parseText(text);
    ev.time = new Date(year, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
    ev.text = text;
    ev.color = '#' + color.toUpperCase();
    ev.src = 'file';
    if (ev.type === 'item' && itemColor) ev.rarity = '#' + itemColor.toUpperCase();
    events.push(ev);
  }
  return events;
}

module.exports = { parseChatLog, parseText };
