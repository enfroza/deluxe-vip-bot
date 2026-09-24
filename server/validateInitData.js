const crypto = require("node:crypto");

/**
 * Verifies the `initData` string a Telegram Mini App sends with every request.
 * Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * @param {string} initData - raw query string from Telegram.WebApp.initData
 * @param {string} botToken - the bot's token
 * @param {number} maxAgeSeconds - reject data older than this (replay protection)
 * @returns {{ ok: boolean, user?: object, error?: string }}
 */
function validateInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData || typeof initData !== "string") {
    return { ok: false, error: "missing initData" };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "missing hash" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) {
    return { ok: false, error: "invalid signature" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  const ageSeconds = Date.now() / 1000 - authDate;
  if (maxAgeSeconds > 0 && ageSeconds > maxAgeSeconds) {
    return { ok: false, error: "stale initData" };
  }

  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    /* ignore parse errors, user stays null */
  }

  return { ok: true, user, params: Object.fromEntries(params.entries()) };
}

module.exports = { validateInitData };
