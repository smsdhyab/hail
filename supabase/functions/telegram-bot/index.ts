// بوت مخبز ومقهى هيل — Supabase Edge Function (Telegram webhook, يعمل 24/7).
// نفس بوت الأزرار الكامل: تقارير، الطلبات الآن، الطاولات، الأكثر/الأقل مبيعاً،
// إدارة المنتجات (إضافة/حذف/تسعير/تفعيل) — والحالة الحوارية محفوظة في bot_state.
// GET/POST ?job=daily (بسر x-job-secret) يرسل التقرير الليلي — يستدعيه pg_cron
// الساعة 23:59 بغداد. Deploy: supabase functions deploy telegram-bot --no-verify-jwt
/// <reference lib="deno.ns" />

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const OWNERS = (Deno.env.get("TG_OWNER_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const HOOK_SECRET = Deno.env.get("TG_WEBHOOK_SECRET") ?? "";
const URL_ = Deno.env.get("SUPABASE_URL")!;
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const API = `https://api.telegram.org/bot${TOKEN}`;
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };
const TABLE_COUNT = 12;

// ── utils ──────────────────────────────────────────────────────────────────
const fmt = (n: unknown) => new Intl.NumberFormat("en-US").format(Math.round(Number(n) || 0));
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const normDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const baghdadDay = (offsetDays = 0) =>
  new Date(Date.now() + 3 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const agoMin = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
/** Parse a user-typed date (digits already normalized) into yyyy-MM-dd, or null.
 *  Accepts 2026-08-10, 10/08/2026, 10-08-2026, or 10/08 (current year). Rejects
 *  impossible dates (e.g. 31/02) and any date in the future. */
function parseDate(s: string): string | null {
  s = s.trim();
  let y = "", mo = "", d = "";
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = m[1]; mo = m[2]; d = m[3]; }
  else if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/))) { d = m[1]; mo = m[2]; y = m[3]; }
  else if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})$/))) { d = m[1]; mo = m[2]; y = baghdadDay().slice(0, 4); }
  else return null;
  const yy = +y, mm = +mo, dd = +d;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const iso = `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (isNaN(dt.getTime()) || dt.getUTCDate() !== dd || dt.getUTCMonth() + 1 !== mm) return null;
  if (iso > baghdadDay()) return null; // no future days
  return iso;
}

async function tg(method: string, payload: Record<string, unknown>) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}
async function say(chatId: number | string, text: string, keyboard?: unknown[][], editMessageId?: number) {
  const payload: Record<string, unknown> = {
    chat_id: chatId, text, parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  };
  if (editMessageId) {
    const r = await tg("editMessageText", { ...payload, message_id: editMessageId });
    if (r.ok) return;
  }
  await tg("sendMessage", payload);
}

// ── data (service-role REST) ───────────────────────────────────────────────
async function rest(path: string) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`REST ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}
// paginated GET — PostgREST caps a single response at 1000 rows, so page with
// Range until a short page is returned (used for wide item aggregations).
async function restAll(path: string): Promise<any[]> {
  const rows: any[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + size - 1}` } });
    if (!r.ok) throw new Error(`REST ${r.status}: ${(await r.text()).slice(0, 120)}`);
    const chunk = await r.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < size) break;
  }
  return rows;
}
async function restWrite(path: string, method: string, body?: unknown) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method, headers: { ...H, Prefer: "return=minimal" }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${r.status}: ${(await r.text()).slice(0, 160)}`);
}
/** p_station null = the whole shop (the manager's unified view). */
const summary = (from: string, to: string, station: string | null = null) =>
  fetch(`${URL_}/rest/v1/rpc/range_summary`, {
    method: "POST", headers: H, body: JSON.stringify({ p_from: from, p_to: to, p_station: station }),
  }).then((r) => r.json());

/** The two registers keep separate books; the manager sees the total AND the
 *  split. Returns the «حسب الكاشير» lines appended to every money report. */
async function stationLines(from: string, to: string) {
  const stations = (await rest("stations?select=slug,name_ar&order=sort.asc")) as Row[];
  const parts = await Promise.all(stations.map((st) => summary(from, to, String(st.slug))));
  const out = ["", "🏷️ <b>حسب الكاشير</b>"];
  stations.forEach((st, i) => {
    const t = sumRows(parts[i]);
    out.push(`• ${esc(st.name_ar)}: <b>${fmt(t.s)} د.ع</b> — ${t.c} طلب`);
  });
  return out;
}

/** One customer ticket = one order, however many registers it touched. */
async function countOrdersToday() {
  const rows = (await restAll(`orders?business_day=eq.${baghdadDay()}&select=group_no`)) as Row[];
  return new Set(rows.map((o) => o.group_no)).size;
}
const pendingOrders = () =>
  rest("orders?status=eq.pending&select=group_no,channel,table_no,floor,subtotal,created_at,stations(name_ar)&order=created_at.asc");
const todayTableOrders = () =>
  rest(`orders?business_day=eq.${baghdadDay()}&table_no=not.is.null&select=table_no,status,group_no,created_at&order=created_at.desc`);
const soldByItem = (fromDay: string) =>
  restAll(`order_items?select=name_ar,qty,orders!inner(status,business_day)&orders.status=eq.paid&orders.business_day=gte.${fromDay}`);
