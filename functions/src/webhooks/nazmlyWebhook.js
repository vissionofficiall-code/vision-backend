/**
 * ============================================================
 * NAZMLY WEBHOOK — Receives & Routes All Payment Events
 * ============================================================
 * Endpoint: POST /nazmlyWebhook
 *
 * Nazmly actual event names (from app.nzmly.com/developers/webhooks):
 *   - store.customer.created      → new customer registered
 *   - store.order.created         → order created (cart entered)
 *   - store.order.confirmed       → order confirmed
 *   - store.order.payment_succeeded → payment completed ✅
 * ============================================================
 */

const express = require("express");
const { verifyNazmlySignature, rateLimiter } = require("../middleware/security");
const { validateRequired, validatePhone, sanitizeString } = require("../utils/validators");
const { createLogger } = require("../utils/logger");
const firestoreService = require("../services/firestoreService");
const whatsappService = require("../services/whatsappService");
const analyticsService = require("../services/analyticsService");

const logger = createLogger("NazmlyWebhook");

// ─── Express App ──────────────────────────────────────────────
const app = express();

// Preserve raw body BEFORE express.json() parses it (needed for HMAC)
app.use((req, res, next) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    req.rawBody = raw;
    next();
  });
});

app.use(express.json());
app.use(rateLimiter);

// ─── Main Webhook Handler ─────────────────────────────────────

/**
 * POST /nazmlyWebhook
 *
 * Nazmly sends webhooks with this structure:
 * {
 *   event: "checkout.initiated" | "payment.success" | "payment.failed",
 *   data: {
 *     name: "Ahmed Ali",
 *     phone: "0501234567",
 *     email: "ahmed@example.com",
 *     product: "Vision",
 *     order_id: "ORD-123",
 *     amount: 299,
 *     currency: "SAR",
 *     utm_source: "instagram",
 *   }
 * }
 */
app.post("*", verifyNazmlySignature, async (req, res) => {
    const requestId = Date.now().toString(36); // simple trace ID
    logger.info("Webhook received", { requestId, body: req.body });

    // ── 1. Validate payload structure ─────────────────────────
    if (!req.body || !req.body.event) {
      logger.warn("Invalid webhook payload — missing event field", { requestId, body: req.body });
      return res.status(400).json({ error: "Missing event field" });
    }

    const event = req.body.event;

    // ── Nazmly field mapping (handles multiple payload formats) ─
    // Nazmly may nest data under "data", "order", or flatten it at root level.
    const raw = req.body.data || req.body.order || req.body;

    // ── 2. Validate & normalize phone ─────────────────────────
    const rawPhone = raw.phone || raw.customer_phone || raw.mobile || "";
    const phoneResult = validatePhone(rawPhone);
    if (!phoneResult.valid) {
      logger.warn("Invalid phone number in webhook", { phone: rawPhone, requestId });
      return res.status(400).json({ error: "Invalid phone number" });
    }

    const phone = phoneResult.normalized;

    // ── 3. Build clean lead object ────────────────────────────
    const lead = {
      phone,
      name: sanitizeString(raw.name || raw.customer_name || raw.full_name || ""),
      email: sanitizeString(raw.email || raw.customer_email || ""),
      product: sanitizeString(raw.product || raw.product_name || "Vision"),
      orderId: sanitizeString(raw.order_id || raw.id || raw.reference || ""),
      amount: raw.amount || raw.total || raw.price || null,
      currency: raw.currency || "SAR",
      source: sanitizeString(raw.utm_source || raw.source || "direct"),
      analytics: analyticsService.extractAnalyticsData(raw),
    };

    // ── 4. Route by event type ────────────────────────────────
    // Nazmly event names (verified from app.nzmly.com/developers/webhooks)
    const CHECKOUT_EVENTS = ["store.order.created", "store.order.confirmed", "store.customer.created"];
    const SUCCESS_EVENTS  = ["store.order.payment_succeeded"];
    const FAILED_EVENTS   = ["store.order.payment_failed"];

    try {
      if (CHECKOUT_EVENTS.includes(event)) {
        await handleCheckoutInitiated(lead, requestId);
      } else if (SUCCESS_EVENTS.includes(event)) {
        await handlePaymentSuccess(lead, requestId);
      } else if (FAILED_EVENTS.includes(event)) {
        await handlePaymentFailed(lead, requestId);
      } else {
        logger.warn("Unknown event type — ignored", { event, requestId });
        return res.status(200).json({ received: true, event, handled: false });
      }

      // Always return 200 quickly so Nazmly doesn't retry
      return res.status(200).json({ received: true, event, requestId });
    } catch (err) {
      logger.error("Webhook handler error", err, { event, phone, requestId });
      // Still return 200 to prevent Nazmly from retrying
      // Log the error internally instead
      return res.status(200).json({ received: true, error: "Internal error logged" });
    }
});

// ═══════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════

/**
 * AUTOMATION 1: User enters checkout
 * → Save lead with status "cart"
 * → Scheduler will pick this up after 1 hour if not paid
 */
const handleCheckoutInitiated = async (lead, requestId) => {
  logger.info("Handling checkout.initiated", { phone: lead.phone, requestId });

  const result = await firestoreService.upsertCartLead(lead);

  if (result.skipped) {
    logger.info("Lead skipped (already paid)", { phone: lead.phone, reason: result.reason });
    return;
  }

  logger.info("Cart lead saved successfully", { phone: lead.phone });
};

/**
 * AUTOMATION 2: Payment completed
 * → Update status to "paid"
 * → Send welcome message
 * → Send community invite
 * → Queue feedback message for 2 days later
 */
const handlePaymentSuccess = async (lead, requestId) => {
  logger.info("Handling payment.success", { phone: lead.phone, requestId });

  // Step 1: Update Firestore to "paid" + queue feedback
  await firestoreService.markLeadAsPaid(lead.phone, {
    name: lead.name,
    email: lead.email,
    product: lead.product,
    orderId: lead.orderId,
    amount: lead.amount,
    currency: lead.currency,
  });

  // Step 2: Send welcome message
  try {
    await whatsappService.sendWelcomeMessage(lead);
    await firestoreService.markWelcomeSent(lead.phone);
    logger.info("Welcome message sent", { phone: lead.phone });
  } catch (err) {
    logger.error("Failed to send welcome message", err, { phone: lead.phone });
    // Continue — don't block the community invite
  }

  // Step 3: Send community invite (short delay for better UX)
  await delay(3000); // 3 seconds between messages
  try {
    await whatsappService.sendCommunityInvite(lead);
    logger.info("Community invite sent", { phone: lead.phone });
  } catch (err) {
    logger.error("Failed to send community invite", err, { phone: lead.phone });
  }

  // Feedback will be sent by the scheduler after 2 days
  logger.info("Payment handled — feedback queued for 2 days", { phone: lead.phone });
};

/**
 * Optional: Handle failed payments
 * You can add a recovery flow here later.
 */
const handlePaymentFailed = async (lead, requestId) => {
  logger.warn("Payment failed for lead", { phone: lead.phone, requestId });
  await firestoreService.logEvent("payment_failed", lead.phone, {
    product: lead.product,
    amount: lead.amount,
  });
};

// ─── Helpers ─────────────────────────────────────────────────
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { nazmlyWebhook: app };
