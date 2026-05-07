// Firebase Admin is initialized in server.js before any other module loads.
// This file is no longer the entry point — see server.js instead.

const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp();
}