const allItems = () => rest("menu_items?select=id,name_ar,price,cost,is_active,category_id&order=sort.asc");
const rpc = (fn: string, args: unknown) =>
  fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) }).then((r) => r.json());
const stockRows = (lowOnly = false) =>
  rest(`inventory_view?select=item_id,name_ar,category_name,qty,unit,low_at,is_low${lowOnly ? "&is_low=eq.true" : ""}&order=category_name.asc,name_ar.asc`);
const allCats = () => rest("categories?select=id,name_ar,sort,stations(name_ar)&order=sort.asc");
const oneItem = async (id: string) =>
  (await rest(`menu_items?id=eq.${id}&select=id,name_ar,price,cost,is_active,category_id`))[0];

// conversational state, persisted (edge functions are stateless)
async function getState(chatId: number | string) {
  const rows = await rest(`bot_state?chat_id=eq.${chatId}&select=state`);
  return rows[0]?.state ?? null;
}
async function setState(chatId: number | string, state: unknown) {
  await restWrite("bot_state?on_conflict=chat_id", "POST", [{ chat_id: String(chatId), state }]);
}
async function clearState(chatId: number | string) {
  await restWrite(`bot_state?chat_id=eq.${chatId}`, "DELETE");
}

// ── views ──────────────────────────────────────────────────────────────────
const CHANNEL_AR: Record<string, string> = { qr: "موبايل", kiosk: "لوحي", cashier: "كاشير" };
const BACK = [{ text: "⬅️ القائمة الرئيسية", callback_data: "menu" }];

function mainMenu() {
  return [
    [{ text: "📊 اليوم", callback_data: "rpt|0" }, { text: "📅 الأسبوع", callback_data: "rpt|6" }, { text: "🗓️ الشهر", callback_data: "rpt|29" }],
    [{ text: "📆 مبيعات أمس", callback_data: "day|1" }, { text: "🔎 مبيعات بتاريخ", callback_data: "search" }],
    [{ text: "🧾 الطلبات الآن", callback_data: "now" }, { text: "🍽️ الطاولات", callback_data: "tables" }],
    [{ text: "🔥 الأكثر والأقل مبيعاً", callback_data: "top" }, { text: "📃 مبيعات كل منتج", callback_data: "counts" }],
    [{ text: "📋 الأصناف المتاحة", callback_data: "avail" }, { text: "⚙️ إدارة الأصناف", callback_data: "pcats" }],
    [{ text: "📦 المخزون", callback_data: "stock" }, { text: "⚠️ النواقص", callback_data: "low" }],
    [{ text: "🎁 العروض", callback_data: "offers" }, { text: "🥐 المعجنات", callback_data: "pastry" }],
    [{ text: "🪑 أكثر الطاولات طلباً", callback_data: "tabtop|29" }, { text: "📅 تقرير العدد اليومي", callback_data: "dcount|6" }],
    [{ text: "⚖️ مقارنة الكاشيرين", callback_data: "vs|6" }],
    [{ text: "🌙 التقرير اليومي النهائي", callback_data: "final" }, { text: "📉 إضافة مصروف", callback_data: "expadd" }],
  ];
}

type Row = Record<string, any>;
function sumRows(rows: Row[]) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (a, d) => ({ s: a.s + +d.sales, c: a.c + +d.orders_count, p: a.p + +d.profit, e: a.e + +d.expenses, n: a.n + +d.net }),
    { s: 0, c: 0, p: 0, e: 0, n: 0 },
  );
}

async function viewReport(days: number) {
  const to = baghdadDay(), from = baghdadDay(-days);
  const t = sumRows(await summary(from, to));
  const title = days === 0 ? `اليوم ${to}` : days === 6 ? "آخر ٧ أيام" : "آخر ٣٠ يوماً";
  return [
    `☕️ <b>مخبز ومقهى هيل — ${title}</b>`, "",
    `🧾 الطلبات: <b>${t.c}</b>`,
    `💰 المبيعات: <b>${fmt(t.s)} د.ع</b>`,
    `📈 الأرباح: <b>${fmt(t.p)} د.ع</b>`,
    `📉 المصروفات: <b>${fmt(t.e)} د.ع</b>`,
    `✅ الصافي: <b>${fmt(t.n)} د.ع</b>`,
  ].join("\n");
}

/** Full totals for one business day — for reconciling the drawer with a day that
 *  has already rolled over past midnight (business_day is a Baghdad calendar day). */
async function viewDaySummary(day: string) {
  const [t, per] = [sumRows(await summary(day, day)), await stationLines(day, day)];
  const suffix = day === baghdadDay(-1) ? " (أمس)" : day === baghdadDay() ? " (اليوم)" : "";
  return [
    `📆 <b>مبيعات يوم ${day}${suffix}</b>`, "",
    `🧾 الطلبات: <b>${t.c}</b>`,
    `💰 المبيعات: <b>${fmt(t.s)} د.ع</b>`,
    `📈 الأرباح: <b>${fmt(t.p)} د.ع</b>`,
    `📉 المصروفات: <b>${fmt(t.e)} د.ع</b>`,
    `✅ الصافي: <b>${fmt(t.n)} د.ع</b>`,
    ...per,
  ].join("\n");
}

