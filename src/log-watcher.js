// Watches the game's chatlogs folder:
// - "Stats (2026.10).htm"          monthly history, written by the game in chunks;
// - "Stats (2026.10.30  20-33).htm" made by the "Экспорт истории" button.

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { parseChatLog } = require('./parser');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class LogWatcher extends EventEmitter {
  constructor({ dir, tab = 'Stats', since = Date.now(), intervalMs = 2000 }) {
    super();
    this.dir = dir;
    this.since = since;
    this.intervalMs = intervalMs;
    this.monthlyRe = new RegExp('^' + esc(tab) + ' \\(\\d{4}\\.\\d{2}\\)\\.htm$', 'i');
    this.exportRe = new RegExp('^' + esc(tab) + ' \\(\\d{4}\\.\\d{2}\\.\\d{2}\\s+\\d{2}-\\d{2}\\)\\.htm$', 'i');
    this.monthly = { name: null, offset: 0, events: [], end: null };
    this.exported = null;
    this.exportKey = null;
  }

  start() {
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop() { clearInterval(this.timer); }

  state() {
    return { monthly: this.monthly.end != null ? this.monthly : null, exported: this.exported };
  }

  poll() {
    let changed = false;
    try {
      if (!this.dir || !fs.existsSync(this.dir)) return;
      const files = fs.readdirSync(this.dir).map((name) => {
        try { return { name, st: fs.statSync(path.join(this.dir, name)) }; } catch { return null; }
      }).filter(Boolean);
      changed = this.pollMonthly(files) || changed;
      changed = this.pollExport(files) || changed;
    } catch (err) {
      this.emit('error', err);
    }
    if (changed) this.emit('update', this.state());
  }

  pollMonthly(files) {
    const f = files.filter((x) => this.monthlyRe.test(x.name)).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)[0];
    if (!f) return false;
    const m = this.monthly;
    if (m.name !== f.name || f.st.size < m.offset) {
      Object.assign(m, { name: f.name, offset: 0, events: [], end: null });
    }
    if (f.st.size === m.offset) return false;

    const fd = fs.openSync(path.join(this.dir, f.name), 'r');
    let buf;
    try {
      buf = Buffer.alloc(f.st.size - m.offset);
      fs.readSync(fd, buf, 0, buf.length, m.offset);
    } finally { fs.closeSync(fd); }
    const cut = buf.lastIndexOf(0x0a);
    if (cut < 0) return false; // wait until a full line is written
    m.offset += cut + 1;
    const events = parseChatLog(buf.subarray(0, cut + 1).toString('utf8'), f.name);
    if (!events.length) return false;
    m.end = Math.max(m.end ?? -Infinity, events[events.length - 1].time);
    for (const e of events) if (e.time >= this.since) m.events.push(e);
    return true;
  }

  pollExport(files) {
    const f = files.filter((x) => this.exportRe.test(x.name) && x.st.mtimeMs >= this.since)
      .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)[0];
    if (!f) return false;
    const key = f.name + '|' + f.st.size + '|' + f.st.mtimeMs;
    if (key === this.exportKey) return false;
    this.exportKey = key;
    const events = parseChatLog(fs.readFileSync(path.join(this.dir, f.name), 'utf8'), f.name);
    if (!events.length) return false;
    this.exported = {
      name: f.name,
      start: events[0].time,
      end: events[events.length - 1].time,
      events: events.filter((e) => e.time >= this.since),
    };
    return true;
  }
}

// Finds "...\Royal Quest Online\client_*\chatlogs" in the Steam libraries.
function findChatlogsDir() {
  const roots = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
  const libs = new Set(roots);
  for (const r of roots) {
    try {
      const vdf = fs.readFileSync(path.join(r, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
    } catch { /* no Steam here */ }
  }
  const candidates = [];
  for (const lib of libs) {
    const game = path.join(lib, 'steamapps', 'common', 'Royal Quest Online');
    let subs = [];
    try { subs = fs.readdirSync(game).filter((n) => /^client_/i.test(n)); } catch { continue; }
    for (const sub of subs) {
      const client = path.join(game, sub);
      const logs = path.join(client, 'chatlogs');
      let score = 0;
      try { score = fs.statSync(logs).mtimeMs + 1e13; } catch {
        try { score = fs.statSync(path.join(client, 'config.txt')).mtimeMs; } catch { continue; }
      }
      candidates.push({ logs, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].logs : null;
}

module.exports = { LogWatcher, findChatlogsDir };
