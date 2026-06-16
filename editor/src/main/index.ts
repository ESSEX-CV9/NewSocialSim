import { join } from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { app, BrowserWindow, utilityProcess, type UtilityProcess } from 'electron';

/** 编辑器后端端口（基础设施配置，与具体世界无关）。 */
const EDITOR_BACKEND_PORT = Number(process.env.EDITOR_BACKEND_PORT ?? 5176);

let backend: UtilityProcess | null = null;
let backendWatcher: FSWatcher | null = null;
/** 标记主动重启，避免 kill 触发的 exit 被当成异常退出告警。 */
let restarting = false;

/** main 进程拉起编辑器后端为子进程，并管其生命周期；后端是 renderer 的唯一数据源。 */
function startBackend(): void {
  const entry = join(__dirname, 'server.js');
  backend = utilityProcess.fork(entry, [], {
    env: { ...process.env, EDITOR_BACKEND_PORT: String(EDITOR_BACKEND_PORT) },
  });
  backend.on('exit', (code) => {
    if (restarting) return; // 主动重启，静默
    console.error(`[editor-backend] exited with code ${code}`);
    backend = null;
  });
}

/** 重启后端子进程：杀旧、起新。供开发期热重载用。 */
function restartBackend(): void {
  restarting = true;
  try {
    backend?.kill();
  } catch {
    /* 子进程可能已死 */
  }
  backend = null;
  startBackend();
  restarting = false;
  console.log('[editor-backend] restarted (bundle changed)');
}

/**
 * 开发期热重载：electron-vite dev 改后端源码会重新打包 out/main/server.js，
 * 但已 fork 的子进程不会自动加载新 bundle。监听该文件变化即重启子进程，
 * 改后端代码不必手动重启 dev:editor。仅开发期（renderer 走 dev server）启用。
 */
function watchBackendForReload(): void {
  if (!process.env['ELECTRON_RENDERER_URL']) return; // 生产环境 bundle 静态，不监听
  const entry = join(__dirname, 'server.js');
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    backendWatcher = watch(entry, () => {
      // 防抖：一次构建可能触发多次 fs 事件。
      if (timer) clearTimeout(timer);
      timer = setTimeout(restartBackend, 200);
    });
  } catch (err) {
    console.error('[editor-backend] watch failed (hot reload disabled):', err);
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'SocialSim Studio',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  startBackend();
  watchBackendForReload();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  backendWatcher?.close();
  restarting = true;
  backend?.kill();
});
