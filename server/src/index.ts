import { buildApp } from './app.js';
import { config } from './config.js';
import { loadOrCreateJwtSecret } from './core/auth/jwt-secret.js';
import { SseHub } from './core/events/sse-hub.js';
import { WorldManager } from './core/world/world-manager.js';

const worldManager = new WorldManager(config.worldsDir, config.stateFile);
worldManager.init();

const sseHub = new SseHub();
// 热切换后旧世界 token 全部失效，SSE 长连接同步清场（重连会被 401）
worldManager.onActivated(() => sseHub.closeAll());

const app = buildApp({ worldManager, sseHub, jwtSecret: loadOrCreateJwtSecret(config.jwtSecretFile) });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`收到 ${signal}，正在关闭…`);
  sseHub.closeAll();
  await app.close();
  worldManager.shutdown();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  worldManager.shutdown();
  process.exit(1);
}
