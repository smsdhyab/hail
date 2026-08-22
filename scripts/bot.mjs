// بوت تليغرام لإدارة مخبز ومقهى هيل — أزرار كاملة (بدون أوامر كتابية).
// تقارير المبيعات، الطلبات الآن، حالة الطاولات، الأكثر/الأقل مبيعاً، مبيعات كل
// منتج، المنتجات المتاحة، وإدارة المنتجات (إضافة/حذف/تسعير/تفعيل) من تليغرام.
// Long-polling; owner-locked via TELEGRAM_OWNER_CHAT_IDS. Data via service-role REST.
// Run: npm run bot
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv() {
  try {
    const raw = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch { /* rely on real env */ }
}
loadEnv();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNERS = (process.env.TELEGRAM_OWNER_CHAT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!TOKEN || !URL || !SVC) {
  console.error("Missing TELEGRAM_BOT_TOKEN or Supabase env in .env.local");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };
const TABLE_COUNT = 12;

// ── utils ──────────────────────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat("en-US").format(Math.round(Number(n) || 0));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const normDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
function baghdadDay(offsetDays = 0) {
  return new Date(Date.now() + 3 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
}
function agoMin(iso) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}
/** Parse a user-typed date (digits already normalized) → yyyy-MM-dd, or null.
 *  Accepts 2026-08-10, 10/08/2026, 10-08-2026, or 10/08 (current year). Rejects
 *  impossible dates and any future day. */
function parseDate(s) {
  s = s.trim();
  let y, mo, d, m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = m[1]; mo = m[2]; d = m[3]; }
  else if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/))) { d = m[1]; mo = m[2]; y = m[3]; }
  else if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})$/))) { d = m[1]; mo = m[2]; y = baghdadDay().slice(0, 4); }
  else return null;
  const yy = +y, mm = +mo, dd = +d;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const iso = `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (isNaN(dt.getTime()) || dt.getUTCDate() !== dd || dt.getUTCMonth() + 1 !== mm) return null;
  if (iso > baghdadDay()) return null;
  return iso;
}

async function tg(method, payload) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}
async function say(chatId, text, keyboard, editMessageId) {
  const payload = { chat_id: chatId, text, parse_mode: "HTML", reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined };
  if (editMessageId) {
    const r = await tg("editMessageText", { ...payload, message_id: editMessageId });
    if (r.ok) return;
  }
  await tg("sendMessage", payload);
}

// ── data (service-role REST) ───────────────────────────────────────────────
async function rest(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`REST ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}
async function restWrite(path, method, body) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method, headers: { ...H, Prefer: "return=minimal" }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${r.status}: ${(await r.text()).slice(0, 160)}`);
}
const summary = (from, to) =>
  fetch(`${URL}/rest/v1/rpc/range_summary`, { method: "POST", headers: H, body: JSON.stringify({ p_from: from, p_to: to }) }).then((r) => r.json());

async function countOrdersToday() {
  const r = await fetch(`${URL}/rest/v1/orders?business_day=eq.${baghdadDay()}&select=id`, {
    headers: { ...H, Prefer: "count=exact", Range: "0-0" },
  });
  return Number((r.headers.get("content-range") ?? "/0").split("/")[1]) || 0;
}
const pendingOrders = () =>
  rest("orders?status=eq.pending&select=order_seq,channel,table_no,subtotal,created_at&order=created_at.asc");
const todayTableOrders = () =>
  rest(`orders?business_day=eq.${baghdadDay()}&table_no=not.is.null&select=table_no,status,order_seq,created_at&order=created_at.desc`);
const soldByItem = (fromDay) =>
  rest(`order_items?select=name_ar,qty,orders!inner(status,business_day)&orders.status=eq.paid&orders.business_day=gte.${fromDay}`);
const allItems = () =>
  rest("menu_items?select=id,name_ar,price,cost,is_active,category_id&order=sort.asc");
const allCats = () => rest("categories?select=id,name_ar,sort&order=sort.asc");
const oneItem = async (id) => (await rest(`menu_items?id=eq.${id}&select=id,name_ar,price,cost,is_active,category_id`))[0];

// ── views ──────────────────────────────────────────────────────────────────
const CHANNEL_AR = { qr: "موبايل", kiosk: "لوحي", cashier: "كاشير" };
const BACK = [{ text: "⬅️ القائمة الرئيسية", callback_data: "menu" }];

function mainMenu() {
  return [
    [{ text: "📊 اليوم", callback_data: "rpt|0" }, { text: "📅 الأسبوع", callback_data: "rpt|6" }, { text: "🗓️ الشهر", callback_data: "rpt|29" }],
    [{ text: "📆 مبيعات أمس", callback_data: "day|1" }, { text: "🔎 مبيعات بتاريخ", callback_data: "search" }],
    [{ text: "🧾 الطلبات الآن", callback_data: "now" }, { text: "🍽️ الطاولات", callback_data: "tables" }],
    [{ text: "🔥 الأكثر والأقل مبيعاً", callback_data: "top" }, { text: "📃 مبيعات كل منتج", callback_data: "counts" }],
    [{ text: "📋 المنتجات المتاحة", callback_data: "avail" }, { text: "⚙️ إدارة المنتجات", callback_data: "pcats" }],
    [{ text: "🌙 التقرير اليومي النهائي", callback_data: "final" }],
  ];
}

async function viewReport(days) {
  const to = baghdadDay(), from = baghdadDay(-days);
  const rows = await summary(from, to);
  const t = (Array.isArray(rows) ? rows : []).reduce(
    (a, d) => ({ s: a.s + +d.sales, c: a.c + +d.orders_count, p: a.p + +d.profit, e: a.e + +d.expenses, n: a.n + +d.net }),
    { s: 0, c: 0, p: 0, e: 0, n: 0 },
  );
  const title = days === 0 ? `اليوم ${to}` : days === 6 ? "آخر ٧ أيام" : "آخر ٣٠ يوماً";
  return [
    `☕️ <b>مخبز ومقهى هيل — ${title}</b>`,
    "",
    `🧾 الطلبات: <b>${t.c}</b>`,
    `💰 المبيعات: <b>${fmt(t.s)} د.ع</b>`,
    `📈 الأرباح: <b>${fmt(t.p)} د.ع</b>`,
    `📉 المصروفات: <b>${fmt(t.e)} د.ع</b>`,
    `✅ الصافي: <b>${fmt(t.n)} د.ع</b>`,
  ].join("\n");
}

/** Full totals for one business day — for reconciling the drawer with a day that
 *  has already rolled over past midnight (business_day is a Baghdad calendar day). */
async function viewDaySummary(day) {
  const rows = await summary(day, day);
  const t = (Array.isArray(rows) ? rows : []).reduce(
    (a, d) => ({ s: a.s + +d.sales, c: a.c + +d.orders_count, p: a.p + +d.profit, e: a.e + +d.expenses, n: a.n + +d.net }),
    { s: 0, c: 0, p: 0, e: 0, n: 0 },
  );
  const suffix = day === baghdadDay(-1) ? " (أمس)" : day === baghdadDay() ? " (اليوم)" : "";
  return [
    `📆 <b>مبيعات يوم ${day}${suffix}</b>`, "",
    `🧾 الطلبات: <b>${t.c}</b>`,
    `💰 المبيعات: <b>${fmt(t.s)} د.ع</b>`,
    `📈 الأرباح: <b>${fmt(t.p)} د.ع</b>`,
    `📉 المصروفات: <b>${fmt(t.e)} د.ع</b>`,
    `✅ الصافي: <b>${fmt(t.n)} د.ع</b>`,
  ].join("\n");
}

async function viewNow() {
  const [pending, total] = await Promise.all([pendingOrders(), countOrdersToday()]);
  const lines = [`🧾 <b>الطلبات الآن</b>`, "", `المعلّقة (بانتظار الدفع): <b>${pending.length}</b>`];
  for (const o of pending.slice(0, 15)) {
    lines.push(
      `#${String(o.order_seq).padStart(3, "0")} — ${CHANNEL_AR[o.channel] ?? o.channel}${o.table_no ? ` — طاولة ${esc(o.table_no)}` : ""} — <b>${fmt(o.subtotal)} د.ع</b> (قبل ${agoMin(o.created_at)} د)`,
    );
  }
  if (pending.length === 0) lines.push("لا يوجد طلبات معلّقة ✅");
  lines.push("", `إجمالي طلبات اليوم: <b>${total}</b>`);
  return lines.join("\n");
}

