/**
 * ============================================================
 * ANALYTICS SERVICE — Lead Funnel & Business Metrics
 * ============================================================
 * Tracks conversion rates, message delivery, and funnel health.
 * Writes daily snapshots to Firestore for dashboard use.
 * ============================================================
 */

const admin = require("firebase-admin");
const { createLogger } = require("../utils/logger");
const firestoreService = require("./firestoreService");

const logger = createLogger("AnalyticsService");
const db = admin.firestore();

/**
 * Saves a daily analytics snapshot.
 * Call this from a scheduled function (e.g. daily at midnight).
 */
const saveDailySnapshot = async () => {
  const stats = await firestoreService.getLeadStats();
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  const conversionRate =
    stats.paid > 0
      ? ((stats.paid / (stats.paid + stats.abandoned + stats.cart)) * 100).toFixed(2)
      : "0.00";

  const snapshot = {
    date: today,
    ...stats,
    conversionRate: parseFloat(conversionRate),
    savedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("analytics_snapshots").doc(today).set(snapshot);
  logger.info("Daily analytics snapshot saved", snapshot);

  return snapshot;
};

/**
 * Extracts UTM params and device info from a webhook payload.
 * Use this when saving the lead to enrich analytics.
 */
const extractAnalyticsData = (payload) => ({
  utm_source: payload.utm_source || null,
  utm_medium: payload.utm_medium || null,
  utm_campaign: payload.utm_campaign || null,
  device: payload.device || null,
  referrer: payload.referrer || null,
  ip: payload.ip || null,
});

module.exports = {
  saveDailySnapshot,
  extractAnalyticsData,
};
