import { Simulator } from './simulator.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

async function main() {
  const config = loadConfig(process.argv[2]);
  const sim = new Simulator(config);
  sim.start();

  const shutdown = () => {
    logger.info('Shutting down...');
    sim.stop();
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