async function viewTables() {
  const rows = await todayTableOrders();
  const latest = new Map(); // table → latest order (rows are desc)
  for (const o of rows) if (!latest.has(o.table_no)) latest.set(o.table_no, o);
  const lines = [`🍽️ <b>حالة الطاولات — اليوم</b>`, ""];
  const empty = [];
  for (let n = 1; n <= TABLE_COUNT; n++) {
    const o = latest.get(String(n));
    if (!o) { empty.push(n); continue; }
    const age = agoMin(o.created_at);
    if (o.status === "pending") lines.push(`🔴 طاولة ${n}: طلب #${String(o.order_seq).padStart(3, "0")} بانتظار الدفع (قبل ${age} د)`);
    else if (o.status === "paid" && age <= 60) lines.push(`🟢 طاولة ${n}: مشغولة — دُفع قبل ${age} د`);
    else empty.push(n);
  }
  // any table label outside 1..TABLE_COUNT
  for (const [t, o] of latest) if (!/^\d+$/.test(t) || +t > TABLE_COUNT) {
    if (o.status === "pending" || agoMin(o.created_at) <= 60) lines.push(`🟡 طاولة ${esc(t)}: ${o.status === "pending" ? "بانتظار الدفع" : "مشغولة"}`);
  }
  lines.push("", empty.length === TABLE_COUNT ? "كل الطاولات فارغة." : `الطاولات الفارغة: ${empty.join("، ") || "لا شيء"}`);
  return lines.join("\n");
}

