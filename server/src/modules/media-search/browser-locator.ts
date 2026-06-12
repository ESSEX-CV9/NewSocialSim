import fs from 'node:fs';
import path from 'node:path';

/** 探测本机已装的 Chromium 系浏览器可执行文件（Chrome 优先，Edge 在 Windows 上必有） */
export function locateBrowser(): string | null {
  const candidates: string[] = [];
  const roots = [
    process.env['LOCALAPPDATA'],
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
  ].filter((p): p is string => !!p);

  for (const root of roots) {
    candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  for (const root of roots) {
    candidates.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
