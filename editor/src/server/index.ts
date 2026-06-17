import { DATA_DIR, PORT, SOCIAL_API, buildEditorApp } from './app.js';

/** 编辑器后端进程入口：electron main 以 utilityProcess fork 本文件的打包产物 server.js。
 *  组装逻辑全在 app.ts（buildEditorApp），此处只负责监听——便于 gen 脚本静态 import 而不触发监听。 */
buildEditorApp()
  .then((app) =>
    app
      .listen({ host: '127.0.0.1', port: PORT })
      .then(() =>
        console.log(`Editor backend on http://127.0.0.1:${PORT} (social API ${SOCIAL_API}, data ${DATA_DIR})`),
      ),
  )
  .catch((err) => {
    console.error('Editor backend failed to start:', err);
    process.exit(1);
  });
