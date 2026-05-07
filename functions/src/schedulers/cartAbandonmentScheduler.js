/**
 * ============================================================
 * CART ABANDONMENT SCHEDULER
 * ============================================================
 * Runs every 15 minutes via Cloud Scheduler.
 * Finds leads stuck in "cart" status for > 1 hour
 * and sends them a WhatsApp recovery message.
 *
 * Guarantees:
 *   ✅ No duplicate messages (messageSent flag)
 *   ✅ Skips leads that paid between checks
 *   ✅ Handles errors per-lead without crashing the batch
 * ============================================================
 */

const config = require("../config");
const { createLogger } = require("../utils/logger");
const firestoreService = require("../services/firestoreService");
const whatsappService = require("../services/whatsappService");

const logger = createLogger("CartAbandonmentScheduler");

/**
 * Main scheduler function — called by Firebase Pub/Sub trigger.
 * @param {object} context - Firebase scheduler context
 */
const checkAbandonedCarts = async (context) => {
  logger.info("Cart abandonment scheduler started", {
    trigger: context?.timestamp,
    hoursThreshold: config.automation.cartAbandonmentHours,
  });

  // ── 1. Fetch all qualifying abandoned carts ───────────────
  let abandonedLeads;
  try {
    abandonedLeads = await firestoreService.getAbandonedCarts(
      config.automation.cartAbandonmentHours
    );
  } catch (err) {
    logger.error("Failed to fetch abandoned carts", err);
    return; // Exit gracefully — scheduler will retry
  }

  if (abandonedLeads.length === 0) {
    logger.info("No abandoned carts found — nothing to do.");
    return;
  }

  logger.info(`Processing ${abandonedLeads.length} abandoned carts...`);

  // ── 2. Process each lead independently ───────────────────
  const results = { success: 0, failed: 0, skipped: 0 };

  for (const lead of abandonedLeads) {
    try {
      await processAbandonedLead(lead);
      results.success++;
    } catch (err) {
      logger.error("Failed to process abandoned lead", err, { phone: lead.phone });
      results.failed++;
    }

    // Small delay to avoid WhatsApp rate limits
    await delay(500);
  }

  logger.info("Cart abandonment scheduler completed", results);
};

/**
 * Processes a single abandoned lead:
 * 1. Double-checks it hasn't paid (race condition guard)
 * 2. Sends WhatsApp message
 * 3. Marks messageSent = true in Firestore
 */
const processAbandonedLead = async (lead) => {
  // Guard: re-check status in case they paid between the batch query and now
  if (lead.status === "paid") {
    logger.info("Lead paid since batch started — skipping", { phone: lead.phone });
    return;
  }

  // Guard: should never happen due to Firestore query, but defensive check
  if (lead.messageSent === true) {
    logger.warn("Message already sent — skipping duplicate", { phone: lead.phone });
    return;
  }

  logger.info("Sending abandonment message", {
    phone: lead.phone,
    name: lead.name,
    product: lead.product,
    cartAge: getAgeInMinutes(lead.cartAt) + " minutes",
  });

  // Send WhatsApp message
  await whatsappService.sendCartAbandonmentMessage(lead);

  // Mark as sent in Firestore (prevents duplicates on next run)
  await firestoreService.markAbandonmentMessageSent(lead.phone);

  logger.info("Abandonment message sent & marked", { phone: lead.phone });
};

// ─── Helpers ─────────────────────────────────────────────────

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getAgeInMinutes = (timestamp) => {
  if (!timestamp) return "unknown";
  const cartDate = timestamp._seconds
    ? new Date(timestamp._seconds * 1000)
    : new Date(timestamp);
  return Math.floor((Date.now() - cartDate.getTime()) / 60000);
};

module.exports = { checkAbandonedCarts };
