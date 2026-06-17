import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEditorApp } from '../src/server/app.js';

/** 把编辑器后端 OpenAPI 文档快照写到 docs/openapi/editor.{json,yaml}。
 *  editor 工作区无 "type":"module"，tsx 按 CJS 转译 → 不能用顶层 await，故包一层 async IIFE。 */

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(scriptDir, '..', '..', 'docs', 'openapi');

  const app = await buildEditorApp();
  await app.ready();

  const doc = app.swagger();
  const yaml = app.swagger({ yaml: true }) as unknown as string;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'editor.json'), `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  writeFileSync(join(outDir, 'editor.yaml'), yaml, 'utf-8');

  const pathCount = Object.keys((doc as { paths?: Record<string, unknown> }).paths ?? {}).length;
  console.log(`编辑器后端 OpenAPI 快照已写入 ${outDir}（editor.json / editor.yaml），共 ${pathCount} 个路径`);

  await app.close();
  process.exit(0);
}

void main();