async function aggregateSold(fromDay) {
  const [sold, items] = await Promise.all([soldByItem(fromDay), allItems()]);
  const byName = new Map();
  for (const it of items) if (it.is_active) byName.set(it.name_ar, 0);
  for (const s of Array.isArray(sold) ? sold : []) byName.set(s.name_ar, (byName.get(s.name_ar) ?? 0) + s.qty);
  return [...byName.entries()].sort((a, b) => b[1] - a[1]);
}

async function viewTop() {
  const sorted = await aggregateSold(baghdadDay(-29));
  const total = sorted.reduce((s, [, q]) => s + q, 0);
  const top = sorted.slice(0, 5);
  const least = sorted.slice(-5).reverse();
  const lines = [`🔥 <b>الأكثر مبيعاً — آخر ٣٠ يوماً</b>`, ""];
  top.forEach(([n, q], i) => lines.push(`${i + 1}. ${esc(n)} — <b>${q}</b>`));
  lines.push("", `📉 <b>الأقل طلباً</b>`);
  least.forEach(([n, q]) => lines.push(`• ${esc(n)} — <b>${q}</b>`));
  lines.push("", `📦 مجموع القطع المباعة: <b>${total}</b>`);
  return lines.join("\n");
}

async function viewCounts() {
  const sorted = await aggregateSold(baghdadDay(-29));
  const lines = [`📃 <b>مبيعات كل منتج — آخر ٣٠ يوماً</b>`, ""];
  sorted.forEach(([n, q]) => lines.push(`${esc(n)} — <b>${q}</b>`));
  return lines.join("\n").slice(0, 4000);
}

async function viewAvail() {
  const [items, cats] = await Promise.all([allItems(), allCats()]);
  const lines = [`📋 <b>المنتجات المتاحة حالياً</b>`, ""];
  let off = 0;
  for (const c of cats) {
    const act = items.filter((i) => i.category_id === c.id && i.is_active);
    off += items.filter((i) => i.category_id === c.id && !i.is_active).length;
    if (!act.length) continue;
    lines.push(`<b>${esc(c.name_ar)}</b>`);
    for (const i of act) lines.push(`• ${esc(i.name_ar)} — ${fmt(i.price)} د.ع`);
    lines.push("");
  }
  lines.push(off ? `⛔ معطّل حالياً: ${off} منتج (من إدارة المنتجات)` : "كل المنتجات مفعّلة ✅");
  return lines.join("\n").slice(0, 4000);
}

