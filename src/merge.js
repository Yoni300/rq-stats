// Combines the three sources into one list of events for the current session.
//
// - monthly chat file: complete and exact, but the game writes it only every few minutes;
// - latest "Экспорт истории" file: exact, covers the time span it contains;
// - screen reading: live, used only for the time the files do not cover yet.

const SCREEN_PAD_MS = 1500; // screen lines are read a moment after they appear

function mergeSources({ monthly, exported, screen, start }) {
  const out = [];
  const covers = [];
  const covered = (t, pad = 0) => covers.some(([a, b]) => t >= a - pad && t <= b + pad);

  if (monthly && monthly.end != null) {
    for (const e of monthly.events) if (e.time >= start && e.time <= monthly.end) out.push(e);
    covers.push([-Infinity, monthly.end]);
  }
  if (exported && exported.end != null) {
    for (const e of exported.events) if (e.time >= start && !covered(e.time)) out.push(e);
    covers.push([exported.start, exported.end]);
  }
  for (const e of screen || []) {
    if (e.time >= start && !covered(e.time, SCREEN_PAD_MS)) out.push(e);
  }
  return out.sort((a, b) => a.time - b.time);
}

// Time up to which the session is backed by exact file data (or null).
function exactUntil({ monthly, exported }) {
  return Math.max(monthly?.end ?? -Infinity, exported?.end ?? -Infinity) || null;
}

module.exports = { mergeSources, exactUntil };
