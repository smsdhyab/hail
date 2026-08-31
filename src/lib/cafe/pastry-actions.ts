"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireStaff } from "./auth";
import { businessDay } from "./time";
import { getPublicMenu } from "./menu-data";

export type BatchState = "fresh" | "soon" | "expired";
export type PastryBatch = {
  id: string;
  item_name: string;
  quantity: number;
  deposited_on: string;
  shelf_days: number;
  note: string | null;
  days_remaining: number;
  state: BatchState;
};

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** whole days from today (Baghdad) until the given date; negative = past */
function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  const today = new Date(`${businessDay()}T00:00:00Z`).getTime();
  return Math.round((target - today) / 86_400_000);
}
function withState(b: { id: string; item_name: string; quantity: number; deposited_on: string; shelf_days: number; note: string | null }): PastryBatch {
  const remaining = daysUntil(addDays(b.deposited_on, b.shelf_days));
  return { ...b, days_remaining: remaining, state: remaining < 0 ? "expired" : remaining <= 1 ? "soon" : "fresh" };
}

// ── pastry inventory ────────────────────────────────────────────────────────

export async function addPastryBatch(input: { item_name: string; quantity: number; deposited_on?: string; note?: string }) {
  await requireStaff();
  const name = input.item_name.trim();
  if (!name) return { ok: false as const, error: "أدخل نوع المعجّن." };
  const svc = createSupabaseServiceClient();
  const { error } = await svc.from("pastry_batches").insert({
    item_name: name,
    quantity: Math.max(0, Math.round(input.quantity || 0)),
    deposited_on: input.deposited_on?.trim() || businessDay(),
    note: input.note?.trim() || null,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/pastries");
  return { ok: true as const };
}

export async function listPastryBatches(): Promise<PastryBatch[]> {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("pastry_batches")
    .select("id, item_name, quantity, deposited_on, shelf_days, note")
    .eq("active", true)
    .order("deposited_on", { ascending: true });
  return (data ?? []).map(withState);
}

/** Count of active batches that are expiring (≤1 day) or expired — the alert. */
export async function getPastryAlertCount(): Promise<number> {
  await requireStaff();
  const batches = await listPastryBatches();
  return batches.filter((b) => b.state !== "fresh").length;
}

export async function retireBatch(id: string) {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  await svc.from("pastry_batches").update({ active: false }).eq("id", id);
  revalidatePath("/pastries");
  return { ok: true as const };
}

// ── offers ──────────────────────────────────────────────────────────────────

export type Offer = { id: string; title: string; description: string | null; active: boolean; auto: boolean; ends_on: string | null };

export async function listOffers(): Promise<Offer[]> {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  const { data } = await svc.from("offers").select("id, title, description, active, auto, ends_on").order("created_at", { ascending: false });
  return (data ?? []) as Offer[];
}

export async function addOffer(input: { title: string; description?: string; ends_on?: string }) {
  await requireStaff();
  const title = input.title.trim();
  if (!title) return { ok: false as const, error: "أدخل عنوان العرض." };
  const svc = createSupabaseServiceClient();
  const { error } = await svc.from("offers").insert({
    title,
    description: input.description?.trim() || null,
    ends_on: input.ends_on?.trim() || null,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/pastries");
  revalidatePath("/menu");
  return { ok: true as const };
}

/** One-tap «عرض اليوم» from an expiring batch (offer ends the day it expires). */
export async function createOfferFromBatch(batchId: string) {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  const { data: b } = await svc.from("pastry_batches").select("item_name, deposited_on, shelf_days").eq("id", batchId).maybeSingle();
  if (!b) return { ok: false as const, error: "الدفعة غير موجودة." };
  const { error } = await svc.from("offers").insert({
    title: `🎁 عرض اليوم — ${b.item_name} مجاناً مع مشروب ساخن`,
    description: `قدّم ${b.item_name} مجاناً مع أي مشروب ساخن (كمية محدودة).`,
    auto: true,
    batch_id: batchId,
    ends_on: addDays(b.deposited_on, b.shelf_days),
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/pastries");
  revalidatePath("/menu");
  return { ok: true as const };
}

export async function toggleOffer(id: string, active: boolean) {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  await svc.from("offers").update({ active }).eq("id", id);
  revalidatePath("/pastries");
  revalidatePath("/menu");
  return { ok: true as const };
}

export async function deleteOffer(id: string) {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  await svc.from("offers").delete().eq("id", id);
  revalidatePath("/pastries");
  revalidatePath("/menu");
  return { ok: true as const };
}

// ── public: active offers for the customer menu ─────────────────────────────

export type PublicOffer = { id: string; title: string; description: string | null };

/** Currently-active offers for the menu. Public (anon reads the active_offers view). */
export async function getActiveOffers(): Promise<PublicOffer[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("active_offers").select("id, title, description");
  return (data ?? []) as PublicOffer[];
}

// ── per-item daily offers (hot-drink pastry cross-sell) ─────────────────────

export type ItemOffer = { item_id: string; name_ar: string; price: number; offer_price: number };

/** Today's per-item offers as { item_id: offer_price }. Public (menu reads it). */
export async function getActiveItemOffers(): Promise<Record<string, number>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("active_item_offers").select("item_id, offer_price");
  const map: Record<string, number> = {};
  for (const r of data ?? []) map[r.item_id] = r.offer_price;
  return map;
}

/** Set today's offer price for an item (0 = مجاناً). Staff only. */
export async function setItemOffer(itemId: string, offerPrice: number) {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  const { error } = await svc
    .from("item_offers")
    .upsert({ item_id: itemId, offer_price: Math.max(0, Math.round(offerPrice)), business_day: businessDay() }, { onConflict: "item_id,business_day" });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/pastries");
  revalidatePath("/menu");
  return { ok: true as const };
}

export async function clearItemOffer(itemId: string) {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  await svc.from("item_offers").delete().eq("item_id", itemId).eq("business_day", businessDay());
  revalidatePath("/pastries");
  revalidatePath("/menu");
  return { ok: true as const };
}

/** Today's item offers with the item's name + base price (admin list). */
export async function listTodayItemOffers(): Promise<ItemOffer[]> {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  const { data } = await svc.from("item_offers").select("item_id, offer_price").eq("business_day", businessDay());
  if (!data?.length) return [];
  const ids = data.map((d) => d.item_id);
  const { data: items } = await svc.from("menu_items").select("id, name_ar, price").in("id", ids);
  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  return data.map((d) => ({ item_id: d.item_id, name_ar: byId.get(d.item_id)?.name_ar ?? "؟", price: byId.get(d.item_id)?.price ?? 0, offer_price: d.offer_price }));
}

// ── صانع العروض ─────────────────────────────────────────────────────────────
//
// عرض = صنفان أو أكثر بسعر واحد. الأصناف تأتي من القسمين (مشروب + معجّنة) فلا
// يقتصر المنتقي على المعجنات.
//
// السعر يُخزَّن هنا ويُقرأ في place_order من قاعدة البيانات لا من المتصفح —
// وإلا استطاع أي زبون إرسال سعر عرض من عنده.

export type ComboAdmin = {
  id: string;
  title_ar: string;
  price: number;
  is_active: boolean;
  items: { id: string; name_ar: string; price: number }[];
  /** مجموع أسعار القائمة — الفرق عنه هو ما يتحمّله المحل */
  list_total: number;
};

export async function listCombosAdmin(): Promise<ComboAdmin[]> {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  const { data: combos } = await svc.from("combos").select("id, title_ar, price, is_active, sort").order("sort").order("created_at");
  if (!combos?.length) return [];

  const { data: links } = await svc.from("combo_items").select("combo_id, item_id").in("combo_id", combos.map((c) => c.id));
  const ids = [...new Set((links ?? []).map((l) => l.item_id))];
  const { data: items } = ids.length
    ? await svc.from("menu_items").select("id, name_ar, price").in("id", ids)
    : { data: [] as { id: string; name_ar: string; price: number }[] };
  const byId = new Map((items ?? []).map((i) => [i.id, i]));

  return combos.map((c) => {
    const parts = (links ?? [])
      .filter((l) => l.combo_id === c.id)
      .map((l) => byId.get(l.item_id))
      .filter((i): i is { id: string; name_ar: string; price: number } => Boolean(i));
    return {
      id: c.id,
      title_ar: c.title_ar,
      price: c.price,
      is_active: c.is_active,
      items: parts,
      list_total: parts.reduce((s, i) => s + i.price, 0),
    };
  });
}

/** إنشاء عرض أو تعديله. صنفان على الأقل — عرض بصنف واحد هو تغيير سعر لا عرض. */
export async function saveCombo(input: { id?: string; title_ar: string; price: number; item_ids: string[] }) {
  await requireStaff();
  const title = input.title_ar.trim();
  const itemIds = [...new Set(input.item_ids.filter(Boolean))];
  if (!title) return { ok: false as const, error: "اكتب عنوان العرض." };
  if (itemIds.length < 2) return { ok: false as const, error: "اختر صنفين على الأقل." };
  const price = Math.max(0, Math.round(input.price));

  const svc = createSupabaseServiceClient();

  // الأصناف تُتحقّق من القاعدة: عرض على صنف موقوف يظهر في المنيو ثم يفشل عند الدفع
  const { data: found } = await svc.from("menu_items").select("id").in("id", itemIds).eq("is_active", true);
  if ((found?.length ?? 0) !== itemIds.length) {
    return { ok: false as const, error: "أحد الأصناف غير موجود أو موقوف." };
  }

  let comboId = input.id;
  if (comboId) {
    const { error } = await svc.from("combos").update({ title_ar: title, price }).eq("id", comboId);
    if (error) return { ok: false as const, error: error.message };
    await svc.from("combo_items").delete().eq("combo_id", comboId);
  } else {
    const { data, error } = await svc
      .from("combos")
      .insert({ slug: `combo-${crypto.randomUUID().slice(0, 8)}`, title_ar: title, price })
      .select("id")
      .single();
    if (error || !data) return { ok: false as const, error: error?.message ?? "تعذّر الحفظ." };
    comboId = data.id;
  }

  const { error: linkErr } = await svc.from("combo_items").insert(itemIds.map((item_id) => ({ combo_id: comboId!, item_id })));
  if (linkErr) return { ok: false as const, error: linkErr.message };

  revalidateMenus();
  return { ok: true as const };
}

export async function toggleCombo(id: string, is_active: boolean) {
  await requireStaff();
  await createSupabaseServiceClient().from("combos").update({ is_active }).eq("id", id);
  revalidateMenus();
  return { ok: true as const };
}

export async function deleteCombo(id: string) {
  await requireStaff();
  await createSupabaseServiceClient().from("combos").delete().eq("id", id); // combo_items تُحذف تلقائياً
  revalidateMenus();
  return { ok: true as const };
}

/** كل الأصناف المفعّلة مجمّعة بالقسم — لمنتقي صانع العروض. */
export async function listComboPickerItems(): Promise<{ category: string; items: { id: string; name_ar: string; price: number }[] }[]> {
  await requireStaff();
  const menu = await getPublicMenu();
  return menu
    .map((c) => ({ category: c.name_ar, items: c.items.map((i) => ({ id: i.id, name_ar: i.name_ar, price: i.price })) }))
    .filter((c) => c.items.length > 0);
}

function revalidateMenus() {
  for (const p of ["/pastries", "/menu", "/delivery", "/cashier"]) revalidatePath(p);
}

// ── إعدادات يضبطها المدير ───────────────────────────────────────────────────

/** أجرة التوصيل السارية. عامة — صفحة التوصيل تعرضها قبل الطلب. */
export async function getDeliveryFee(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("app_settings").select("value").eq("key", "delivery_fee").maybeSingle();
  return data?.value ?? 0;
}

export async function setDeliveryFee(fee: number) {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  const { error } = await svc.rpc("set_setting", { p_key: "delivery_fee", p_value: Math.max(0, Math.round(fee)) });
  if (error) return { ok: false as const, error: error.message };
  revalidateMenus();
  revalidatePath("/dashboard");
  return { ok: true as const };
}

// ── شاشة استراحة المنيو ─────────────────────────────────────────────────────

export type Screensaver = { url: string | null; afterSec: number; on: boolean };

/** إعدادات الاستراحة. عامة — اللوحي يقرؤها بلا تسجيل دخول. */
export async function getScreensaver(): Promise<Screensaver> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("public_settings").select("key, value, value_text");
  const row = (k: string) => (data ?? []).find((r) => r.key === k);
  const media = row("screensaver_media");
  return {
    url: media?.value_text || null,
    afterSec: row("screensaver_after_sec")?.value ?? 120,
    on: (media?.value ?? 1) === 1,
  };
}

/** هل تُعرض الاقتراحات في نافذة الصنف؟ عام — المنيو يقرؤه بلا تسجيل دخول. */
export async function getSuggestionsOn(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("public_settings").select("value").eq("key", "suggestions_on").maybeSingle();
  return (data?.value ?? 1) === 1;
}

export async function setSuggestionsOn(on: boolean) {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  const { error } = await svc.rpc("set_setting", { p_key: "suggestions_on", p_value: on ? 1 : 0 });
  if (error) return { ok: false as const, error: error.message };
  revalidateMenus();
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function setScreensaver(input: { url?: string | null; afterSec?: number; on?: boolean }) {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  if (input.url !== undefined) {
    const { error } = await svc.rpc("set_setting_text", { p_key: "screensaver_media", p_value: input.url || null });
    if (error) return { ok: false as const, error: error.message };
  }
  if (input.on !== undefined) {
    const { error } = await svc.rpc("set_setting", { p_key: "screensaver_media", p_value: input.on ? 1 : 0 });
    if (error) return { ok: false as const, error: error.message };
  }
  if (input.afterSec !== undefined) {
    // صفر يعني «لا تظهر أبداً»، والحدّ الأعلى ساعة — أكثر منها يعني تعطيلها فعلياً
    const sec = Math.max(0, Math.min(3600, Math.round(input.afterSec)));
    const { error } = await svc.rpc("set_setting", { p_key: "screensaver_after_sec", p_value: sec });
    if (error) return { ok: false as const, error: error.message };
  }
  revalidateMenus();
  revalidatePath("/dashboard");
  return { ok: true as const };
}

/** رفع صورة أو فيديو الاستراحة إلى مخزن الصور. */
export async function uploadScreensaver(formData: FormData) {
  await requireStaff();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "لا يوجد ملف." };
  const isVideo = file.type.startsWith("video/");
  if (!isVideo && !file.type.startsWith("image/")) return { ok: false as const, error: "الملف ليس صورة ولا فيديو." };
  // الفيديو يُحمَّل على كل جهاز عند كل فتح — الكبير يبطّئ اللوحي ويستهلك الباقة
  const max = isVideo ? 40 : 8;
  if (file.size > max * 1024 * 1024) {
    return { ok: false as const, error: `الملف كبير جداً — الحدّ ${max} م.ب.` };
  }

  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || (isVideo ? "mp4" : "jpg");
  const svc = createSupabaseServiceClient();
  const path = `screensaver/${crypto.randomUUID()}.${ext}`;
  const { error } = await svc.storage
    .from("menu")
    .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return { ok: false as const, error: error.message };
  const { data } = svc.storage.from("menu").getPublicUrl(path);
  const url = data.publicUrl;

  const res = await setScreensaver({ url });
  if (!res.ok) return res;
  return { ok: true as const, url };
}