async function kbCategories() {
  const cats = await allCats();
  const rows = cats.map((c) => [{ text: c.name_ar, callback_data: `pcat|${c.id}` }]);
  rows.push(BACK);
  return rows;
}
async function kbItems(catId) {
  const items = (await allItems()).filter((i) => i.category_id === catId);
  const rows = items.map((i) => [{ text: `${i.is_active ? "" : "⛔ "}${i.name_ar} — ${fmt(i.price)}`, callback_data: `pitem|${i.id}` }]);
  rows.push([{ text: "➕ إضافة منتج هنا", callback_data: `padd|${catId}` }]);
  rows.push([{ text: "⬅️ الأقسام", callback_data: "pcats" }, ...BACK]);
  return rows;
}
function kbItem(it) {
  return [
    [{ text: "💰 تعديل السعر", callback_data: `pset|${it.id}|price` }, { text: "🏷️ تعديل الكلفة", callback_data: `pset|${it.id}|cost` }],
    [{ text: it.is_active ? "⛔ تعطيل" : "✅ تفعيل", callback_data: `ptog|${it.id}` }, { text: "🗑️ حذف", callback_data: `pdel|${it.id}` }],
    [{ text: "⬅️ رجوع", callback_data: `pcat|${it.category_id}` }, ...BACK],
  ];
}
const itemText = (it) =>
  [`⚙️ <b>${esc(it.name_ar)}</b>`, "", `💰 السعر: <b>${fmt(it.price)} د.ع</b>`, `🏷️ الكلفة: <b>${fmt(it.cost)} د.ع</b>`, `الحالة: ${it.is_active ? "مفعّل ✅" : "معطّل ⛔"}`].join("\n");

// ── nightly report (23:59 Baghdad, sent to every owner) ────────────────────
async function viewDailyFinal() {
  const today = baghdadDay();
  const rows = await summary(today, today);
  const t = (Array.isArray(rows) ? rows : []).reduce(
    (a, d) => ({ s: a.s + +d.sales, c: a.c + +d.orders_count, p: a.p + +d.profit, e: a.e + +d.expenses, n: a.n + +d.net }),
    { s: 0, c: 0, p: 0, e: 0, n: 0 },
  );
  const sold = (await aggregateSold(today)).filter(([, q]) => q > 0);
  const lines = [
    `🌙 <b>التقرير اليومي النهائي — ${today}</b>`,
    "",
    `🧾 عدد الطلبات: <b>${t.c}</b>`,
    `💰 المبيعات: <b>${fmt(t.s)} د.ع</b>`,
    `📈 الأرباح: <b>${fmt(t.p)} د.ع</b>`,
    `📉 المصروفات: <b>${fmt(t.e)} د.ع</b>`,
    `✅ الصافي: <b>${fmt(t.n)} د.ع</b>`,
    "",
    `☕️ <b>الأصناف المباعة اليوم (${sold.reduce((s, [, q]) => s + q, 0)} قطعة):</b>`,
  ];
  if (sold.length === 0) lines.push("لا مبيعات اليوم.");
  else sold.forEach(([n, q]) => lines.push(`• ${esc(n)} — <b>${q}</b>`));
  return lines.join("\n").slice(0, 4000);
}

let lastReportDay = null;
setInterval(async () => {
  const bag = new Date(Date.now() + 3 * 3600e3); // Baghdad = UTC+3, no DST
  const hhmm = bag.toISOString().slice(11, 16);
  const day = bag.toISOString().slice(0, 10);
  if (hhmm === "23:59" && lastReportDay !== day) {
    lastReportDay = day;
    try {
      const text = await viewDailyFinal();
      for (const o of OWNERS) await say(o, text, [BACK]);
      console.log(`✓ nightly report sent for ${day}`);
    } catch (e) {
      console.error("nightly report error:", e.message);
    }
  }
}, 30000);