async function viewNow() {
  const [pending, total] = await Promise.all([pendingOrders(), countOrdersToday()]);
  const lines = [`🧾 <b>الطلبات الآن</b>`, "", `المعلّقة (بانتظار الدفع): <b>${pending.length}</b>`];
  for (const o of pending.slice(0, 15)) {
    const st = (o.stations as Row | null)?.name_ar;
    const where = o.table_no ? ` — طاولة ${esc(o.table_no)}${o.floor ? ` (ط${o.floor})` : ""}` : "";
    lines.push(
      `#${String(o.group_no).padStart(3, "0")}${st ? ` · ${esc(st)}` : ""} — ${CHANNEL_AR[o.channel] ?? o.channel}${where} — <b>${fmt(o.subtotal)} د.ع</b> (قبل ${agoMin(o.created_at)} د)`,
    );
  }
  if (pending.length === 0) lines.push("لا يوجد طلبات معلّقة ✅");
  lines.push("", `إجمالي طلبات اليوم: <b>${total}</b>`);
  return lines.join("\n");
}

async function viewTables() {
  const [rows, cfg] = await Promise.all([
    todayTableOrders(),
    rest("cafe_tables?select=name,active,sort&active=eq.true&order=sort.asc"),
  ]);
  const names: string[] = (cfg as Row[]).map((t) => String(t.name));
  const tableNames = names.length ? names : Array.from({ length: TABLE_COUNT }, (_, i) => String(i + 1));
  const label = (t: string) => (/^\d+$/.test(t) ? `طاولة ${t}` : t);

  const latest = new Map<string, Row>();
  for (const o of rows) if (!latest.has(o.table_no)) latest.set(o.table_no, o);
  const lines = [`🍽️ <b>حالة الطاولات — اليوم</b>`, ""];
  const empty: string[] = [];
  for (const t of tableNames) {
    const o = latest.get(t);
    if (!o) { empty.push(label(t)); continue; }
    const age = agoMin(o.created_at);
    if (o.status === "pending") lines.push(`🔴 ${label(t)}: طلب #${String(o.group_no).padStart(3, "0")} بانتظار الدفع (قبل ${age} د)`);
    else if (o.status === "paid" && age <= 60) lines.push(`🟢 ${label(t)}: مشغولة — دُفع قبل ${age} د`);
    else empty.push(label(t));
  }
  // orders on tables not in the active layout
  for (const [t, o] of latest) {
    if (!tableNames.includes(t) && (o.status === "pending" || agoMin(o.created_at) <= 60)) {
      lines.push(`🟡 ${label(t)}: ${o.status === "pending" ? "بانتظار الدفع" : "مشغولة"}`);
    }
  }
  lines.push("", empty.length === tableNames.length ? "كل الطاولات فارغة." : `الطاولات الفارغة: ${empty.join("، ") || "لا شيء"}`);
  return lines.join("\n");
}

async function aggregateSold(fromDay: string) {
  const [sold, items] = await Promise.all([soldByItem(fromDay), allItems()]);
  const byName = new Map<string, number>();
  for (const it of items) if (it.is_active) byName.set(it.name_ar, 0);
  for (const s of Array.isArray(sold) ? sold : []) byName.set(s.name_ar, (byName.get(s.name_ar) ?? 0) + s.qty);
  return [...byName.entries()].sort((a, b) => b[1] - a[1]);
}

async function viewTop() {
  const sorted = await aggregateSold(baghdadDay(-29));
  const total = sorted.reduce((s, [, q]) => s + q, 0);
  const lines = [`🔥 <b>الأكثر مبيعاً — آخر ٣٠ يوماً</b>`, ""];
  sorted.slice(0, 5).forEach(([n, q], i) => lines.push(`${i + 1}. ${esc(n)} — <b>${q}</b>`));
  lines.push("", `📉 <b>الأقل طلباً</b>`);
  sorted.slice(-5).reverse().forEach(([n, q]) => lines.push(`• ${esc(n)} — <b>${q}</b>`));
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
    const act = items.filter((i: Row) => i.category_id === c.id && i.is_active);
    off += items.filter((i: Row) => i.category_id === c.id && !i.is_active).length;
    if (!act.length) continue;
    lines.push(`<b>${esc(c.name_ar)}</b>`);
    for (const i of act) lines.push(`• ${esc(i.name_ar)} — ${fmt(i.price)} د.ع`);
    lines.push("");
  }
  lines.push(off ? `⛔ معطّل حالياً: ${off} منتج` : "كل المنتجات مفعّلة ✅");
  return lines.join("\n").slice(0, 4000);
}

