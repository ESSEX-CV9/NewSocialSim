import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const dataDir = process.env.SOCIALSIM_DATA_DIR ?? path.join(repoRoot, 'data');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: '127.0.0.1',
  dataDir,
  worldsDir: path.join(dataDir, 'worlds'),
  /** 记录活动世界 id 等跨世界的服务器状态 */
  stateFile: path.join(dataDir, 'state.json'),
  /** JWT 签名密钥文件（首次启动自动生成） */
  jwtSecretFile: path.join(dataDir, 'jwt.secret'),
} as const;
