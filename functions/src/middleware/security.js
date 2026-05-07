/**
 * ============================================================
 * MIDDLEWARE — Webhook Security & Request Validation
 * ============================================================
 */

const crypto = require("crypto");
const config = require("../config");
const { createLogger } = require("../utils/logger");

const logger = createLogger("SecurityMiddleware");

/**
 * Verifies Nazmly webhook HMAC signature.
 * Nazmly sends X-Nazmly-Signature header with HMAC-SHA256.
 *
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - next middleware
 */
const verifyNazmlySignature = (req, res, next) => {
  // Skip verification in development or if disabled
  if (!config.nazmly.verifySignature || config.app.env === "development") {
    logger.warn("Signature verification SKIPPED", { env: config.app.env });
    return next();
  }

  const signature = req.headers["x-nazmly-signature"];
  const secret = config.nazmly.webhookSecret;

  if (!signature) {
    logger.warn("Missing webhook signature header");
    return res.status(401).json({ error: "Missing signature" });
  }

  if (!secret) {
    logger.error("NAZMLY_WEBHOOK_SECRET is not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // Raw body must be preserved — see functions/src/index.js for rawBody middleware
  const rawBody = req.rawBody;
  if (!rawBody) {
    logger.warn("Raw body not available for signature check");
    return res.status(400).json({ error: "Invalid request body" });
  }

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const trusted = crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expectedSig, "hex")
  );

  if (!trusted) {
    logger.warn("Invalid webhook signature — request rejected", {
      receivedSig: signature,
    });
    return res.status(401).json({ error: "Invalid signature" });
  }

  logger.info("Webhook signature verified ✓");
  next();
};

/**
 * Rate limiter using in-memory store (upgrade to Redis in production).
 * Limits: 100 requests per 10 minutes per IP.
 */
const ipRequests = new Map();
const RATE_LIMIT = 100;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const rateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();

  if (!ipRequests.has(ip)) {
    ipRequests.set(ip, { count: 1, windowStart: now });
    return next();
  }

  const record = ipRequests.get(ip);

  if (now - record.windowStart > WINDOW_MS) {
    ipRequests.set(ip, { count: 1, windowStart: now });
    return next();
  }

  record.count++;
  if (record.count > RATE_LIMIT) {
    logger.warn("Rate limit exceeded", { ip });
    return res.status(429).json({ error: "Too many requests" });
  }

  next();
};

module.exports = { verifyNazmlySignature, rateLimiter };