async function viewDailyFinal() {
  const today = baghdadDay();
  const t = sumRows(await summary(today, today));
  const per = await stationLines(today, today);
  const sold = (await aggregateSold(today)).filter(([, q]) => q > 0);
  const guests = sold.reduce((s, [, q]) => s + q, 0); // one item ≈ one guest
  const closure = (await rest(`register_closures?business_day=eq.${today}&select=remaining,note`))[0];
  // pastries expiring within 1 day (shelf life from deposit date)
  const batches = await rest(`pastry_batches?active=eq.true&select=item_name,deposited_on,shelf_days`);
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const expiring = (batches as Row[]).filter((b) => {
    const exp = new Date(`${b.deposited_on}T00:00:00Z`);
    exp.setUTCDate(exp.getUTCDate() + (b.shelf_days ?? 6));
    return (exp.getTime() - todayMs) / 86_400_000 <= 1;
  });
  const lines = [
    `🌙 <b>التقرير اليومي النهائي — ${today}</b>`, "",
    `🧾 عدد الطلبات: <b>${t.c}</b>`,
    `👥 عدد الزبائن (تقديري): <b>${guests}</b>`,
    `💰 المبيعات: <b>${fmt(t.s)} د.ع</b>`,
    `📈 الأرباح: <b>${fmt(t.p)} د.ع</b>`,
    `📉 المصروفات: <b>${fmt(t.e)} د.ع</b>`,
    `✅ الصافي: <b>${fmt(t.n)} د.ع</b>`,
    closure
      ? `🏦 المتبقي في الصندوق: <b>${fmt(closure.remaining)} د.ع</b>${closure.note ? ` — ${esc(closure.note)}` : ""}`
      : `🏦 المتبقي في الصندوق: لم يُسجَّل (يُدخل من صفحة المصروفات)`,
    ...(expiring.length ? [`🥐 معجنات قاربت الانتهاء: <b>${expiring.map((b) => esc(b.item_name)).join("، ")}</b> — قدّمها كعرض اليوم`] : []),
    "",
    `☕️ <b>الأصناف المباعة اليوم (${sold.reduce((s, [, q]) => s + q, 0)} قطعة):</b>`,
  ];
  if (sold.length === 0) lines.push("لا مبيعات اليوم.");
  else sold.forEach(([n, q]) => lines.push(`• ${esc(n)} — <b>${q}</b>`));
  return lines.join("\n").slice(0, 4000);
}


/** 📦 المخزون — الكميات مجمّعة حسب القسم. صنف بلا صف مخزون لا يُتتبَّع. */
async function viewStock() {
  const rows = (await stockRows()) as Row[];
  if (!rows.length) {
    return "📦 <b>المخزون</b>\n\nلا يوجد صنف مُتتبَّع بعد.\nافتح «⚙️ إدارة الأصناف» ← اختر صنفاً ← «📦 المخزون» لإدخال أول كمية.";
  }
  const lines = ["📦 <b>المخزون</b>", ""];
  let cat = "";
  for (const r of rows) {
    if (r.category_name !== cat) { cat = String(r.category_name); lines.push("", `<b>${esc(cat)}</b>`); }
    lines.push(`${r.is_low ? "⚠️" : "•"} ${esc(r.name_ar)} — <b>${fmt(r.qty)}</b> ${esc(r.unit)}${r.is_low ? ` (الحدّ ${r.low_at})` : ""}`);
  }
  const low = rows.filter((r) => r.is_low).length;
  lines.push("", low ? `⚠️ ${low} صنف عند حدّ النقص أو تحته` : "كل الكميات فوق حدّ التنبيه ✅");
  return lines.join("\n").slice(0, 4000);
}

/** ⚠️ النواقص — ما يجب شراؤه أو تحضيره اليوم. */
async function viewLow() {
  const rows = (await stockRows(true)) as Row[];
  if (!rows.length) return "⚠️ <b>النواقص</b>\n\nلا يوجد نقص — كل الكميات فوق حدّ التنبيه ✅";
  const lines = ["⚠️ <b>النواقص — تحتاج تجهيز</b>", ""];
  for (const r of rows) {
    lines.push(`• ${esc(r.name_ar)} <i>(${esc(r.category_name)})</i> — المتبقي <b>${fmt(r.qty)}</b> ${esc(r.unit)} · الحدّ ${r.low_at}`);
  }
  return lines.join("\n").slice(0, 4000);
}

/** 🎁 العروض — عروض اليوم العامة وأسعار الأصناف المخفّضة. */
async function viewOffers() {
  const [general, items] = await Promise.all([
    rest("active_offers?select=title,description"),
    rest("active_item_offers?select=item_id,offer_price"),
  ]);
  const lines = ["🎁 <b>عروض اليوم</b>", ""];
  if ((general as Row[]).length) {
    for (const o of general as Row[]) lines.push(`• <b>${esc(o.title)}</b>${o.description ? ` — ${esc(o.description)}` : ""}`);
  } else lines.push("لا توجد عروض عامة اليوم.");
  if ((items as Row[]).length) {
    const nameOf = new Map(((await allItems()) as Row[]).map((i) => [String(i.id), String(i.name_ar)]));
    lines.push("", "<b>أسعار خاصة اليوم:</b>");
    for (const o of items as Row[]) {
      const price = Number(o.offer_price) === 0 ? "مجاناً" : `${fmt(o.offer_price)} د.ع`;
      lines.push(`• ${esc(nameOf.get(String(o.item_id)) ?? "صنف")} — <b>${price}</b>`);
    }
  }
  return lines.join("\n").slice(0, 4000);
}

