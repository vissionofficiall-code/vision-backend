const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
});

const { checkAbandonedCarts } = require("../functions/src/schedulers/cartAbandonmentScheduler");

checkAbandonedCarts({})
  .then(() => { console.log("Cart check done"); process.exit(0); })
  .catch((err) => { console.error("Error:", err.message); process.exit(1); });
