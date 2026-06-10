import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * JWT 签名密钥：首次启动随机生成并落盘，之后复用，
 * 保证服务器重启后已签发的 token 仍然有效。
 */
export function loadOrCreateJwtSecret(file: string): string {
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8').trim();
  }
  const secret = randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, secret, 'utf8');
  return secret;
}
