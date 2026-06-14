import fs from 'node:fs';
import path from 'node:path';
import type { WorldManager } from '../../core/world/world-manager.js';
import { NotFoundError, ValidationError } from '../../core/errors/app-error.js';

export interface LoreFile {
  filename: string;
  summary: string;
  sizeBytes: number;
}

export interface LoreIndex {
  files: LoreFile[];
}

export class LoreService {
  constructor(private readonly worldManager: WorldManager) {}

  private loreDir(): string {
    const ctx = this.worldManager.current();
    const dir = path.join(this.worldManager.getWorldDir(ctx.worldId), 'lore');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  list(): LoreIndex {
    const dir = this.loreDir();
    const entries = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    const files: LoreFile[] = entries.map(filename => {
      const content = fs.readFileSync(path.join(dir, filename), 'utf-8').replace(/^﻿/, '');
      return {
        filename,
        summary: this.extractSummary(content),
        sizeBytes: Buffer.byteLength(content, 'utf-8'),
      };
    });
    return { files };
  }

  read(filename: string): { filename: string; content: string } {
    this.validateFilename(filename);
    const filePath = path.join(this.loreDir(), filename);
    if (!fs.existsSync(filePath)) throw new NotFoundError(`Lore file "${filename}" not found`);
    const content = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
    return { filename, content };
  }

  write(filename: string, content: string): void {
    this.validateFilename(filename);
    fs.writeFileSync(path.join(this.loreDir(), filename), content, 'utf-8');
  }

  remove(filename: string): void {
    this.validateFilename(filename);
    const filePath = path.join(this.loreDir(), filename);
    if (!fs.existsSync(filePath)) throw new NotFoundError(`Lore file "${filename}" not found`);
    fs.unlinkSync(filePath);
  }

  private validateFilename(filename: string): void {
    if (!filename.endsWith('.md')) throw new ValidationError('Lore files must be .md');
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new ValidationError('Invalid filename');
    }
  }

  private extractSummary(content: string): string {
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const fm = frontmatterMatch[1]!;
      const descMatch = fm.match(/(?:summary|description):\s*(.+)/i);
      if (descMatch) return descMatch[1]!.trim();
    }
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
    return lines[0]?.trim().slice(0, 200) ?? '';
  }
}