// ── conversational state (price/cost/add inputs) ───────────────────────────
const pendingInput = new Map(); // chatId → {action, itemId?, categoryId?}

// ── main loop ──────────────────────────────────────────────────────────────
console.log("✓ bot v2 (buttons) started…");
await fetch(`${API}/deleteWebhook`).catch(() => {});
let offset = 0;

for (;;) {
  try {
    const r = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}&allowed_updates=%5B%22message%22%2C%22callback_query%22%5D`);
    const j = await r.json();
    for (const u of j.result ?? []) {
      offset = u.update_id + 1;
      try {
        if (u.callback_query) await onCallback(u.callback_query);
        else if (u.message?.text) await onMessage(u.message);
      } catch (e) {
        console.error("handle error:", e.message);
        const chatId = u.callback_query?.message?.chat?.id ?? u.message?.chat?.id;
        if (chatId) await say(chatId, `تعذّر تنفيذ العملية: ${esc(e.message).slice(0, 150)}`, [BACK]);
      }
    }
  } catch (e) {
    console.error("poll error:", e.message);
    await new Promise((res) => setTimeout(res, 3000));
  }
}

function authorized(chatId) {
  return !OWNERS.length || OWNERS.includes(String(chatId));
}

async function onMessage(msg) {
  const chatId = msg.chat.id;
  console.log(`msg from ${chatId} (${msg.from?.first_name ?? "?"}): ${msg.text}`);
  if (!authorized(chatId)) {
    await say(chatId, `غير مصرّح لك بهذا البوت.\nمعرّفك: <code>${chatId}</code>`);
    return;
  }

  const state = pendingInput.get(chatId);
  if (state) {
    pendingInput.delete(chatId);
    const text = normDigits(msg.text.trim());

    if (state.action === "searchdate") {
      const day = parseDate(text);
      if (!day) {
        await say(chatId, "تاريخ غير صالح — أرسل مثل: <code>2026-08-10</code> أو <code>10/08/2026</code>", [[{ text: "🔎 حاول مجدداً", callback_data: "search" }], BACK]);
        return;
      }
      await say(chatId, await viewDaySummary(day), [[{ text: "🔄 تحديث", callback_data: `dayx|${day}` }], BACK]);
      return;
    }
    if (state.action === "price" || state.action === "cost") {
      const val = Math.round(Number(text.replace(/[^\d.]/g, "")));
      if (!Number.isFinite(val) || val < 0) { await say(chatId, "قيمة غير صالحة — أرسل رقماً مثل: 3500", [BACK]); return; }
      await restWrite(`menu_items?id=eq.${state.itemId}`, "PATCH", { [state.action]: val });
      const it = await oneItem(state.itemId);
      await say(chatId, `تم التحديث ✅\n\n${itemText(it)}`, kbItem(it));
      return;
    }
    if (state.action === "add") {
      const parts = text.split(/\s+/);
      const price = Math.round(Number(parts[parts.length - 1]));
      const name = parts.slice(0, -1).join(" ").trim();
      if (!name || !Number.isFinite(price) || price <= 0) {
        await say(chatId, "الصيغة: <i>اسم المنتج ثم السعر</i>\nمثال: <code>موهيتو رمان 4000</code>", [BACK]);
        return;
      }
      await restWrite("menu_items", "POST", { category_id: state.categoryId, name_ar: name, price, cost: 0, is_active: true, sort: 99 });
      await say(chatId, `تمت إضافة <b>${esc(name)}</b> بسعر <b>${fmt(price)} د.ع</b> ✅\n(الكلفة 0 — عدّلها من إدارة المنتجات)`, await kbItems(state.categoryId));
      return;
    }
  }

  await say(chatId, "☕️ <b>مخبز ومقهى هيل — لوحة التحكم</b>\nاختر من الأزرار:", mainMenu());
}

async function onCallback(cb) {
  const chatId = cb.message.chat.id;
  const mid = cb.message.message_id;
  await tg("answerCallbackQuery", { callback_query_id: cb.id });
  if (!authorized(chatId)) return;
  pendingInput.delete(chatId); // any navigation cancels a pending input

  const [cmd, a, b] = cb.data.split("|");

  if (cmd === "menu") return say(chatId, "☕️ <b>مخبز ومقهى هيل — لوحة التحكم</b>\nاختر من الأزرار:", mainMenu(), mid);
  if (cmd === "rpt") return say(chatId, await viewReport(Number(a)), [[{ text: "🔄 تحديث", callback_data: cb.data }], BACK], mid);
  if (cmd === "day") return say(chatId, await viewDaySummary(baghdadDay(-Number(a))), [[{ text: "🔄 تحديث", callback_data: cb.data }], BACK], mid);
  if (cmd === "dayx") return say(chatId, await viewDaySummary(a), [[{ text: "🔄 تحديث", callback_data: cb.data }], BACK], mid);
  if (cmd === "search") {
    pendingInput.set(chatId, { action: "searchdate" });
    return say(chatId, "🔎 أرسل التاريخ المطلوب:\nمثال: <code>2026-08-10</code> أو <code>10/08/2026</code>", [[{ text: "إلغاء", callback_data: "menu" }]], mid);
  }
  if (cmd === "now") return say(chatId, await viewNow(), [[{ text: "🔄 تحديث", callback_data: "now" }], BACK], mid);
  if (cmd === "tables") return say(chatId, await viewTables(), [[{ text: "🔄 تحديث", callback_data: "tables" }], BACK], mid);
  if (cmd === "final") return say(chatId, await viewDailyFinal(), [[{ text: "🔄 تحديث", callback_data: "final" }], BACK], mid);
  if (cmd === "top") return say(chatId, await viewTop(), [BACK], mid);
  if (cmd === "counts") return say(chatId, await viewCounts(), [BACK], mid);
  if (cmd === "avail") return say(chatId, await viewAvail(), [BACK], mid);

  if (cmd === "pcats") return say(chatId, "⚙️ <b>إدارة المنتجات</b> — اختر القسم:", await kbCategories(), mid);
  if (cmd === "pcat") return say(chatId, "اختر منتجاً لإدارته:", await kbItems(a), mid);
  if (cmd === "pitem") { const it = await oneItem(a); return say(chatId, itemText(it), kbItem(it), mid); }
  if (cmd === "ptog") {
    const it = await oneItem(a);
    await restWrite(`menu_items?id=eq.${a}`, "PATCH", { is_active: !it.is_active });
    const upd = await oneItem(a);
    return say(chatId, `${upd.is_active ? "تم التفعيل ✅" : "تم التعطيل ⛔"}\n\n${itemText(upd)}`, kbItem(upd), mid);
  }
  if (cmd === "pset") {
    pendingInput.set(chatId, { action: b, itemId: a });
    const it = await oneItem(a);
    return say(chatId, `أرسل ${b === "price" ? "السعر الجديد" : "الكلفة الجديدة"} لـ<b>${esc(it.name_ar)}</b> (رقم فقط):`, [[{ text: "إلغاء", callback_data: `pitem|${a}` }]], mid);
  }
  if (cmd === "padd") {
    pendingInput.set(chatId, { action: "add", categoryId: a });
    return say(chatId, "أرسل: <i>اسم المنتج ثم السعر</i>\nمثال: <code>موهيتو رمان 4000</code>", [[{ text: "إلغاء", callback_data: `pcat|${a}` }]], mid);
  }
  if (cmd === "pdel") {
    const it = await oneItem(a);
    return say(chatId, `حذف <b>${esc(it.name_ar)}</b> نهائياً؟\n(يمكنك تعطيله بدلاً من الحذف)`,
      [[{ text: "🗑️ نعم، احذف", callback_data: `pdelok|${a}` }, { text: "إلغاء", callback_data: `pitem|${a}` }]], mid);
  }
  if (cmd === "pdelok") {
    const it = await oneItem(a);
    await restWrite(`menu_items?id=eq.${a}`, "DELETE");
    return say(chatId, `تم حذف <b>${esc(it.name_ar)}</b> 🗑️`, await kbItems(it.category_id), mid);
  }
}
