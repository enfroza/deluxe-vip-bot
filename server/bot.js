const { Bot, InlineKeyboard, InputFile } = require("grammy");
require("dotenv").config();

const {
  getConfig,
  setConfig,
  upsertUser,
  createPendingPurchase,
  markPurchasePaid,
  getStats,
  getAllPaidUserIds,
} = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing from .env");

const bot = new Bot(BOT_TOKEN);

const isAdmin = (id) => ADMIN_IDS.includes(Number(id));

// ---------------------------------------------------------------------------
// /start — greets the user and opens the Mini App
// ---------------------------------------------------------------------------
bot.command("start", async (ctx) => {
  upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const channelName = getConfig("channel_name");
  const price = getConfig("price_stars");

  const keyboard = new InlineKeyboard().webApp(
    `Open ${channelName} ✨`,
    `${PUBLIC_URL}/`
  );

  await ctx.reply(
    `Welcome to *${channelName}*.\n\n` +
      `Unlock the exclusive channel for *${price} ⭐ Stars*.\n` +
      `Tap below to view access details and pay securely inside Telegram.`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
});

// ---------------------------------------------------------------------------
// Admin: /stats, /setprice, /setchannel, /broadcast
// ---------------------------------------------------------------------------
bot.command("stats", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const { revenue, subscribers, totalUsers } = getStats();
  await ctx.reply(
    `📊 *DELUXE VIP Stats*\n\n` +
      `Total revenue: *${revenue} ⭐*\n` +
      `Paid subscribers: *${subscribers}*\n` +
      `Total bot users: *${totalUsers}*`,
    { parse_mode: "Markdown" }
  );
});

bot.command("setprice", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const arg = ctx.match?.trim();
  const value = Number(arg);
  if (!arg || !Number.isInteger(value) || value <= 0) {
    return ctx.reply("Usage: /setprice <whole_number_of_stars>");
  }
  setConfig("price_stars", value);
  await ctx.reply(`✅ Price updated to ${value} ⭐`);
});

bot.command("setchannel", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const arg = ctx.match?.trim();
  if (!arg || !/^-?\d+$/.test(arg)) {
    return ctx.reply("Usage: /setchannel <numeric_channel_id> (e.g. -1001234567890)");
  }
  setConfig("channel_id", arg);
  await ctx.reply(`✅ Target channel updated to ${arg}\nMake sure the bot is an admin there with invite rights.`);
});

bot.command("broadcast", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const text = ctx.match?.trim();
  if (!text) return ctx.reply("Usage: /broadcast <message text>");

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
  await ctx.reply(`✅ Broadcast sent to ${sent}/${ids.length} subscribers.`);
});

// ---------------------------------------------------------------------------
// Telegram Stars payment flow
// ---------------------------------------------------------------------------

// 1) Telegram asks the bot to confirm the order is still valid right before charging
bot.on("pre_checkout_query", async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error("pre_checkout_query error:", err);
    await ctx.answerPreCheckoutQuery(false, "Something went wrong, please try again.");
  }
});

// 2) Payment succeeded — generate a single-use invite link and deliver it
bot.on("message:successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  const payload = payment.invoice_payload;
  const chargeId = payment.telegram_payment_charge_id;
  const channelId = getConfig("channel_id");
  const channelName = getConfig("channel_name");

  try {
    const invite = await bot.api.createChatInviteLink(channelId, {
      name: `deluxe-vip-${ctx.from.id}-${Date.now()}`,
      member_limit: 1,
      creates_join_request: false,
    });

    markPurchasePaid(payload, chargeId, invite.invite_link);

    await ctx.reply(
      `✅ *Payment confirmed!*\n\n` +
        `Welcome to *${channelName}*. Here is your personal, single-use invite link:\n\n` +
        `${invite.invite_link}\n\n` +
        `_This link works once and expires after use — don't share it._`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Failed to create invite link:", err);
    markPurchasePaid(payload, chargeId, null);
    await ctx.reply(
      "✅ Payment received, but I couldn't generate your invite link automatically. " +
        "An admin has been notified and will send it to you shortly."
    );
    for (const adminId of ADMIN_IDS) {
      try {
        await bot.api.sendMessage(
          adminId,
          `⚠️ Invite link generation failed for user ${ctx.from.id} (@${ctx.from.username || "n/a"}). Payload: ${payload}`
        );
      } catch {
        /* ignore secondary failures */
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Helper used by the HTTP API to create a Stars invoice link for the WebApp
// ---------------------------------------------------------------------------
async function createStarsInvoiceLink(telegramId) {
  const price = Number(getConfig("price_stars"));
  const channelName = getConfig("channel_name");
  const payload = `deluxevip_${telegramId}_${Date.now()}`;

  createPendingPurchase(telegramId, price, payload);

  const link = await bot.api.createInvoiceLink(
    `${channelName} Access`,
    `One-time payment for lifetime access to the ${channelName} channel.`,
    payload,
    "", // provider_token — empty string is required for Telegram Stars (XTR)
    "XTR",
    [{ label: `${channelName} Access`, amount: price }]
  );

  return { link, payload, price };
}

module.exports = { bot, createStarsInvoiceLink, isAdmin, ADMIN_IDS };
