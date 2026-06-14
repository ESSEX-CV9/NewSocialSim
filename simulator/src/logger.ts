const timestamp = () => new Date().toISOString().slice(11, 19);

export const logger = {
  info: (...args: unknown[]) => console.log(`[${timestamp()}] [SIM]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${timestamp()}] [SIM]`, ...args),
  error: (...args: unknown[]) => console.error(`[${timestamp()}] [SIM]`, ...args),
};
