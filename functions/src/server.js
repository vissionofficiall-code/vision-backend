/**
 * ============================================================
 * VISION BACKEND — Express Server Entry Point
 * ============================================================
 * Runs as a standalone Express server on Render.com
 * Replaces Firebase Functions with node-cron for scheduling.
 * ============================================================
 */

require("dotenv").config();

const admin = require("firebase-admin");

// Initialize Firebase Admin with service account from env variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const express = require("express");
const cron = require("node-cron");
const { nazmlyWebhook } = require("./webhooks/nazmlyWebhook");
const { checkAbandonedCarts } = require("./schedulers/cartAbandonmentScheduler");
const { checkFeedbackQueue } = require("./schedulers/feedbackScheduler");

const app = express();

// ─── Routes ───────────────────────────────────────────────────
app.use("/nazmlyWebhook", nazmlyWebhook);

app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ─── Scheduled Jobs ───────────────────────────────────────────

// Every 15 minutes — check abandoned carts
cron.schedule("*/15 * * * *", async () => {
  console.log("[CRON] Checking abandoned carts...");
  await checkAbandonedCarts({}).catch((err) =>
    console.error("[CRON] Cart abandonment error:", err.message)
  );
}, { timezone: "Africa/Cairo" });

// Every 6 hours — send feedback messages
cron.schedule("0 */6 * * *", async () => {
  console.log("[CRON] Checking feedback queue...");
  await checkFeedbackQueue({}).catch((err) =>
    console.error("[CRON] Feedback queue error:", err.message)
  );
}, { timezone: "Africa/Cairo" });

// ─── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Vision Backend running on port ${PORT}`);
  console.log("Schedulers active: cart abandonment (15min), feedback (6hr)");
});