/** 🥐 المعجنات — الدفعات المودعة وأيها قارب على الانتهاء. */
async function viewPastry() {
  const batches = (await rest(
    "pastry_batches?active=eq.true&select=item_name,quantity,deposited_on,shelf_days,note&order=deposited_on.asc",
  )) as Row[];
  if (!batches.length) return "🥐 <b>المعجنات</b>\n\nلا توجد دفعات مسجّلة.\nتُسجَّل من صفحة «المعجنات والعروض» في النظام.";
  const todayMs = new Date(`${baghdadDay()}T00:00:00Z`).getTime();
  const daysLeft = (b: Row) => {
    const exp = new Date(`${b.deposited_on}T00:00:00Z`);
    exp.setUTCDate(exp.getUTCDate() + (Number(b.shelf_days) || 6));
    return Math.round((exp.getTime() - todayMs) / 86_400_000);
  };
  const lines = ["🥐 <b>المعجنات المودعة</b>", ""];
  for (const b of batches) {
    const d = daysLeft(b);
    const tag = d < 0 ? "❌ منتهية" : d <= 1 ? "⚠️ تنتهي قريباً" : `✅ باقٍ ${d} يوم`;
    lines.push(`• ${esc(b.item_name)} — <b>${fmt(b.quantity)}</b> · ${tag}${b.note ? ` — ${esc(b.note)}` : ""}`);
  }
  const soon = batches.filter((b) => daysLeft(b) <= 1);
  if (soon.length) lines.push("", `⚠️ قدّمها كعرض اليوم: <b>${soon.map((b) => esc(b.item_name)).join("، ")}</b>`);
  return lines.join("\n").slice(0, 4000);
}

/** 🪑 أكثر الطاولات طلباً — بالتذاكر، فالطلب المشترك يُعدّ مرة واحدة. */
async function viewTableTop(days: number) {
  const rows = (await rpc("table_popularity", { p_from: baghdadDay(-days), p_to: baghdadDay() })) as Row[];
  if (!Array.isArray(rows) || !rows.length) return "🪑 <b>أكثر الطاولات طلباً</b>\n\nلا توجد طلبات على طاولات في هذه المدة.";
  const label = (t: string) => (/^[0-9]+$/.test(t) ? `طاولة ${t}` : t);
  const lines = [`🪑 <b>أكثر الطاولات طلباً — آخر ${days + 1} يوم</b>`, ""];
  rows.slice(0, 15).forEach((r, i) => {
    const medal = ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;
    lines.push(`${medal} ${esc(label(String(r.table_no)))} — <b>${fmt(r.tickets)}</b> طلب · ${fmt(r.sales)} د.ع`);
  });
  return lines.join("\n").slice(0, 4000);
}

/** 📅 تقرير العدد اليومي — صف لكل يوم: التذاكر والقطع والمبيعات. */
async function viewDailyCounts(days: number) {
  const rows = (await rpc("daily_counts", { p_from: baghdadDay(-days), p_to: baghdadDay() })) as Row[];
  if (!Array.isArray(rows)) return "تعذّر جلب التقرير.";
  const lines = [`📅 <b>تقرير العدد اليومي — آخر ${days + 1} يوم</b>`, ""];
  let tT = 0, tP = 0, tS = 0;
  for (const r of rows) {
    tT += +r.tickets; tP += +r.pieces; tS += +r.sales;
    lines.push(`📆 ${String(r.day).slice(5)} — <b>${fmt(r.tickets)}</b> طلب · ${fmt(r.pieces)} قطعة · <b>${fmt(r.sales)} د.ع</b>`);
  }
  lines.push("", `<b>المجموع:</b> ${fmt(tT)} طلب · ${fmt(tP)} قطعة · <b>${fmt(tS)} د.ع</b>`);
  lines.push(`متوسط قيمة الطلب: <b>${fmt(tT ? tS / tT : 0)} د.ع</b>`);
  return lines.join("\n").slice(0, 4000);
}

/** ⚖️ مقارنة الكاشيرين — من باع أكثر، وبأي نسبة، وأين ذهب الفرق. */
async function viewVersus(days: number) {
  const from = baghdadDay(-days), to = baghdadDay();
  const stations = (await rest("stations?select=slug,name_ar&order=sort.asc")) as Row[];
  const parts = await Promise.all(stations.map((st) => summary(from, to, String(st.slug))));
  const rows = stations.map((st, i) => ({ name: String(st.name_ar), t: sumRows(parts[i]) }));
  const grand = rows.reduce((a, r) => a + r.t.s, 0);
  const title = days === 0 ? "اليوم" : `آخر ${days + 1} يوم`;

  const lines = [`⚖️ <b>مقارنة الكاشيرين — ${title}</b>`, ""];
  for (const r of rows) {
    const share = grand ? Math.round((r.t.s * 100) / grand) : 0;
    // شريط بصري من ١٠ خانات ليُقرأ الفرق بلمحة
    const bar = "█".repeat(Math.round(share / 10)) + "░".repeat(10 - Math.round(share / 10));
    lines.push(
      `<b>${esc(r.name)}</b>`,
      `<code>${bar}</code> ${share}%`,
      `💰 المبيعات: <b>${fmt(r.t.s)} د.ع</b> · 🧾 ${fmt(r.t.c)} طلب`,
      `📈 الأرباح: <b>${fmt(r.t.p)} د.ع</b> · 🧮 متوسط الطلب: <b>${fmt(r.t.c ? r.t.s / r.t.c : 0)} د.ع</b>`,
      "",
    );
  }
  lines.push(`💰 <b>مجموع المحل: ${fmt(grand)} د.ع</b>`);
  if (rows.length === 2 && grand) {
    const [a, b] = rows;
    const hi = a.t.s >= b.t.s ? a : b, lo = a.t.s >= b.t.s ? b : a;
    const diff = hi.t.s - lo.t.s;
    lines.push(
      diff === 0
        ? "⚖️ القسمان متعادلان تماماً."
        : `🔺 <b>${esc(hi.name)}</b> يتقدّم بـ <b>${fmt(diff)} د.ع</b> (${lo.t.s ? Math.round((diff * 100) / lo.t.s) : 100}% فوق ${esc(lo.name)})`,
    );
  }
  return lines.join("\n").slice(0, 4000);
}

