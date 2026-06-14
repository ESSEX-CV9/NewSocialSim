import { ApiClient } from './api-client.js';
import { EntityRegistry } from './ecs/entity-registry.js';
import { PostingSystem } from './systems/posting-system.js';
import { InteractionSystem } from './systems/interaction-system.js';
import { TickEngine } from './tick-engine.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

async function main() {
  const configPath = process.argv[2];
  const config = loadConfig(configPath);

  logger.info(`Simulator starting (API: ${config.apiBaseUrl}, tick: ${config.tickIntervalMs}ms)`);
  logger.info(`Accounts to drive: ${config.accounts.map(a => a.handle).join(', ')}`);

  const api = new ApiClient({ baseUrl: config.apiBaseUrl });
  const registry = new EntityRegistry();

  for (const acct of config.accounts) {
    try {
      const { token, user } = await api.login(acct.handle, acct.password);
      const entity = registry.register(acct, user.id);
      entity.auth = { token, expiresAt: Date.now() + 3600_000 };
      entity.profile.displayName = user.displayName;
      logger.info(`Logged in as @${acct.handle} (id: ${user.id})`);
    } catch (err) {
      logger.error(`Failed to log in as @${acct.handle}:`, err);
    }
  }

  if (registry.count() === 0) {
    logger.error('No accounts logged in, exiting');
    process.exit(1);
  }

  const systems = [
    new PostingSystem(api, [...config.contentPool]),
    new InteractionSystem(api),
  ];

  const engine = new TickEngine(registry, systems, config.tickIntervalMs);
  engine.start();

  const shutdown = () => {
    logger.info('Shutting down...');
    engine.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Simulator running. Press Ctrl+C to stop.');
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
