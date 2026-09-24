const path = require("node:path");
const express = require("express");
const { webhookCallback } = require("grammy");
require("dotenv").config();

const { bot, createStarsInvoiceLink, isAdmin } = require("./bot");
const { validateInitData } = require("./validateInitData");
const {
  getConfig,
  setConfig,
  getStats,
  getLatestPaidPurchase,
  upsertUser,
} = require("./db");

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const BOT_TOKEN = process.env.BOT_TOKEN;

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Auth middleware — validates Telegram.WebApp.initData sent by the client
// ---------------------------------------------------------------------------
function requireTelegramAuth(req, res, next) {
  const initData = req.header("X-Telegram-Init-Data") || req.body?.initData;
  const result = validateInitData(initData, BOT_TOKEN);
  if (!result.ok) {
    return res.status(401).json({ error: "unauthorized", detail: result.error });
  }
  req.telegramUser = result.user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.telegramUser || !isAdmin(req.telegramUser.id)) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Public config the WebApp needs to render (price, channel name)
// ---------------------------------------------------------------------------
app.get("/api/config", requireTelegramAuth, (req, res) => {
  upsertUser(req.telegramUser.id, req.telegramUser.username, req.telegramUser.first_name);
  res.json({
    channelName: getConfig("channel_name"),
    priceStars: Number(getConfig("price_stars")),
    isAdmin: isAdmin(req.telegramUser.id),
  });
});

// ---------------------------------------------------------------------------
// Create a Stars invoice link, to be opened with Telegram.WebApp.openInvoice
// ---------------------------------------------------------------------------
app.post("/api/invoice/create", requireTelegramAuth, async (req, res) => {
  try {
    const { link, price } = await createStarsInvoiceLink(req.telegramUser.id);
    res.json({ link, price });
  } catch (err) {
    console.error("invoice/create error:", err);
    res.status(500).json({ error: "failed_to_create_invoice" });
  }
});

// ---------------------------------------------------------------------------
// Poll after openInvoice resolves with status "paid" to fetch the invite link
// (the bot writes it to the DB asynchronously once successful_payment arrives)
// ---------------------------------------------------------------------------
app.get("/api/purchase/latest", requireTelegramAuth, (req, res) => {
  const purchase = getLatestPaidPurchase(req.telegramUser.id);
  if (!purchase) return res.json({ found: false });
  res.json({
    found: true,
    inviteLink: purchase.invite_link,
    amountStars: purchase.amount_stars,
    paidAt: purchase.paid_at,
  });
});

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------
app.get("/api/admin/stats", requireTelegramAuth, requireAdmin, (req, res) => {
  res.json(getStats());
});

app.post("/api/admin/price", requireTelegramAuth, requireAdmin, (req, res) => {
  const value = Number(req.body?.priceStars);
  if (!Number.isInteger(value) || value <= 0) {
    return res.status(400).json({ error: "invalid_price" });
  }
  setConfig("price_stars", value);
  res.json({ ok: true, priceStars: value });
});

app.post("/api/admin/channel", requireTelegramAuth, requireAdmin, (req, res) => {
  const { channelId, channelName } = req.body || {};
  if (!channelId || !/^-?\d+$/.test(String(channelId))) {
    return res.status(400).json({ error: "invalid_channel_id" });
  }
  setConfig("channel_id", channelId);
  if (channelName) setConfig("channel_name", channelName);
  res.json({ ok: true });
});

app.post("/api/admin/broadcast", requireTelegramAuth, requireAdmin, async (req, res) => {
  const { getAllPaidUserIds } = require("./db");
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "empty_message" });

  const ids = getAllPaidUserIds();
  let sent = 0;
  for (const id of ids) {
    try {
      await bot.api.sendMessage(id, `📢 *DELUXE VIP Announcement*\n\n${text}`, {
        parse_mode: "Markdown",
      });
      sent++;
    } catch (err) {
      console.error(`Broadcast failed for ${id}:`, err.description || err.message);
    }
  }
  res.json({ ok: true, sent, total: ids.length });
});

// ---------------------------------------------------------------------------
// Static client (the Mini App itself)
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "..", "client")));

// ---------------------------------------------------------------------------
// Telegram webhook endpoint
// ---------------------------------------------------------------------------
app.use(
  "/telegram/webhook",
  webhookCallback(bot, "express", { secretToken: WEBHOOK_SECRET || undefined })
);

async function main() {
  if (PUBLIC_URL) {
    await bot.api.setWebhook(`${PUBLIC_URL}/telegram/webhook`, {
      secret_token: WEBHOOK_SECRET || undefined,
      drop_pending_updates: true,
    });
    console.log(`Webhook set to ${PUBLIC_URL}/telegram/webhook`);
  } else {
    console.warn("PUBLIC_URL not set — falling back to long polling (dev only).");
    bot.start();
  }

  app.listen(PORT, () => {
    console.log(`DELUXE VIP server listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