async function kbCategories() {
  const cats = await allCats();
  const rows = cats.map((c: Row) => [{ text: `${c.name_ar} · ${(c.stations as Row | null)?.name_ar ?? "؟"}`, callback_data: `pcat|${c.id}` }]);
  rows.push(BACK);
  return rows;
}
async function kbItems(catId: string) {
  const items = (await allItems()).filter((i: Row) => i.category_id === catId);
  const rows = items.map((i: Row) => [{ text: `${i.is_active ? "" : "⛔ "}${i.name_ar} — ${fmt(i.price)}`, callback_data: `pitem|${i.id}` }]);
  rows.push([{ text: "➕ إضافة منتج هنا", callback_data: `padd|${catId}` }]);
  rows.push([{ text: "⬅️ الأقسام", callback_data: "pcats" }, ...BACK]);
  return rows;
}
function kbItem(it: Row) {
  return [
    [{ text: "💰 تعديل السعر", callback_data: `pset|${it.id}|price` }, { text: "🏷️ تعديل الكلفة", callback_data: `pset|${it.id}|cost` }],
    [{ text: "📦 المخزون", callback_data: `pstock|${it.id}` }, { text: it.is_active ? "⛔ تعطيل" : "✅ تفعيل", callback_data: `ptog|${it.id}` }],
    [{ text: "🗑️ حذف", callback_data: `pdel|${it.id}` }],
    [{ text: "⬅️ رجوع", callback_data: `pcat|${it.category_id}` }, ...BACK],
  ];
}
async function itemText(it: Row) {
  const inv = ((await rest(`inventory?item_id=eq.${it.id}&select=qty,unit,low_at`)) as Row[])[0];
  return [
    `⚙️ <b>${esc(it.name_ar)}</b>`, "",
    `💰 السعر: <b>${fmt(it.price)} د.ع</b>`,
    `🏷️ الكلفة: <b>${fmt(it.cost)} د.ع</b>`,
    inv
      ? `📦 المخزون: <b>${fmt(inv.qty)}</b> ${esc(inv.unit)}${Number(inv.qty) <= Number(inv.low_at) ? " ⚠️ ناقص" : ""} (الحدّ ${inv.low_at})`
      : `📦 المخزون: غير مُتتبَّع`,
    `الحالة: ${it.is_active ? "مفعّل ✅" : "معطّل ⛔"}`,
  ].join("\n");
}

// ── handlers ───────────────────────────────────────────────────────────────
const authorized = (chatId: number | string) => !OWNERS.length || OWNERS.includes(String(chatId));

