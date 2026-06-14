import fs from 'node:fs';
import path from 'node:path';
import type { WorldManager } from '../../core/world/world-manager.js';
import { NotFoundError, ValidationError, ConflictError } from '../../core/errors/app-error.js';

export interface NpcProfile {
  userId: number;
  handle: string;
  tier: 'core' | 'ambient';
  personality: string | undefined;
  stance: string | undefined;
  writingStyle: string | undefined;
  interests: string[];
  activeHoursStart: number;
  activeHoursEnd: number;
  postProbability: number;
  likeProbability: number;
  repostProbability: number;
  replyProbability: number;
  actionIntervalMinutes: number;
}

interface NpcProfilesFile {
  profiles: NpcProfile[];
}

export class NpcService {
  constructor(private readonly worldManager: WorldManager) {}

  private profilesPath(): string {
    const ctx = this.worldManager.current();
    return path.join(this.worldManager.getWorldDir(ctx.worldId), 'npc-profiles.json');
  }

  private readAll(): NpcProfile[] {
    const filePath = this.profilesPath();
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
    return (JSON.parse(raw) as NpcProfilesFile).profiles;
  }

  private writeAll(profiles: NpcProfile[]): void {
    const data: NpcProfilesFile = { profiles };
    fs.writeFileSync(this.profilesPath(), JSON.stringify(data, null, 2), 'utf-8');
  }

  list(): NpcProfile[] {
    return this.readAll();
  }

  get(userId: number): NpcProfile {
    const profiles = this.readAll();
    const profile = profiles.find(p => p.userId === userId);
    if (!profile) throw new NotFoundError(`NPC profile for user ${userId} not found`);
    return profile;
  }

  upsert(input: NpcProfile): NpcProfile {
    const { db } = this.worldManager.current();
    const user = db.prepare('SELECT id, handle FROM users WHERE id = ?').get(input.userId) as { id: number; handle: string } | undefined;
    if (!user) throw new NotFoundError(`User ${input.userId} not found`);

    const profiles = this.readAll();
    const idx = profiles.findIndex(p => p.userId === input.userId);
    const profile: NpcProfile = {
      userId: input.userId,
      handle: user.handle,
      tier: input.tier ?? 'ambient',
      personality: input.personality,
      stance: input.stance,
      writingStyle: input.writingStyle,
      interests: input.interests ?? [],
      activeHoursStart: input.activeHoursStart ?? 0,
      activeHoursEnd: input.activeHoursEnd ?? 24,
      postProbability: input.postProbability ?? 0.15,
      likeProbability: input.likeProbability ?? 0.5,
      repostProbability: input.repostProbability ?? 0.1,
      replyProbability: input.replyProbability ?? 0.05,
      actionIntervalMinutes: input.actionIntervalMinutes ?? 60,
    };

    if (idx >= 0) {
      profiles[idx] = profile;
    } else {
      profiles.push(profile);
    }
    this.writeAll(profiles);
    return profile;
  }

  remove(userId: number): void {
    const profiles = this.readAll();
    const idx = profiles.findIndex(p => p.userId === userId);
    if (idx < 0) throw new NotFoundError(`NPC profile for user ${userId} not found`);
    profiles.splice(idx, 1);
    this.writeAll(profiles);
  }
}
