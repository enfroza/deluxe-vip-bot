const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const initData = tg?.initData || "";

const $ = (id) => document.getElementById(id);

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2600);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request_failed_${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Buyer view
// ---------------------------------------------------------------------------
let currentPrice = null;

async function loadConfig() {
  try {
    const cfg = await api("/api/config");
    currentPrice = cfg.priceStars;
    $("channel-name").textContent = cfg.channelName;
    $("price-amount").textContent = `${cfg.priceStars} ⭐`;
    document.title = cfg.channelName;
    if (cfg.isAdmin) $("admin-entry").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    toast("Couldn't load config. Try reopening the app.");
  }
}

async function checkExistingPurchase() {
  try {
    const res = await api("/api/purchase/latest");
    if (res.found) showSuccess(res.inviteLink);
  } catch {
    /* not fatal on first load */
  }
}

function showSuccess(link) {
  $("price-card").classList.add("hidden");
  $("status-panel").classList.add("hidden");
  $("success-panel").classList.remove("hidden");
  $("invite-link-input").value = link;
  $("btn-join").href = link;
  tg?.HapticFeedback?.notificationOccurred("success");
}

function setStatus(text, show = true) {
  $("status-text").textContent = text;
  $("status-panel").classList.toggle("hidden", !show);
}

async function pollForInvite(maxAttempts = 10, delayMs = 1500) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      const res = await api("/api/purchase/latest");
      if (res.found) {
        showSuccess(res.inviteLink);
        return true;
      }
    } catch {
      /* keep polling */
    }
  }
  return false;
}

async function startCheckout() {
  const btn = $("btn-pay");
  btn.disabled = true;
  $("btn-pay-label").textContent = "Preparing invoice…";

  try {
    const { link } = await api("/api/invoice/create", { method: "POST" });

    if (!tg?.openInvoice) {
      toast("Open this app inside Telegram to pay with Stars.");
      btn.disabled = false;
      $("btn-pay-label").textContent = "Unlock Access";
      return;
    }

    tg.openInvoice(link, async (status) => {
      if (status === "paid") {
        setStatus("Payment received — generating your invite…");
        tg?.HapticFeedback?.notificationOccurred("success");
        const found = await pollForInvite();
        if (!found) {
          setStatus("Payment confirmed. Your invite link is on its way in the chat — check your messages with the bot.");
        }
      } else if (status === "cancelled") {
        toast("Checkout cancelled.");
      } else if (status === "failed") {
        toast("Payment failed. Please try again.");
      }
      btn.disabled = false;
      $("btn-pay-label").textContent = "Unlock Access";
    });
  } catch (err) {
    console.error(err);
    toast("Couldn't start checkout. Please try again.");
    btn.disabled = false;
    $("btn-pay-label").textContent = "Unlock Access";
  }
}

$("btn-pay").addEventListener("click", startCheckout);

$("btn-copy").addEventListener("click", async () => {
  const val = $("invite-link-input").value;
  try {
    await navigator.clipboard.writeText(val);
    toast("Link copied");
  } catch {
    $("invite-link-input").select();
    document.execCommand("copy");
    toast("Link copied");
  }
});

// ---------------------------------------------------------------------------
// Admin view
// ---------------------------------------------------------------------------
$("btn-open-admin").addEventListener("click", () => {
  $("view-buyer").classList.add("hidden");
  $("view-admin").classList.remove("hidden");
  loadAdminStats();
});

$("btn-back").addEventListener("click", () => {
  $("view-admin").classList.add("hidden");
  $("view-buyer").classList.remove("hidden");
});

async function loadAdminStats() {
  try {
    const stats = await api("/api/admin/stats");
    $("stat-revenue").textContent = stats.revenue;
    $("stat-subs").textContent = stats.subscribers;
    $("stat-users").textContent = stats.totalUsers;
    $("input-price").value = currentPrice ?? "";

    const list = $("recent-list");
    list.innerHTML = "";
    if (!stats.recent.length) {
      list.innerHTML = `<p class="field-hint">No purchases yet.</p>`;
    }
    for (const row of stats.recent) {
      const div = document.createElement("div");
      div.className = "recent-item";
      div.innerHTML = `<span>@${row.username || row.telegram_id}</span><span>${row.amount_stars} ⭐ · ${row.paid_at}</span>`;
      list.appendChild(div);
    }
  } catch (err) {
    console.error(err);
    toast("Failed to load admin stats.");
  }
}

$("btn-save-price").addEventListener("click", async () => {
  const value = Number($("input-price").value);
  if (!Number.isInteger(value) || value <= 0) return toast("Enter a valid whole number.");
  try {
    await api("/api/admin/price", { method: "POST", body: { priceStars: value } });
    currentPrice = value;
    toast("Price updated");
  } catch {
    toast("Failed to update price.");
  }
});

$("btn-save-channel").addEventListener("click", async () => {
  const channelId = $("input-channel-id").value.trim();
  const channelName = $("input-channel-name").value.trim();
  if (!/^-?\d+$/.test(channelId)) return toast("Channel ID must be numeric.");
  try {
    await api("/api/admin/channel", { method: "POST", body: { channelId, channelName } });
    toast("Channel updated");
  } catch {
    toast("Failed to update channel.");
  }
});

$("btn-send-broadcast").addEventListener("click", async () => {
  const text = $("input-broadcast").value.trim();
  if (!text) return toast("Write a message first.");
  try {
    const res = await api("/api/admin/broadcast", { method: "POST", body: { text } });
    $("broadcast-result").textContent = `Sent to ${res.sent}/${res.total} subscribers.`;
    $("input-broadcast").value = "";
  } catch {
    toast("Broadcast failed.");
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
loadConfig().then(checkExistingPurchase);