async function onMessage(msg: Row) {
  const chatId = msg.chat.id;
  if (!authorized(chatId)) {
    await say(chatId, `غير مصرّح لك بهذا البوت.\nمعرّفك: <code>${chatId}</code>`);
    return;
  }
  const state = await getState(chatId);
  if (state) {
    await clearState(chatId);
    const text = normDigits(String(msg.text).trim());
    if (state.action === "searchdate") {
      const day = parseDate(text);
      if (!day) {
        await say(chatId, "تاريخ غير صالح — أرسل مثل: <code>2026-08-10</code> أو <code>10/08/2026</code>", [[{ text: "🔎 حاول مجدداً", callback_data: "search" }], BACK]);
        return;
      }
      await say(chatId, await viewDaySummary(day), [[{ text: "🔄 تحديث", callback_data: `dayx|${day}` }], BACK]);
      return;
    }
    if (state.action === "stock") {
      const raw = normDigits(text.trim());
      const it = await oneItem(String(state.itemId));
      // «حد 5» sets the low-stock threshold instead of the quantity
      const thr = raw.match(/^(?:حد|حدّ)\s*(\d+)$/);
      if (thr) {
        await restWrite("inventory", "POST", { item_id: state.itemId, qty: 0, low_at: Number(thr[1]) });
        await restWrite(`inventory?item_id=eq.${state.itemId}`, "PATCH", { low_at: Number(thr[1]) });
        await clearState(chatId);
        return say(chatId, `✅ حدّ التنبيه لـ<b>${esc(it.name_ar)}</b> صار <b>${thr[1]}</b>\n\n${await itemText(it)}`, kbItem(it));
      }
      const m = raw.match(/^([+-]?)(\d+)$/);
      if (!m) return say(chatId, "أرسل رقماً فقط — أو <code>+10</code> / <code>-3</code> / <code>حد 5</code>");
      const n = Number(m[2]);
      const args = m[1] === "+" ? { p_item: state.itemId, p_delta: n }
        : m[1] === "-" ? { p_item: state.itemId, p_delta: -n }
        : { p_item: state.itemId, p_set: n };
      const qty = await rpc("adjust_stock", args);
      await clearState(chatId);
      return say(chatId, `✅ مخزون <b>${esc(it.name_ar)}</b> صار <b>${fmt(qty)}</b>\n\n${await itemText(it)}`, kbItem(it));
    }
    if (state.action === "price" || state.action === "cost") {
      const val = Math.round(Number(text.replace(/[^\d.]/g, "")));
      if (!Number.isFinite(val) || val < 0) { await say(chatId, "قيمة غير صالحة — أرسل رقماً مثل: 3500", [BACK]); return; }
      await restWrite(`menu_items?id=eq.${state.itemId}`, "PATCH", { [state.action]: val });
      const it = await oneItem(state.itemId);
      await say(chatId, `تم التحديث ✅\n\n${itemText(it)}`, kbItem(it));
      return;
    }
    if (state.action === "expense") {
      const parts = text.split(/\s+/);
      const amount = Math.round(Number(parts[0].replace(/[^\d.]/g, "")));
      const note = parts.slice(1).join(" ").trim();
      if (!Number.isFinite(amount) || amount <= 0) {
        await say(chatId, "الصيغة: <i>المبلغ ثم الوصف</i>\nمثال: <code>5000 مشتريات حليب</code>", [BACK]);
        return;
      }
      const CATS = ["مشتريات", "رواتب", "إيجار", "كهرباء", "صيانة"];
      const category = CATS.find((c) => note.includes(c)) ?? "أخرى";
      await restWrite("expenses", "POST", { amount, note: note || null, category, business_day: baghdadDay() });
      const t = sumRows(await summary(baghdadDay(), baghdadDay()));
      await say(
        chatId,
        `تم تسجيل المصروف ✅\n💸 <b>${fmt(amount)} د.ع</b>${note ? ` — ${esc(note)}` : ""} (${category})\n\n📉 مصروفات اليوم: <b>${fmt(t.e)} د.ع</b>\n✅ صافي اليوم: <b>${fmt(t.n)} د.ع</b>`,
        [[{ text: "📉 مصروف آخر", callback_data: "expadd" }], BACK],
      );
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
      await say(chatId, `تمت إضافة <b>${esc(name)}</b> بسعر <b>${fmt(price)} د.ع</b> ✅`, await kbItems(state.categoryId));
      return;
    }
  }
  await say(chatId, "☕️ <b>مخبز ومقهى هيل — لوحة التحكم</b>\nاختر من الأزرار:", mainMenu());
}

