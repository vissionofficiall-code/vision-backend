# Vision Backend — Firebase Automation System
### Built for Youssef El-Hanawy | Vision Digital Product

---

## 📐 System Architecture

```
Nazmly (Checkout Platform)
        │
        │  POST /nazmlyWebhook
        ▼
┌─────────────────────────────────────────────────────────┐
│                 Firebase Cloud Functions                  │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │             nazmlyWebhook (HTTP)                  │    │
│  │  ├── Security Middleware (HMAC signature + rate)  │    │
│  │  ├── checkout.initiated → save lead to Firestore  │    │
│  │  └── payment.success   → mark paid + send welcome │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │     checkAbandonedCarts (every 15 minutes)        │    │
│  │  └── query carts > 1hr → send WhatsApp → flag     │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │     checkFeedbackQueue (every 6 hours)            │    │
│  │  └── query paid leads due → send feedback → flag  │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────┐     ┌──────────────────────┐
│  Firestore Database      │     │  WhatsApp API         │
│  ├── leads/              │     │  (Ultramsg / Twilio)  │
│  ├── events/             │     └──────────────────────┘
│  └── analytics_snapshots/│
└─────────────────────────┘
```

---

## 🗂️ Project Structure

```
vision-backend/
├── firebase.json                  # Firebase project config
├── firestore.rules                # Security rules (admin-only)
├── firestore.indexes.json         # Composite indexes for queries
├── .gitignore
│
└── functions/
    ├── package.json
    ├── .env.example               # Copy to .env and fill in values
    │
    └── src/
        ├── index.js               # 🚪 Entry point — exports all functions
        │
        ├── config/
        │   └── index.js           # All env variables in one place
        │
        ├── webhooks/
        │   └── nazmlyWebhook.js   # Handles checkout + payment events
        │
        ├── schedulers/
        │   ├── cartAbandonmentScheduler.js  # Runs every 15 min
        │   └── feedbackScheduler.js         # Runs every 6 hours
        │
        ├── services/
        │   ├── whatsappService.js   # Multi-provider WhatsApp abstraction
        │   ├── firestoreService.js  # All DB operations
        │   └── analyticsService.js  # Lead funnel metrics
        │
        ├── middleware/
        │   └── security.js          # HMAC verification + rate limiting
        │
        └── utils/
            ├── logger.js            # Structured JSON logging
            └── validators.js        # Phone normalization, input validation
```

---

## 🗄️ Firestore Schema

### Collection: `leads`
Document ID: normalized phone number (e.g. `+966501234567`)

| Field            | Type      | Description                                      |
|------------------|-----------|--------------------------------------------------|
| phone            | string    | Normalized international format                  |
| name             | string    | Customer full name                               |
| email            | string    | Customer email (optional)                        |
| product          | string    | Product name ("Vision")                          |
| status           | string    | `cart` → `abandoned` or `paid`                   |
| source           | string    | Traffic source (utm_source)                      |
| analytics        | map       | utm_source, utm_medium, utm_campaign, device     |
| createdAt        | timestamp | First time we saw this lead                      |
| updatedAt        | timestamp | Last update time                                 |
| cartAt           | timestamp | When they entered checkout                       |
| paidAt           | timestamp | When payment was confirmed (null if not paid)    |
| messageSent      | boolean   | Cart abandonment message sent?                   |
| welcomeSent      | boolean   | Welcome message sent?                            |
| feedbackSent     | boolean   | Feedback request sent?                           |
| feedbackQueuedAt | timestamp | When to send feedback (paidAt + 2 days)          |
| orderId          | string    | Nazmly order reference                           |
| amount           | number    | Payment amount                                   |
| currency         | string    | SAR / EGP / USD                                  |

### Collection: `events`
Audit log of all significant actions.

| Field     | Type      | Description                          |
|-----------|-----------|--------------------------------------|
| eventType | string    | `cart_entered`, `purchase_completed`, `abandonment_message_sent`, `welcome_message_sent`, `feedback_message_sent` |
| phone     | string    | Lead phone                           |
| metadata  | map       | Event-specific data                  |
| createdAt | timestamp | Event time                           |

### Collection: `analytics_snapshots`
Document ID: date string `YYYY-MM-DD`

| Field          | Type   | Description               |
|----------------|--------|---------------------------|
| date           | string | YYYY-MM-DD                |
| cart           | number | Leads currently in cart   |
| paid           | number | Total paid customers      |
| abandoned      | number | Total abandoned leads     |
| conversionRate | number | paid / (paid+abandoned+cart) × 100 |

---

## ⚡ Automation Flows

