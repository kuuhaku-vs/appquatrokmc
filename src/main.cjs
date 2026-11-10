'use strict';
// =========================================================
// BUSCA DE MC — Grupo Quatro K (aplicativo independente)
// =========================================================
// Extraído do módulo "Busca de MC" do NØVA. O motor de consulta roda dentro
// do próprio aplicativo (mc-core.cjs): não há Python, FastAPI nem porta 8000.

const { app, BrowserWindow, ipcMain, shell, dialog, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { criarMotor } = require('./mc-core.cjs');

const CONFIG_PADRAO = { protheus: { url: '', usuario: '', senha: '' }, atualizarMinutos: 30 };

const APP_ID = 'br.com.quatrok.buscamc';

let DATA;
let win = null;
let motor = null;

// Pasta de dados ao lado do .exe (portátil, sem precisar de administrador)
function resolveDataDir() {
  const candidate = app.isPackaged || !process.defaultApp
    ? path.join(path.dirname(process.execPath), 'dados')
    : path.join(__dirname, 'dados');
  try {
    fs.mkdirSync(candidate, { recursive: true });
    fs.accessSync(candidate, fs.constants.W_OK);
    return candidate;
  } catch {
    const fallback = path.join(app.getPath('documents'), 'Busca MC Quatro K');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}
const f = (n) => path.join(DATA, n);

function log(...args) {
  try {
    const file = path.join(DATA || app.getPath('userData'), 'busca_mc.log');
    try { if (fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.old'); } catch {}
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${args.join(' ')}\n`, 'utf8');
  } catch {}
}

function getConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(f('config.json'), 'utf8').replace(/^﻿/, ''));
    return { ...CONFIG_PADRAO, ...cfg, protheus: { ...CONFIG_PADRAO.protheus, ...(cfg.protheus || {}) } };
  } catch (e) {
    if (e.code === 'ENOENT') {
      try { fs.writeFileSync(f('config.json'), JSON.stringify(CONFIG_PADRAO, null, 2), 'utf8'); } catch {}
    } else {
      log('config.json inválido:', e.message);
    }
    return CONFIG_PADRAO;
  }
}

// ---------- atalho na Área de Trabalho ----------
// Cria "Busca de MC — Quatro K.lnk" na Área de Trabalho do usuário atual (não exige administrador).
// É feito uma vez; se a pasta do app mudar de lugar o atalho é corrigido. Se o usuário
// apagar o atalho, ele não é recriado.
function garantirAtalho() {
  if (process.platform !== 'win32') return;
  try {
    const exe = process.execPath;
    const marca = f('atalho.json');
    let anterior = null;
    try { anterior = JSON.parse(fs.readFileSync(marca, 'utf8')); } catch {}
    if (anterior && anterior.exe === exe) return;
    const lnk = path.join(app.getPath('desktop'), 'Busca de MC — Quatro K.lnk');
    const ok = shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', {
      target: exe,
      cwd: path.dirname(exe),
      description: 'Busca de MC - Grupo Quatro K',
      icon: path.join(__dirname, 'icon.ico'),
      iconIndex: 0,
      appUserModelId: APP_ID,
    });
    log(ok ? 'Atalho criado na Área de Trabalho: ' + lnk : 'Não foi possível criar o atalho na Área de Trabalho.');
    if (ok) fs.writeFileSync(marca, JSON.stringify({ exe, atalho: lnk, criadoEm: new Date().toISOString() }, null, 2), 'utf8');
  } catch (e) { log('Falha ao criar atalho:', e.message || e); }
}

// ---------- janela ----------
const statePath = () => f('window-state.json');
function readWindowState() {
  const fallback = { width: 1440, height: 900, maximized: true };
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    const area = screen.getPrimaryDisplay().workArea;
    const state = {
      width: Math.min(Math.max(Number(s.width) || fallback.width, 900), area.width),
      height: Math.min(Math.max(Number(s.height) || fallback.height, 620), area.height),
      maximized: s.maximized !== false,
    };
    if (Number.isInteger(s.x) && Number.isInteger(s.y)) { state.x = s.x; state.y = s.y; }
    return state;
  } catch { return fallback; }
}
function saveWindowState() {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(statePath(), JSON.stringify({ ...b, maximized: win.isMaximized() }, null, 2), 'utf8');
  } catch {}
}

function createWindow() {
  const state = readWindowState();
  const options = {
    show: false,
    width: state.width, height: state.height,
    minWidth: 900, minHeight: 620,
    backgroundColor: '#eef6ff', title: 'Busca de MC · Grupo Quatro K',
    autoHideMenuBar: true,
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  };
  if (state.x !== undefined) { options.x = state.x; options.y = state.y; }
  win = new BrowserWindow(options);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    win.show();
    win.focus();
  });
  ['resize', 'move', 'maximize', 'unmaximize', 'close'].forEach((ev) => win.on(ev, saveWindowState));
  win.on('closed', () => { win = null; });
  // Links externos nunca abrem dentro do aplicativo.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ---------- ciclo de vida ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });

  // Identidade própria na barra de tarefas (ícone e agrupamento separados do NØVA).
  app.setAppUserModelId(APP_ID);

  app.whenReady().then(() => {
    try {
      DATA = resolveDataDir();
      getConfig(); // cria config.json se não existir
      motor = criarMotor({
        cacheFile: f('produtos_cache.json'),
        seedFile: path.join(__dirname, 'produtos_cache.json'), // opcional: base inicial, se existir
        getConfig,
        log,
      });
      createWindow();
      setTimeout(garantirAtalho, 1500);
      // Carrega o cache depois que a janela já foi criada, para a splash aparecer logo.
      setImmediate(() => { try { motor.iniciar(); } catch (e) { log('Falha ao iniciar motor:', e.stack || e); } });
    } catch (err) {
      const details = String((err && (err.stack || err.message)) || err);
      log('FALHA AO INICIAR', details);
      dialog.showErrorBox('Busca de MC - erro ao iniciar', details);
      app.quit();
    }
  });

  app.on('before-quit', () => { try { motor?.parar(); } catch {} });
  app.on('window-all-closed', () => app.quit());
}

// ---------- IPC ----------
ipcMain.handle('mc:status', () => motor.status());
ipcMain.handle('mc:buscar', (_e, codigo) => motor.buscarMc(codigo));
ipcMain.handle('mc:buscaInteligente', (_e, termo) => motor.buscaInteligente(termo));
ipcMain.handle('mc:recarregar', async () => {
  const r = await motor.atualizarCache();
  return { ...r, ...motor.status() };
});
ipcMain.handle('mc:copiar', (_e, texto) => {
  const valor = String(texto || '').trim();
  if (!valor) return { ok: false };
  clipboard.writeText(valor);
  return { ok: true };
});
ipcMain.handle('dados:abrir', () => shell.openPath(DATA));