async function onCallback(cb: Row) {
  const chatId = cb.message.chat.id;
  const mid = cb.message.message_id;
  await tg("answerCallbackQuery", { callback_query_id: cb.id });
  if (!authorized(chatId)) return;
  await clearState(chatId);

  const [cmd, a, b] = String(cb.data).split("|");
  if (cmd === "menu") return say(chatId, "☕️ <b>مخبز ومقهى هيل — لوحة التحكم</b>\nاختر من الأزرار:", mainMenu(), mid);
  if (cmd === "rpt") return say(chatId, await viewReport(Number(a)), [[{ text: "🔄 تحديث", callback_data: cb.data }], BACK], mid);
  if (cmd === "day") return say(chatId, await viewDaySummary(baghdadDay(-Number(a))), [[{ text: "🔄 تحديث", callback_data: cb.data }], BACK], mid);
  if (cmd === "dayx") return say(chatId, await viewDaySummary(a), [[{ text: "🔄 تحديث", callback_data: cb.data }], BACK], mid);
  if (cmd === "search") {
    await setState(chatId, { action: "searchdate" });
    return say(chatId, "🔎 أرسل التاريخ المطلوب:\nمثال: <code>2026-08-10</code> أو <code>10/08/2026</code>", [[{ text: "إلغاء", callback_data: "menu" }]], mid);
  }
  if (cmd === "now") return say(chatId, await viewNow(), [[{ text: "🔄 تحديث", callback_data: "now" }], BACK], mid);
  if (cmd === "tables") return say(chatId, await viewTables(), [[{ text: "🔄 تحديث", callback_data: "tables" }], BACK], mid);
  if (cmd === "final") return say(chatId, await viewDailyFinal(), [[{ text: "🔄 تحديث", callback_data: "final" }], BACK], mid);
  if (cmd === "top") return say(chatId, await viewTop(), [BACK], mid);
  if (cmd === "counts") return say(chatId, await viewCounts(), [BACK], mid);
  if (cmd === "avail") return say(chatId, await viewAvail(), [BACK], mid);
  if (cmd === "stock")
    return say(chatId, await viewStock(), [[{ text: "🔄 تحديث", callback_data: "stock" }, { text: "⚠️ النواقص", callback_data: "low" }], BACK], mid);
  if (cmd === "low")
    return say(chatId, await viewLow(), [[{ text: "🔄 تحديث", callback_data: "low" }, { text: "📦 كل المخزون", callback_data: "stock" }], BACK], mid);
  if (cmd === "offers") return say(chatId, await viewOffers(), [[{ text: "🔄 تحديث", callback_data: "offers" }], BACK], mid);
  if (cmd === "pastry") return say(chatId, await viewPastry(), [[{ text: "🔄 تحديث", callback_data: "pastry" }], BACK], mid);
  if (cmd === "tabtop")
    return say(chatId, await viewTableTop(Number(a)), [
      [{ text: "٧ أيام", callback_data: "tabtop|6" }, { text: "٣٠ يوم", callback_data: "tabtop|29" }, { text: "٩٠ يوم", callback_data: "tabtop|89" }],
      BACK,
    ], mid);
  if (cmd === "dcount")
    return say(chatId, await viewDailyCounts(Number(a)), [
      [{ text: "٧ أيام", callback_data: "dcount|6" }, { text: "٣٠ يوم", callback_data: "dcount|29" }],
      BACK,
    ], mid);
  if (cmd === "vs")
    return say(chatId, await viewVersus(Number(a)), [
      [{ text: "اليوم", callback_data: "vs|0" }, { text: "٧ أيام", callback_data: "vs|6" }, { text: "٣٠ يوم", callback_data: "vs|29" }],
      BACK,
    ], mid);
  if (cmd === "pstock") {
    await setState(chatId, { action: "stock", itemId: a });
    const it = await oneItem(a);
    const cur = ((await rest(`inventory?item_id=eq.${a}&select=qty,low_at`)) as Row[])[0];
    return say(
      chatId,
      `📦 <b>${esc(it.name_ar)}</b>\nالكمية الحالية: <b>${cur ? fmt(cur.qty) : 0}</b>${cur ? ` · حدّ التنبيه ${cur.low_at}` : " (غير مُتتبَّع بعد)"}\n\n`
        + "أرسل الكمية الجديدة (رقم)، أو <code>+10</code> للإضافة و<code>-3</code> للخصم.\nولتغيير حدّ التنبيه أرسل: <code>حد 5</code>",
      [[{ text: "إلغاء", callback_data: `pitem|${a}` }]],
      mid,
    );
  }
  if (cmd === "expadd") {
    await setState(chatId, { action: "expense" });
    return say(chatId, "💸 أرسل: <i>المبلغ ثم الوصف</i>\nمثال: <code>5000 مشتريات حليب</code>", [[{ text: "إلغاء", callback_data: "menu" }]], mid);
  }
  if (cmd === "pcats") return say(chatId, "⚙️ <b>إدارة المنتجات</b> — اختر القسم:", await kbCategories(), mid);
  if (cmd === "pcat") return say(chatId, "اختر منتجاً لإدارته:", await kbItems(a), mid);
  if (cmd === "pitem") { const it = await oneItem(a); return say(chatId, await itemText(it), kbItem(it), mid); }
  if (cmd === "ptog") {
    const it = await oneItem(a);
    await restWrite(`menu_items?id=eq.${a}`, "PATCH", { is_active: !it.is_active });
    const upd = await oneItem(a);
    return say(chatId, `${upd.is_active ? "تم التفعيل ✅" : "تم التعطيل ⛔"}\n\n${await itemText(upd)}`, kbItem(upd), mid);
  }
  if (cmd === "pset") {
    await setState(chatId, { action: b, itemId: a });
    const it = await oneItem(a);
    return say(chatId, `أرسل ${b === "price" ? "السعر الجديد" : "الكلفة الجديدة"} لـ<b>${esc(it.name_ar)}</b> (رقم فقط):`, [[{ text: "إلغاء", callback_data: `pitem|${a}` }]], mid);
  }
  if (cmd === "padd") {
    await setState(chatId, { action: "add", categoryId: a });
    return say(chatId, "أرسل: <i>اسم المنتج ثم السعر</i>\nمثال: <code>موهيتو رمان 4000</code>", [[{ text: "إلغاء", callback_data: `pcat|${a}` }]], mid);
  }
  if (cmd === "pdel") {
    const it = await oneItem(a);
    return say(chatId, `حذف <b>${esc(it.name_ar)}</b> نهائياً؟`,
      [[{ text: "🗑️ نعم، احذف", callback_data: `pdelok|${a}` }, { text: "إلغاء", callback_data: `pitem|${a}` }]], mid);
  }
  if (cmd === "pdelok") {
    const it = await oneItem(a);
    await restWrite(`menu_items?id=eq.${a}`, "DELETE");
    return say(chatId, `تم حذف <b>${esc(it.name_ar)}</b> 🗑️`, await kbItems(it.category_id), mid);
  }
}

// ── entry ──────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // nightly (or manual) daily report — pg_cron calls this with the job secret
  if (url.searchParams.get("job") === "daily") {
    if (HOOK_SECRET && req.headers.get("x-job-secret") !== HOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    try {
      const text = await viewDailyFinal();
      for (const o of OWNERS) await say(o, text, [BACK]);
      return new Response("sent", { status: 200 });
    } catch (e) {
      return new Response(`error: ${(e as Error).message}`, { status: 500 });
    }
  }

  // telegram webhook updates
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  if (HOOK_SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== HOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const update = await req.json();
    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message?.text) await onMessage(update.message);
  } catch (e) {
    console.error("update error:", (e as Error).message);
  }
  return new Response("ok", { status: 200 });
});
