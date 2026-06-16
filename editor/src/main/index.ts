import { join } from 'node:path';
import { app, BrowserWindow, utilityProcess, type UtilityProcess } from 'electron';

/** 编辑器后端端口（基础设施配置，与具体世界无关）。 */
const EDITOR_BACKEND_PORT = Number(process.env.EDITOR_BACKEND_PORT ?? 5176);

let backend: UtilityProcess | null = null;

/** main 进程拉起编辑器后端为子进程，并管其生命周期；后端是 renderer 的唯一数据源。 */
function startBackend(): void {
  const entry = join(__dirname, 'server.js');
  backend = utilityProcess.fork(entry, [], {
    env: { ...process.env, EDITOR_BACKEND_PORT: String(EDITOR_BACKEND_PORT) },
  });
  backend.on('exit', (code) => {
    console.error(`[editor-backend] exited with code ${code}`);
    backend = null;
  });
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  backend?.kill();
});
