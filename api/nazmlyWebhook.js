const admin = require("firebase-admin");

if (!admin.apps.length) {
  try {
    // Handle both escaped \n and real newlines in private key
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT || "";
    const sa = JSON.parse(raw);
    if (sa.private_key) {
      sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    }
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } catch (err) {
    console.error("Firebase init error:", err.message);
  }
}

module.exports = async (req, res) => {
  try {
    const { nazmlyWebhook } = require("../functions/src/webhooks/nazmlyWebhook");
    return nazmlyWebhook(req, res);
  } catch (err) {
    console.error("Handler error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
