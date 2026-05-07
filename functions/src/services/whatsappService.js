/**
 * ============================================================
 * WHATSAPP SERVICE — Multi-Provider Abstraction
 * ============================================================
 * Supports: Ultramsg | Twilio | WaAPI
 * Switch providers by changing WHATSAPP_PROVIDER env variable.
 * Add new providers by implementing the provider interface.
 * ============================================================
 */

const axios = require("axios");
const config = require("../config");
const { createLogger } = require("../utils/logger");

const logger = createLogger("WhatsAppService");

// ═══════════════════════════════════════════════════════════════
// MESSAGE TEMPLATES
// ─────────────────────────────────────────────────────────────
// Add your message content here.
// Use {{name}}, {{product}}, {{link}} as placeholders.
// ═══════════════════════════════════════════════════════════════

const TEMPLATES = {
  /**
   * Sent when a user abandons their cart after 1 hour.
   * @param {object} lead - { name, product }
   */
  cartAbandonment: (lead) => `
أهلاً ${lead.name || ""}👋
أحنا شوفنا إنك ضفت كتاب سر صناعة المحتوى للكارت… وده معناه إنك فعلًا بدأت تفكر بجدية في تغيير شكل محتواك 👀
الخطوة دي مش بيعملها أي حد… دي خطوة شخص قرر إنه يكون مميز.
ودلوقتي فاضلك خطوة واحدة بس… خطوة صغيرة، لكنها ممكن تفرق معاك جدًا في رحلتك 👌
https://Vision.nzmly.com
`.trim(),

  /**
   * Sent immediately after a successful purchase.
   * @param {object} lead - { name, product }
   */
  welcome: (lead) => `
🎉 مبروك ${lead.name || ""}!

تم تأكيد اشتراكك في ${lead.product || config.product.name} بنجاح.

نحن سعيدين إنك معنا، وما راح تندم على هذا القرار.

ابدأ رحلتك الآن 👇
`.trim(),

  /**
   * Community invite link message.
   * @param {object} lead - { name }
   * @param {string} link - community invite URL
   */
  communityInvite: (lead, link) => `
🚀 ${lead.name || ""}، الكوميونيتي تنتظرك!

انضم الآن لمجموعة ${config.product.name} الخاصة:
👇
${link}

هذا المكان فيه كل اللي تحتاجه:
✅ دعم مباشر
✅ تحديثات حصرية
✅ أعضاء يشاركونك نفس الطريق
`.trim(),

  /**
   * Sent 2 days after purchase to collect feedback.
   * @param {object} lead - { name, product }
   */
  feedbackRequest: (lead) => `
أهلاً 👋
مبسوطين جدًا إنك بدأت مع كتاب "Vision" 🙌

حابين نعرف:
هل حسيت إنه بدأ يغيّر طريقة تفكيرك أو نظرتك لمحتواك؟ 👀

لو تجربتك كانت كويسة، ممكن تكتبلنا رأيك في سطرين؟
(حابين نشارك تجارب حقيقية زيك 👌)
ومتنساش تنضم لمجتمع فيجن عشان تحصل على خصم يوصل 50%
على منتجاتنا الجاية
https://chat.whatsapp.com/EakoWrfFC8n9SIDMkAETRm
`.trim(),
};

// ═══════════════════════════════════════════════════════════════
// PROVIDERS
// ═══════════════════════════════════════════════════════════════

/**
 * Ultramsg provider (popular in Gulf region).
 * Docs: https://ultramsg.com/api
 */
const ultramsgSend = async (phone, message) => {
  const { instanceId, token, apiUrl } = config.whatsapp;

  if (!instanceId || !token) {
    throw new Error("Ultramsg credentials not configured (WHATSAPP_INSTANCE_ID, WHATSAPP_TOKEN)");
  }

  const url = `${apiUrl}/${instanceId}/messages/chat`;
  const response = await axios.post(
    url,
    new URLSearchParams({ token, to: phone, body: message }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  return response.data;
};

/**
 * Twilio WhatsApp provider.
 * Docs: https://www.twilio.com/docs/whatsapp
 */
const twilioSend = async (phone, message) => {
  const { token, fromNumber } = config.whatsapp;

  if (!token || !fromNumber) {
    throw new Error("Twilio credentials not configured");
  }

  // token format: "AccountSid:AuthToken"
  const [accountSid, authToken] = token.split(":");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const response = await axios.post(
    url,
    new URLSearchParams({
      From: `whatsapp:${fromNumber}`,
      To: `whatsapp:${phone}`,
      Body: message,
    }),
    {
      auth: { username: accountSid, password: authToken },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  return response.data;
};

/**
 * WaAPI provider.
 */
const waapiSend = async (phone, message) => {
  const { instanceId, token, apiUrl } = config.whatsapp;

  const response = await axios.post(
    `${apiUrl}/api/sendMessage`,
    { chatId: `${phone}@c.us`, message },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );

  return response.data;
};

// ─── Provider Router ─────────────────────────────────────────
const PROVIDERS = {
  ultramsg: ultramsgSend,
  twilio: twilioSend,
  waapi: waapiSend,
};

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Core send function — routes to the configured provider.
 * @param {string} phone - normalized phone number (+966...)
 * @param {string} message - text content
 */
const sendMessage = async (phone, message) => {
  const provider = config.whatsapp.provider;
  const sendFn = PROVIDERS[provider];

  if (!sendFn) {
    throw new Error(`Unknown WhatsApp provider: "${provider}". Use: ultramsg | twilio | waapi`);
  }

  logger.info("Sending WhatsApp message", { phone, provider, preview: message.slice(0, 60) });

  try {
    const result = await sendFn(phone, message);
    logger.info("Message sent successfully", { phone, provider });
    return { success: true, result };
  } catch (err) {
    logger.error("Failed to send WhatsApp message", err, { phone, provider });
    throw err;
  }
};

// ─── Typed senders using templates ───────────────────────────

const sendCartAbandonmentMessage = async (lead) => {
  const message = TEMPLATES.cartAbandonment(lead);
  return sendMessage(lead.phone, message);
};

const sendWelcomeMessage = async (lead) => {
  const message = TEMPLATES.welcome(lead);
  return sendMessage(lead.phone, message);
};

const sendCommunityInvite = async (lead) => {
  const link = config.product.communityLink;
  if (!link) {
    logger.warn("COMMUNITY_INVITE_LINK not set — skipping community invite", { phone: lead.phone });
    return { skipped: true };
  }
  const message = TEMPLATES.communityInvite(lead, link);
  return sendMessage(lead.phone, message);
};

const sendFeedbackRequest = async (lead) => {
  const message = TEMPLATES.feedbackRequest(lead);
  return sendMessage(lead.phone, message);
};

module.exports = {
  sendMessage,
  sendCartAbandonmentMessage,
  sendWelcomeMessage,
  sendCommunityInvite,
  sendFeedbackRequest,
  TEMPLATES, // exported so you can preview/test templates
};
