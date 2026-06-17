import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenerator } from 'ts-json-schema-generator';

/** 从 shared 的 TS 类型生成 OpenAPI 响应组件 schema（shared 类型为唯一真相源、零漂移）。
 *  产物 server/src/core/openapi/components.generated.json 是 { $id: schema } 映射，
 *  内部 $ref 已从 ts-json-schema-generator 的 `#/definitions/X` 改写为 Fastify 跨 schema 引用 `X#`，
 *  startup 时由 registerComponentSchemas 逐个 app.addSchema。 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const sharedEntry = resolve(repoRoot, 'shared', 'src', 'index.ts');
const sharedTsconfig = resolve(repoRoot, 'shared', 'tsconfig.json');
const outFile = resolve(scriptDir, '..', 'src', 'core', 'openapi', 'components.generated.json');

/** 要暴露为 OpenAPI 组件的根类型；各自的传递依赖（Post / User / VerifiedType 等）由生成器自动带入。
 *  以"接口出现在某响应体里"为收录标准。 */
const ROOTS = [
  // 帖 / 时间线 / 互动 / 通知
  'PostView', 'TimelineItem', 'InteractionEvent', 'NotificationView', 'TrendItem',
  'Post', 'MediaView', 'LinkCardView', 'UserSummary',
  // 账号
  'User', 'UserProfile', 'AuthResponse',
  // 世界
  'WorldMeta', 'WorldSummary', 'ActiveWorldInfo', 'ClockState',
  // 模拟器
  'SimulatorStatus', 'SimulatorHeartbeat',
  // 私信
  'ConversationView', 'ConversationDetailView', 'MessageView', 'MessageReactionView',
  'DmMessageMatch', 'DmSearchResults', 'DmUnreadCount', 'LastMessagePreview',
  // 决策轨迹（编辑器后端复用同类型）
  'SimTraceEvent', 'StoredSimTraceEvent', 'GmAgentLogEvent',
] as const;

const generator = createGenerator({
  path: sharedEntry,
  tsconfig: sharedTsconfig,
  skipTypeCheck: true,
  // topRef:true 让根类型本身也进 definitions（否则非递归根会被内联在返回顶层、漏收）
  topRef: true,
  expose: 'export',
});

/** 逐根生成并合并 definitions（含传递依赖），按类型名去重。 */
const defs: Record<string, unknown> = {};
for (const root of ROOTS) {
  const s = generator.createSchema(root) as { definitions?: Record<string, unknown> };
  for (const [name, def] of Object.entries(s.definitions ?? {})) {
    if (!(name in defs)) defs[name] = def;
  }
}

/** 递归处理每个 schema 节点：
 *  1) 把 `#/definitions/X` 形态的 $ref 改写为 Fastify 的 `X#`；
 *  2) 给每个对象 schema 补 `additionalProperties: true`——Fastify 用响应 schema 做序列化会过滤未声明字段，
 *     放行额外字段可保证文档化响应**绝不**悄悄丢掉运行时真实返回的字段。 */
function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node && typeof node === 'object') {
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (k === '$ref' && typeof v === 'string') {
        const m = v.match(/^#\/definitions\/(.+)$/);
        out[k] = m ? `${m[1]}#` : v;
      } else {
        out[k] = rewriteRefs(v);
      }
    }
    if ('properties' in src && out.additionalProperties === undefined) {
      out.additionalProperties = true;
    }
    return out;
  }
  return node;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const components: Record<string, unknown> = {};
const skipped: string[] = [];
for (const [name, def] of Object.entries(defs)) {
  if (!IDENT.test(name)) {
    skipped.push(name);
    continue;
  }
  components[name] = rewriteRefs(def);
}

writeFileSync(outFile, `${JSON.stringify(components, null, 2)}\n`, 'utf-8');
console.log(
  `组件 schema 已写入 ${outFile}：${Object.keys(components).length} 个` +
    (skipped.length ? `（跳过非标识符名 ${skipped.length} 个：${skipped.join(', ')}）` : ''),
);
