/**
 * ============================================================
 * LOGGER — Structured Logging Utility
 * ============================================================
 * Wraps console methods with structured output.
 * In production, logs are sent to Firebase Cloud Logging.
 * ============================================================
 */

const config = require("../config");

// ─── Log Levels ───────────────────────────────────────────────
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[config.app.logLevel] ?? LEVELS.info;

// ─── Format log entry ─────────────────────────────────────────
const format = (level, context, message, data = {}) => ({
  timestamp: new Date().toISOString(),
  level,
  context,      // e.g. "CartScheduler", "WhatsAppService"
  message,
  ...data,
  env: config.app.env,
});

// ─── Logger Factory ───────────────────────────────────────────
const createLogger = (context) => ({
  debug: (message, data) => {
    if (currentLevel <= LEVELS.debug) {
      console.debug(JSON.stringify(format("DEBUG", context, message, data)));
    }
  },
  info: (message, data) => {
    if (currentLevel <= LEVELS.info) {
      console.info(JSON.stringify(format("INFO", context, message, data)));
    }
  },
  warn: (message, data) => {
    if (currentLevel <= LEVELS.warn) {
      console.warn(JSON.stringify(format("WARN", context, message, data)));
    }
  },
  error: (message, error, data = {}) => {
    if (currentLevel <= LEVELS.error) {
      const errorData = error instanceof Error
        ? { errorMessage: error.message, stack: error.stack }
        : { error };
      console.error(
        JSON.stringify(format("ERROR", context, message, { ...errorData, ...data }))
      );
    }
  },
});

module.exports = { createLogger };
