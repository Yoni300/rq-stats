const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');
const { ScreenTracker } = require('./src/screen-tracker');
const { LogWatcher, findChatlogsDir } = require('./src/log-watcher');
const { mergeSources, exactUntil } = require('./src/merge');
const { computeStats } = require('./src/stats');

if (!app.requestSingleInstanceLock()) app.quit();

const OVERLAY_W = 410;
const OVERLAY_H = 760;

// ---------- settings ----------
const configPath = () => path.join(app.getPath('userData'), 'config.json');
let config = {};
function loadConfig() {
  try { config = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { config = {}; }
  config.tab = config.tab || 'Stats';
}
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch (err) { console.error('config save failed', err); }
}

// ---------- session state ----------
const appStart = Date.now();
let sessionStart = appStart;
let screenEvents = [];
let tracker = new ScreenTracker();
let files = { monthly: null, exported: null };
const status = { screen: 'starting', error: '', lastFrameAt: 0, lastEventAt: 0, chatlogsDir: '' };

let overlay = null;
let calib = null;
let ocr = null;
let ocrStopping = false;
let watcher = null;
let dragFrom = null;

// ---------- screen reading ----------
// Keeps a small text log of what was read from the screen, to check counting against the chat.
function logScreen(frame, evs) {
  if (!evs.length && !frame.lines.some((l) => /золот/i.test(l.text))) return;
  const file = path.join(app.getPath('userData'), 'screen-log.txt');
  const t = new Date(frame.t).toTimeString().slice(0, 8);
  let out = '';
  for (const l of frame.lines) if (/золот/i.test(l.text)) out += `${t} seen: ${l.text}\n`;
  for (const e of evs) out += `${t} NEW ${e.type}: ${e.text}\n`;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 2_000_000) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, out);
  } catch { /* logging is optional */ }
}

function stopOcr() {
  if (!ocr) return;
  ocrStopping = true;
  try { ocr.kill(); } catch { /* already gone */ }
  ocr = null;
}

function startOcr() {
  stopOcr();
  const r = config.region;
  if (!r || r.w < 20 || r.h < 20) { status.screen = 'no-region'; return; }
  ocrStopping = false;
  status.screen = 'starting';
  status.error = '';
  const script = path.join(__dirname, 'ocr', 'ocr-helper.ps1');
  const proc = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-X', String(r.x), '-Y', String(r.y), '-W', String(r.w), '-H', String(r.h),
    '-IntervalMs', '250', '-ParentPid', String(process.pid),
  ], { windowsHide: true });
  ocr = proc;
  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line.replace(/^﻿/, '')); } catch { return; }
    if (msg.type === 'ready') status.screen = 'ok';
    if (msg.type === 'error') { status.screen = 'error'; status.error = msg.code || msg.message || ''; }
    if (msg.type === 'frame') {
      status.screen = 'ok';
      status.lastFrameAt = Date.now();
      const evs = tracker.push(msg);
      logScreen(msg, evs);
      if (evs.length) {
        status.lastEventAt = Date.now();
        screenEvents.push(...evs);
        pushSnapshot();
      }
    }
  });
  proc.stderr.on('data', (d) => console.error('[ocr]', d.toString()));
  proc.on('exit', () => {
    if (ocr === proc) ocr = null;
    if (!ocrStopping) {
      status.screen = 'error';
      setTimeout(() => { if (!ocr && !ocrStopping) startOcr(); }, 3000);
    }
  });
}

// ---------- chat files ----------
function startWatcher() {
  const dir = config.chatlogsDir || findChatlogsDir();
  status.chatlogsDir = dir || '';
  if (!dir) return;
  watcher = new LogWatcher({ dir, tab: config.tab, since: appStart - 60_000 });
  watcher.on('update', (s) => { files = s; pushSnapshot(); });
  watcher.on('error', (err) => console.error('[logs]', err.message));
  watcher.start();
}

