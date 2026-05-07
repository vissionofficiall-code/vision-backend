const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
  });
}

const { nazmlyWebhook } = require("../functions/src/webhooks/nazmlyWebhook");
module.exports = nazmlyWebhook;
