# DELUXE VIP — Telegram Stars Mini App

A complete Telegram Mini App that sells one-time access to a private channel
("DELUXE VIP") using **Telegram Stars (XTR)**. Includes buyer checkout flow,
automatic single-use invite link delivery, and an in-app admin panel.

## Stack

- **Backend:** Node.js + [grammy](https://grammy.dev) (Telegram Bot API) + Express
- **Database:** SQLite via `better-sqlite3` (swap for Postgres/Mongo later if you need multi-instance scaling)
- **Frontend:** Plain HTML/CSS/JS using the official `telegram-web-app.js` SDK (no build step required)

## 1. Create the bot & channel

1. Talk to [@BotFather](https://t.me/BotFather), create a bot, copy the token.
2. In BotFather, run `/mybots` → your bot → **Bot Settings → Menu Button** (or `/setmenubutton`) and point it at your deployed `PUBLIC_URL`. This is what turns the "Open App" button into your Mini App.
3. Create the private "DELUXE VIP" channel, add your bot as an **admin** with the "Invite Users via Link" permission.
4. Get the channel's numeric ID (forward a channel message to [@userinfobot](https://t.me/userinfobot), or use `getChat` — it looks like `-1001234567890`).

## 2. Configure environment

```bash
cp .env.example .env
```

Fill in:

| Key | Description |
|---|---|
| `BOT_TOKEN` | From BotFather |
| `CHANNEL_ID` | Numeric ID of the private channel |
| `CHANNEL_NAME` | Display label, e.g. `DELUXE VIP` |
| `ADMIN_IDS` | Comma-separated numeric Telegram user IDs allowed in the admin panel |
| `DEFAULT_PRICE_STARS` | Starting price in Stars (integer) |
| `PUBLIC_URL` | Your deployed HTTPS URL (required for webhook + Mini App) |
| `WEBHOOK_SECRET` | Random string, verified on every incoming webhook call |
| `PORT` | Express port (default 3000) |
| `DATABASE_PATH` | SQLite file path |

## 3. Install & run

```bash
npm install
npm start
```

On boot the server registers a Telegram webhook at `PUBLIC_URL/telegram/webhook`.
For local development without a public HTTPS URL, leave `PUBLIC_URL` empty —
the bot will fall back to long polling (invoices still work, but the Menu
Button / Mini App requires HTTPS, so use a tunnel like `ngrok` or `cloudflared`
for local WebApp testing).

## 4. How the payment flow works

1. User opens the Mini App (via the bot's Menu Button or `/start`).
2. The client calls `POST /api/invoice/create`, which uses `bot.api.createInvoiceLink`
   with currency `XTR` to mint a Stars invoice link.
3. The client opens it in-app with `Telegram.WebApp.openInvoice(link, callback)` —
   Telegram shows its native Stars payment sheet, no redirect needed.
4. Telegram sends a `pre_checkout_query` to the bot; the bot approves it instantly.
5. On success, Telegram delivers a `successful_payment` service message to the bot,
   which calls `createChatInviteLink` (with `member_limit: 1`) and:
   - sends the link to the user in the chat, **and**
   - stores it in SQLite.
6. The Mini App polls `GET /api/purchase/latest` after `openInvoice` resolves
   with `"paid"`, and swaps in the success screen with the same link.

## 5. Admin panel

Any Telegram user ID listed in `ADMIN_IDS` sees an "Open admin panel" link
inside the Mini App, and can also use bot commands directly:

- `/stats` — revenue, subscriber count, total users
- `/setprice <stars>` — update the price
- `/setchannel <channel_id>` — change the target channel
- `/broadcast <text>` — message every paid subscriber

The in-app admin panel (`/api/admin/*`) mirrors all four actions with a UI,
authenticated via Telegram's signed `initData` (see `server/validateInitData.js`),
so only real admins — verified by Telegram's own HMAC signature — can call these routes.

## 6. Security notes

- `initData` is verified server-side on every request using the bot token's
  HMAC-SHA256 signature per [Telegram's spec](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
  Never trust a `user.id` sent as a plain request parameter.
- Invite links are single-use (`member_limit: 1`) so they can't be shared or reused.
- Rotate `WEBHOOK_SECRET` if you ever suspect it leaked; Telegram echoes it back
  on the `X-Telegram-Bot-Api-Secret-Token` header on every webhook call, and
  grammy's `webhookCallback` verifies it automatically.

## File structure

```
deluxe-vip-bot/
├── .env.example
├── package.json
├── server/
│   ├── index.js            # Express app: static hosting, API routes, webhook
│   ├── bot.js               # grammy bot: commands, invoice + payment handlers
│   ├── db.js                 # SQLite schema + queries
│   └── validateInitData.js  # Telegram initData HMAC verification
└── client/
    ├── index.html            # Buyer + admin views
    ├── style.css             # Dark chrome / magenta / cyan theme
    └── app.js                # Checkout flow, admin panel logic
```
