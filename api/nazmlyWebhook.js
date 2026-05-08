const admin = require("firebase-admin");

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } catch (err) {
    console.error("Firebase init error:", err.message);
  }
}

// Disable signature verification in Vercel (rawBody stream not available)
process.env.NAZMLY_VERIFY_SIGNATURE = "false";

const express = require("express");
const { validatePhone, sanitizeString } = require("../functions/src/utils/validators");
const { createLogger } = require("../functions/src/utils/logger");
const firestoreService = require("../functions/src/services/firestoreService");
const whatsappService = require("../functions/src/services/whatsappService");
const analyticsService = require("../functions/src/services/analyticsService");

const logger = createLogger("Webhook");
const app = express();

// Fix: Vercel pre-parses the body before Express sees it.
// Setting req._body=true tells body-parser to skip re-parsing the empty stream.
app.use((req, res, next) => {
  if (req.body !== undefined) req._body = true;
  next();
});
app.use(express.json());

const CHECKOUT_EVENTS = ["store.order.created", "store.order.confirmed", "store.customer.created"];
const SUCCESS_EVENTS  = ["store.order.payment_succeeded"];

app.post("*", async (req, res) => {
  try {
    const body = req.body || {};
    const event = body.type || body.event;
    if (!event) return res.status(400).json({ error: "Missing event" });

    const data     = body.data || body;
    const customer = data.customer || {};
    const charge   = data.charge_amount || {};

    const rawPhone = customer.phone || data.phone || "";
    const phoneResult = validatePhone(rawPhone);
    if (!phoneResult.valid) return res.status(400).json({ error: "Invalid phone" });

    const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
    const lead = {
      phone:    phoneResult.normalized,
      name:     sanitizeString(fullName || data.name || ""),
      email:    sanitizeString(customer.email || data.email || ""),
      product:  "Vision",
      orderId:  sanitizeString(data.id || data.order_id || ""),
      amount:   charge.total_amount || data.amount || null,
      currency: charge.currency || "SAR",
      source:   sanitizeString(data.utm_source || "direct"),
      analytics: analyticsService.extractAnalyticsData(data),
    };

    if (CHECKOUT_EVENTS.includes(event)) {
      await firestoreService.upsertCartLead(lead);
      logger.info("Cart lead saved", { phone: lead.phone, event });
    } else if (SUCCESS_EVENTS.includes(event)) {
      await firestoreService.markLeadAsPaid(lead.phone, lead);
      try {
        await whatsappService.sendWelcomeMessage(lead);
        await firestoreService.markWelcomeSent(lead.phone);
        await new Promise(r => setTimeout(r, 3000));
        await whatsappService.sendCommunityInvite(lead);
      } catch (e) {
        logger.error("WhatsApp send error", e);
      }
    }

    return res.status(200).json({ received: true, event });
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = app;
