import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { loadOrCreateJwtSecret } from '../src/core/auth/jwt-secret.js';
import { SseHub } from '../src/core/events/sse-hub.js';
import { WorldManager } from '../src/core/world/world-manager.js';

/** 把社交站 OpenAPI 文档快照写到 docs/openapi/server.{json,yaml}，供离线查阅与 codegen。
 *  不监听端口（不与 dev:server 抢端口），构建 app→ready→取 app.swagger()→落盘。 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(scriptDir, '..', '..', 'docs', 'openapi');

const worldManager = new WorldManager(config.worldsDir, config.stateFile);
worldManager.init();
const sseHub = new SseHub();

const app = await buildApp({ worldManager, sseHub, jwtSecret: loadOrCreateJwtSecret(config.jwtSecretFile) });

await app.ready();

const doc = app.swagger();
const yaml = app.swagger({ yaml: true }) as unknown as string;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'server.json'), `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
writeFileSync(join(outDir, 'server.yaml'), yaml, 'utf-8');

const pathCount = Object.keys((doc as { paths?: Record<string, unknown> }).paths ?? {}).length;
console.log(`OpenAPI 快照已写入 ${outDir}（server.json / server.yaml），共 ${pathCount} 个路径`);

await app.close();
worldManager.shutdown();
process.exit(0);