// ---------- snapshot to the overlay ----------
function pushSnapshot() {
  if (!overlay || overlay.isDestroyed()) return;
  const now = Date.now();
  screenEvents = screenEvents.filter((e) => e.time >= sessionStart);
  const events = mergeSources({ ...files, screen: screenEvents, start: sessionStart });
  const snap = computeStats(events, sessionStart, now);
  const exact = exactUntil(files);
  snap.status = {
    screen: status.screen,
    error: status.error,
    reading: now - status.lastFrameAt < 5000,
    lastEventAt: status.lastEventAt,
    exactUntil: exact && exact >= sessionStart ? exact : null,
    chatlogsFound: !!status.chatlogsDir,
    tab: config.tab,
  };
  overlay.webContents.send('snapshot', snap);
}

// ---------- windows ----------
function createOverlay() {
  const wa = screen.getPrimaryDisplay().workArea;
  const pos = config.overlayPos || { x: wa.x + wa.width - OVERLAY_W - 20, y: wa.y + 80 };
  overlay = new BrowserWindow({
    x: pos.x, y: pos.y, width: OVERLAY_W, height: OVERLAY_H,
    frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: true, show: false,
    title: 'RQ Stats',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'overlay', 'index.html'));
  overlay.once('ready-to-show', () => { overlay.showInactive(); pushSnapshot(); });
  overlay.on('closed', () => { overlay = null; });
}

function openCalibration() {
  if (calib) { calib.focus(); return; }
  const d = screen.getPrimaryDisplay();
  calib = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
    alwaysOnTop: true, fullscreenable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  calib.setAlwaysOnTop(true, 'screen-saver');
  calib.loadFile(path.join(__dirname, 'overlay', 'calibrate.html'));
  calib.once('ready-to-show', () => {
    let current = null;
    if (config.region) {
      const r = screen.screenToDipRect(null, { x: config.region.x, y: config.region.y, width: config.region.w, height: config.region.h });
      current = { x: r.x - d.bounds.x, y: r.y - d.bounds.y, w: r.width, h: r.height };
    }
    calib.webContents.send('calib:init', { current });
    calib.show();
    calib.focus();
  });
  calib.on('closed', () => { calib = null; });
}

// ---------- messages from the pages ----------
ipcMain.on('overlay:interactive', (_e, on) => {
  if (overlay && !dragFrom) overlay.setIgnoreMouseEvents(!on, { forward: true });
});
ipcMain.on('overlay:drag-start', () => {
  if (!overlay) return;
  const [x, y] = overlay.getPosition();
  dragFrom = { x, y };
});
ipcMain.on('overlay:drag', (_e, dx, dy) => {
  if (overlay && dragFrom) overlay.setBounds({ x: Math.round(dragFrom.x + dx), y: Math.round(dragFrom.y + dy), width: OVERLAY_W, height: OVERLAY_H });
});
ipcMain.on('overlay:drag-end', () => {
  if (!overlay) return;
  dragFrom = null;
  const [x, y] = overlay.getPosition();
  config.overlayPos = { x, y };
  saveConfig();
});
ipcMain.on('overlay:action', (_e, name) => {
  if (name === 'reset') {
    sessionStart = Date.now();
    screenEvents = [];
    pushSnapshot();
  } else if (name === 'calibrate') {
    openCalibration();
  } else if (name === 'quit') {
    app.quit();
  }
});
ipcMain.on('calib:done', (_e, r) => {
  const d = screen.getPrimaryDisplay();
  const phys = screen.dipToScreenRect(null, { x: d.bounds.x + r.x, y: d.bounds.y + r.y, width: r.w, height: r.h });
  config.region = { x: phys.x, y: phys.y, w: phys.width, h: phys.height };
  tracker = new ScreenTracker();
  saveConfig();
  if (calib) calib.close();
  startOcr();
  pushSnapshot();
});
ipcMain.on('calib:cancel', () => { if (calib) calib.close(); });

// ---------- app ----------
app.whenReady().then(() => {
  loadConfig();
  createOverlay();
  startWatcher();
  startOcr();
  setInterval(pushSnapshot, 1000);
  globalShortcut.register('Alt+Shift+S', () => {
    if (!overlay) return;
    if (overlay.isVisible()) overlay.hide(); else overlay.showInactive();
  });
  globalShortcut.register('Alt+Shift+R', openCalibration);
  if (!config.region) setTimeout(openCalibration, 800);
});

app.on('second-instance', () => { if (overlay) overlay.showInactive(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); stopOcr(); if (watcher) watcher.stop(); });
app.on('window-all-closed', () => app.quit());
