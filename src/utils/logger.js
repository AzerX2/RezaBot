/**
 * Simple structured logger for RezaBot.
 */
export const logger = {
  info: (message, ...args) => {
    console.log(`[${new Date().toISOString()}] [INFO] ${message}`, ...args);
  },
  warn: (message, ...args) => {
    console.warn(`[${new Date().toISOString()}] [WARN] ${message}`, ...args);
  },
  error: (message, error) => {
    console.error(`[${new Date().toISOString()}] [ERROR] ${message}`, error || '');
  },
  debug: (message, ...args) => {
    if (process.env.DEBUG === 'true') {
      console.debug(`[${new Date().toISOString()}] [DEBUG] ${message}`, ...args);
    }
  }
};
