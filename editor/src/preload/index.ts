import { contextBridge } from 'electron';

const EDITOR_BACKEND_PORT = Number(process.env.EDITOR_BACKEND_PORT ?? 5176);

/** renderer 经 window.editor 拿到后端地址；renderer 只与编辑器后端通信，不直连社交站 server。 */
contextBridge.exposeInMainWorld('editor', {
  backendUrl: `http://127.0.0.1:${EDITOR_BACKEND_PORT}`,
});
