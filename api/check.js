const admin = require("firebase-admin");

if (!admin.apps.length) {
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } catch (err) {}
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const db = admin.firestore();
    const snap = await db.collection("leads").orderBy("createdAt", "desc").limit(20).get();
    const leads = [];
    snap.forEach(doc => {
      const d = doc.data();
      leads.push({
        phone: d.phone,
        name: d.name,
        status: d.status,
        messageSent: d.messageSent,
        cartAt: d.cartAt ? new Date(d.cartAt._seconds * 1000).toISOString() : null,
      });
    });
    res.end(JSON.stringify({ total: leads.length, leads }));
  } catch (err) {
    res.end(JSON.stringify({ error: err.message }));
  }
};
