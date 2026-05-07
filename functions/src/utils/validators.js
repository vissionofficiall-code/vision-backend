/**
 * ============================================================
 * VALIDATORS — Input Validation Helpers
 * ============================================================
 */

/**
 * Validates & normalizes a phone number to international format.
 * Handles Egyptian (+20) and Saudi (+966) numbers.
 * @param {string} phone
 * @returns {{ valid: boolean, normalized: string|null }}
 */
const validatePhone = (phone) => {
  if (!phone || typeof phone !== "string") {
    return { valid: false, normalized: null };
  }

  // Strip all spaces, dashes, parentheses
  let cleaned = phone.replace(/[\s\-\(\)]/g, "");

  // Already has +, validate length
  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    if (digits.length >= 10 && digits.length <= 15) {
      return { valid: true, normalized: cleaned };
    }
    return { valid: false, normalized: null };
  }

  // Starts with 00 (international prefix)
  if (cleaned.startsWith("00")) {
    const withPlus = "+" + cleaned.slice(2);
    return validatePhone(withPlus);
  }

  // Egyptian local: 01x xxxxxxxx → +201x xxxxxxxx
  if (cleaned.startsWith("01") && cleaned.length === 11) {
    return { valid: true, normalized: "+2" + cleaned };
  }

  // Saudi local: 05x xxxxxxxx → +9665x xxxxxxxx
  if (cleaned.startsWith("05") && cleaned.length === 10) {
    return { valid: true, normalized: "+966" + cleaned.slice(1) };
  }

  return { valid: false, normalized: null };
};

/**
 * Validates required fields in a payload object.
 * @param {object} payload
 * @param {string[]} fields
 * @returns {{ valid: boolean, missing: string[] }}
 */
const validateRequired = (payload, fields) => {
  const missing = fields.filter(
    (f) => payload[f] === undefined || payload[f] === null || payload[f] === ""
  );
  return { valid: missing.length === 0, missing };
};

/**
 * Sanitizes a string value to prevent injection.
 * @param {string} value
 * @returns {string}
 */
const sanitizeString = (value) => {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[<>]/g, "");
};

module.exports = { validatePhone, validateRequired, sanitizeString };
