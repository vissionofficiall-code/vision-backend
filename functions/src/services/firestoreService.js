/**
 * ============================================================
 * FIRESTORE SERVICE — All Database Operations
 * ============================================================
 * Centralizes every read/write to Firestore.
 * Never call admin.firestore() directly outside this file.
 * ============================================================
 *
 * SCHEMA:
 *
 * leads/{phone}
 * ├── name            : string
 * ├── phone           : string (normalized, e.g. +966501234567)
 * ├── email           : string | null
 * ├── product         : string
 * ├── status          : "cart" | "paid" | "abandoned"
 * ├── source          : string (UTM/referral)
 * ├── createdAt       : Timestamp
 * ├── updatedAt       : Timestamp
 * ├── cartAt          : Timestamp (when they entered checkout)
 * ├── paidAt          : Timestamp | null
 * ├── messageSent     : boolean (cart abandonment message sent)
 * ├── welcomeSent     : boolean
 * ├── feedbackSent    : boolean
 * ├── feedbackQueuedAt: Timestamp | null
 * └── analytics       : { utm_source, utm_medium, utm_campaign, device }
 *
 * ============================================================
 */

const admin = require("firebase-admin");
const { createLogger } = require("../utils/logger");

const logger = createLogger("FirestoreService");
const db = admin.firestore();

// ─── Collection References ────────────────────────────────────
const COLLECTIONS = {
  LEADS: "leads",
  EVENTS: "events",         // audit log of all actions
};

// ─── Timestamps ───────────────────────────────────────────────
const now = () => admin.firestore.FieldValue.serverTimestamp();
const fromDate = (date) => admin.firestore.Timestamp.fromDate(date);

// ─── Leads ────────────────────────────────────────────────────

/**
 * Creates or updates a lead when they enter checkout.
 * Uses phone as document ID for idempotency.
 */
const upsertCartLead = async (leadData) => {
  const { phone, name, email, product, source, analytics } = leadData;

  const ref = db.collection(COLLECTIONS.LEADS).doc(phone);
  const existing = await ref.get();

  if (existing.exists && existing.data().status === "paid") {
    logger.info("Lead already paid — skipping cart upsert", { phone });
    return { skipped: true, reason: "already_paid" };
  }

  const payload = {
    phone,
    name: name || existing.data()?.name || "Unknown",
    email: email || existing.data()?.email || null,
    product,
    status: "cart",
    source: source || "direct",
    analytics: analytics || {},
    cartAt: now(),
    updatedAt: now(),
    messageSent: false,
    welcomeSent: false,
    feedbackSent: false,
    feedbackQueuedAt: null,
  };

  if (!existing.exists) {
    payload.createdAt = now();
    payload.paidAt = null;
  }

  await ref.set(payload, { merge: true });
  logger.info("Cart lead upserted", { phone, product });

  await logEvent("cart_entered", phone, { product, source });

  return { success: true, phone };
};

/**
 * Marks a lead as paid after successful purchase.
 */
const markLeadAsPaid = async (phone, extraData = {}) => {
  const ref = db.collection(COLLECTIONS.LEADS).doc(phone);

  const feedbackAt = new Date();
  feedbackAt.setDate(feedbackAt.getDate() + 2); // +2 days

  await ref.set(
    {
      status: "paid",
      paidAt: now(),
      updatedAt: now(),
      feedbackQueuedAt: fromDate(feedbackAt),
      ...extraData,
    },
    { merge: true }
  );

  logger.info("Lead marked as paid", { phone });
  await logEvent("purchase_completed", phone, extraData);

  return { success: true };
};

/**
 * Fetches all leads that have been in cart > X hours
 * and have NOT yet received an abandonment message.
 */
const getAbandonedCarts = async (hoursThreshold = 1) => {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hoursThreshold);

  const snapshot = await db
    .collection(COLLECTIONS.LEADS)
    .where("status", "==", "cart")
    .where("messageSent", "==", false)
    .where("cartAt", "<=", fromDate(cutoff))
    .get();

  const leads = [];
  snapshot.forEach((doc) => leads.push({ id: doc.id, ...doc.data() }));

  logger.info(`Found ${leads.length} abandoned carts`, {
    hoursThreshold,
    cutoff: cutoff.toISOString(),
  });

  return leads;
};

/**
 * Marks that a cart abandonment message was sent.
 */
const markAbandonmentMessageSent = async (phone) => {
  await db.collection(COLLECTIONS.LEADS).doc(phone).update({
    messageSent: true,
    status: "abandoned",
    updatedAt: now(),
  });
  logger.info("Abandonment message marked as sent", { phone });
  await logEvent("abandonment_message_sent", phone, {});
};

/**
 * Marks welcome message as sent.
 */
const markWelcomeSent = async (phone) => {
  await db.collection(COLLECTIONS.LEADS).doc(phone).update({
    welcomeSent: true,
    updatedAt: now(),
  });
  await logEvent("welcome_message_sent", phone, {});
};

/**
 * Fetches leads whose feedback message is due (feedbackQueuedAt <= now)
 * and feedbackSent is still false.
 */
const getFeedbackQueue = async () => {
  const snapshot = await db
    .collection(COLLECTIONS.LEADS)
    .where("status", "==", "paid")
    .where("feedbackSent", "==", false)
    .where("feedbackQueuedAt", "<=", fromDate(new Date()))
    .get();

  const leads = [];
  snapshot.forEach((doc) => leads.push({ id: doc.id, ...doc.data() }));

  logger.info(`Found ${leads.length} leads in feedback queue`);
  return leads;
};

/**
 * Marks feedback message as sent.
 */
const markFeedbackSent = async (phone) => {
  await db.collection(COLLECTIONS.LEADS).doc(phone).update({
    feedbackSent: true,
    updatedAt: now(),
  });
  await logEvent("feedback_message_sent", phone, {});
};

// ─── Event Audit Log ─────────────────────────────────────────

/**
 * Logs every significant action to the events collection.
 * This powers analytics dashboards.
 */
const logEvent = async (eventType, phone, metadata = {}) => {
  try {
    await db.collection(COLLECTIONS.EVENTS).add({
      eventType,
      phone,
      metadata,
      createdAt: now(),
    });
  } catch (err) {
    // Never let audit logging crash the main flow
    logger.warn("Failed to log event", { eventType, phone, error: err.message });
  }
};

// ─── Analytics ───────────────────────────────────────────────

/**
 * Returns aggregate counts for a dashboard.
 */
const getLeadStats = async () => {
  const [cartSnap, paidSnap, abandonedSnap] = await Promise.all([
    db.collection(COLLECTIONS.LEADS).where("status", "==", "cart").count().get(),
    db.collection(COLLECTIONS.LEADS).where("status", "==", "paid").count().get(),
    db.collection(COLLECTIONS.LEADS).where("status", "==", "abandoned").count().get(),
  ]);

  return {
    cart: cartSnap.data().count,
    paid: paidSnap.data().count,
    abandoned: abandonedSnap.data().count,
  };
};

module.exports = {
  upsertCartLead,
  markLeadAsPaid,
  getAbandonedCarts,
  markAbandonmentMessageSent,
  markWelcomeSent,
  getFeedbackQueue,
  markFeedbackSent,
  logEvent,
  getLeadStats,
};