### Automation 1: Cart Abandonment
```
User enters checkout
        │
        ▼
Nazmly sends webhook (checkout.initiated)
        │
        ▼
Save to Firestore { status: "cart", messageSent: false }
        │
        ▼ (15 minutes later...)
Cloud Scheduler checks: status == "cart" AND cartAt < 1hr ago AND messageSent == false
        │
        ▼
Send WhatsApp abandonment message
        │
        ▼
Update Firestore { messageSent: true, status: "abandoned" }
```

### Automation 2: Post-Purchase
```
User completes payment
        │
        ▼
Nazmly sends webhook (payment.success)
        │
        ▼
Update Firestore { status: "paid", feedbackQueuedAt: now + 2 days }
        │
        ├──► Send welcome WhatsApp message (immediately)
        │
        └──► Send community invite link (3 seconds later)

        │
        ▼ (2 days later...)
Cloud Scheduler checks: status == "paid" AND feedbackQueuedAt <= now AND feedbackSent == false
        │
        ▼
Send feedback request WhatsApp message
        │
        ▼
Update Firestore { feedbackSent: true }
```

---

## 🚀 Setup & Deployment

### Prerequisites
- Node.js 18+
- Firebase CLI: `npm install -g firebase-tools`
- Firebase project created (Blaze plan required for Cloud Scheduler)

### Step 1: Clone & Install
```bash
git clone <your-repo>
cd vision-backend
cd functions && npm install
```

### Step 2: Configure Firebase
```bash
firebase login
firebase use --add    # Select your Firebase project
```

### Step 3: Set Environment Variables

**For local development:**
```bash
cp functions/.env.example functions/.env
# Edit functions/.env with your real values
```

**For production (Firebase Functions config):**
```bash
firebase functions:config:set \
  whatsapp.provider="ultramsg" \
  whatsapp.instance_id="your_instance_id" \
  whatsapp.token="your_token" \
  whatsapp.api_url="https://api.ultramsg.com" \
  nazmly.webhook_secret="your_secret" \
  nazmly.verify_signature="true" \
  product.name="Vision" \
  product.community_link="https://chat.whatsapp.com/xxxxx"
```

### Step 4: Deploy Firestore Rules & Indexes
```bash
firebase deploy --only firestore
```

### Step 5: Deploy Functions
```bash
cd functions
npm run deploy
```

### Step 6: Get Your Webhook URL
After deployment, Firebase will show your webhook URL:
```
https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/nazmlyWebhook
```

Paste this URL into your Nazmly dashboard under:
**Settings → Webhooks → Endpoint URL**

Enable these events:
- ✅ `checkout.initiated`
- ✅ `payment.success`
- ✅ `payment.failed` (optional)

---

## 🔧 Local Development

```bash
# Start Firebase emulators
cd functions
npm run serve

# Your local webhook URL will be:
# http://127.0.0.1:5001/YOUR_PROJECT/us-central1/nazmlyWebhook

# Test with curl:
curl -X POST http://127.0.0.1:5001/YOUR_PROJECT/us-central1/nazmlyWebhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "checkout.initiated",
    "data": {
      "name": "Ahmed Ali",
      "phone": "0501234567",
      "email": "ahmed@test.com",
      "product": "Vision",
      "utm_source": "instagram"
    }
  }'
```

---

## 🔐 Security Best Practices

1. **Webhook Signature**: Always enable `NAZMLY_VERIFY_SIGNATURE=true` in production
2. **Firestore Rules**: All collections are admin-only (no client SDK access)
3. **No sensitive data in logs**: Phone numbers are logged but no payment data
4. **Rate Limiting**: 100 requests/10min per IP built in
5. **Environment Variables**: Never hardcode secrets — use `.env` locally, Firebase config in production
6. **Error Responses**: Always return 200 to Nazmly even on internal errors (prevents retries flooding)

---

## 📊 Monitoring

View logs in real time:
```bash
firebase functions:log --follow
```

View in Firebase Console:
- **Functions** → Logs tab
- **Firestore** → Data tab → leads collection

---

## ✏️ Customizing Message Templates

All message content is in one place:
```
functions/src/services/whatsappService.js → TEMPLATES object
```

Four templates:
- `cartAbandonment(lead)` — sent after 1 hour of inactivity
- `welcome(lead)` — sent immediately after purchase
- `communityInvite(lead, link)` — sent right after welcome
- `feedbackRequest(lead)` — sent 2 days after purchase

---

## 🔄 Changing WhatsApp Provider

Just change one environment variable:
```
WHATSAPP_PROVIDER=twilio    # or ultramsg or waapi
```

No code changes needed. Provider credentials update accordingly.
