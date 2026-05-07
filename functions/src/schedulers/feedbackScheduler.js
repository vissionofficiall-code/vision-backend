/**
 * ============================================================
 * FEEDBACK SCHEDULER
 * ============================================================
 * Runs every 6 hours via Cloud Scheduler.
 * Finds paid customers whose feedback window has passed
 * and sends them a WhatsApp feedback request.
 *
 * Guarantees:
 *   ✅ No duplicate messages (feedbackSent flag)
 *   ✅ Batch processing with error isolation
 *   ✅ Delays between sends to respect API rate limits
 * ============================================================
 */

const { createLogger } = require("../utils/logger");
const firestoreService = require("../services/firestoreService");
const whatsappService = require("../services/whatsappService");

const logger = createLogger("FeedbackScheduler");

/**
 * Main scheduler function — called by Firebase Pub/Sub trigger.
 * @param {object} context - Firebase scheduler context
 */
const checkFeedbackQueue = async (context) => {
  logger.info("Feedback scheduler started", { trigger: context?.timestamp });

  // ── 1. Fetch leads ready for feedback ────────────────────
  let leads;
  try {
    leads = await firestoreService.getFeedbackQueue();
  } catch (err) {
    logger.error("Failed to fetch feedback queue", err);
    return;
  }

  if (leads.length === 0) {
    logger.info("Feedback queue empty — nothing to do.");
    return;
  }

  logger.info(`Sending feedback messages to ${leads.length} customers...`);

  // ── 2. Process each lead independently ───────────────────
  const results = { success: 0, failed: 0 };

  for (const lead of leads) {
    try {
      await processFeedbackLead(lead);
      results.success++;
    } catch (err) {
      logger.error("Failed to send feedback to lead", err, { phone: lead.phone });
      results.failed++;
    }

    // Respectful delay between messages
    await delay(1000);
  }

  logger.info("Feedback scheduler completed", results);
};

/**
 * Sends feedback request to a single customer.
 */
const processFeedbackLead = async (lead) => {
  // Defensive check
  if (lead.feedbackSent === true) {
    logger.warn("Feedback already sent — skipping", { phone: lead.phone });
    return;
  }

  logger.info("Sending feedback request", {
    phone: lead.phone,
    name: lead.name,
    paidAt: lead.paidAt,
  });

  await whatsappService.sendFeedbackRequest(lead);
  await firestoreService.markFeedbackSent(lead.phone);

  logger.info("Feedback message sent & marked", { phone: lead.phone });
};

// ─── Helpers ─────────────────────────────────────────────────
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { checkFeedbackQueue };
