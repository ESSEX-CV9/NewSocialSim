import { buildApp } from './app.js';
import { config } from './config.js';
import { WorldManager } from './core/world/world-manager.js';

const worldManager = new WorldManager(config.worldsDir, config.stateFile);
worldManager.init();

const app = buildApp({ worldManager });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`收到 ${signal}，正在关闭…`);
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
