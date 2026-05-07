/**
 * ============================================================
 * CONFIG — Centralized Environment & App Constants
 * ============================================================
 * All environment variables are loaded here.
 * Never access process.env directly outside this file.
 * ============================================================
 */

// ─── Helper: get env variable safely ─────────────────────────
const getEnv = (key, fallback = null) => {
  const value = process.env[key] || fallback;
  if (!value && !fallback) {
    console.warn(`⚠️  Missing environment variable: ${key}`);
  }
  return value;
};

// ─── App Config ───────────────────────────────────────────────
const config = {
  // ── WhatsApp (e.g. Twilio / Ultramsg / WaAPI) ─────────────
  whatsapp: {
    provider: getEnv("WHATSAPP_PROVIDER", "ultramsg"), // "ultramsg" | "twilio" | "waapi"
    instanceId: getEnv("WHATSAPP_INSTANCE_ID"),
    token: getEnv("WHATSAPP_TOKEN"),
    apiUrl: getEnv("WHATSAPP_API_URL", "https://api.ultramsg.com"),
    fromNumber: getEnv("WHATSAPP_FROM_NUMBER"), // used for Twilio
  },

  // ── Nazmly Webhook Security ───────────────────────────────
  nazmly: {
    webhookSecret: getEnv("NAZMLY_WEBHOOK_SECRET"),
    verifySignature: getEnv("NAZMLY_VERIFY_SIGNATURE", "true") === "true",
  },

  // ── Business Rules ─────────────────────────────────────────
  automation: {
    cartAbandonmentHours: parseInt(getEnv("CART_ABANDONMENT_HOURS", "1")),
    feedbackDelayDays: parseInt(getEnv("FEEDBACK_DELAY_DAYS", "2")),
  },

  // ── Product Info ───────────────────────────────────────────
  product: {
    name: getEnv("PRODUCT_NAME", "Vision"),
    communityLink: getEnv("COMMUNITY_INVITE_LINK"),
  },

  // ── App ────────────────────────────────────────────────────
  app: {
    env: getEnv("NODE_ENV", "development"),
    isProduction: getEnv("NODE_ENV") === "production",
    logLevel: getEnv("LOG_LEVEL", "info"),
  },
};

module.exports = config;
