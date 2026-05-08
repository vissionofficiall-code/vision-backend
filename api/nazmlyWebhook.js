const admin = require("firebase-admin");

if (!admin.apps.length) {
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } catch (err) {
    console.error("Firebase init error:", err.message);
  }
}

const { validatePhone, sanitizeString } = require("../functions/src/utils/validators");
const firestoreService = require("../functions/src/services/firestoreService");
const whatsappService  = require("../functions/src/services/whatsappService");
const analyticsService = require("../functions/src/services/analyticsService");

const CHECKOUT = ["store.order.created", "store.order.confirmed", "store.customer.created"];
const SUCCESS  = ["store.order.payment_succeeded"];

// Pure Node.js handler — no Express middleware conflicts with Vercel
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  // ── Parse body (handle all Vercel formats) ──────────────────
  let body = {};
  try {
    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
      body = req.body; // Already parsed by Vercel
    } else {
      const raw = await new Promise((resolve, reject) => {
        let data = "";
        if (Buffer.isBuffer(req.body)) { resolve(req.body.toString("utf8")); return; }
        if (typeof req.body === "string") { resolve(req.body); return; }
        req.setEncoding("utf8");
        req.on("data", c => { data += c; });
        req.on("end",  () => resolve(data));
        req.on("error", reject);
      });
      body = raw ? JSON.parse(raw) : {};
    }
  } catch (e) {
    return res.end(JSON.stringify({ error: "Invalid JSON" }));
  }

  // ── Route ────────────────────────────────────────────────────
  const event = body.type || body.event;
  if (!event) return res.end(JSON.stringify({ error: "Missing event" }));

  const data     = body.data || body;
  const customer = data.customer || {};
  const charge   = data.charge_amount || {};

  const rawPhone   = customer.phone || data.phone || "";
  const phoneResult = validatePhone(rawPhone);
  if (!phoneResult.valid) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Invalid phone", received: rawPhone }));
  }

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

  try {
    if (CHECKOUT.includes(event)) {
      await firestoreService.upsertCartLead(lead);
    } else if (SUCCESS.includes(event)) {
      await firestoreService.markLeadAsPaid(lead.phone, lead);
      try {
        await whatsappService.sendWelcomeMessage(lead);
        await firestoreService.markWelcomeSent(lead.phone);
        await new Promise(r => setTimeout(r, 3000));
        await whatsappService.sendCommunityInvite(lead);
      } catch (e) {
        console.error("WhatsApp error:", e.message);
      }
    }
    return res.end(JSON.stringify({ received: true, event }));
  } catch (err) {
    console.error("Handler error:", err.message);
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: err.message }));
  }
};
