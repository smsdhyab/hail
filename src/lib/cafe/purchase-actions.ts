"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireStaff, requireAdmin } from "./auth";
import { businessDay, lastNDays } from "./time";

/**
 * المشتريات: ما يربط ما تدفعه بما تبيعه.
 *
 * الشراء يزيد المخزون ويحدّث كلفة الوحدة ويُقيَّد في سجلّه — **ولا يُسجَّل
 * مصروفاً**. النظام يخصم كلفة البضاعة مع كل بيعة، فإضافة الشراء إلى المصروفات
 * تخصمه مرة ثانية: يظهر المحل خاسراً يوم الشراء ورابحاً بلا كلفة بقيّة الأيام.
 */

export type PurchaseRow = {
  id: string;
  business_day: string;
  item_name: string;
  qty: number;
  total_cost: number;
  unit_cost: number;
  supplier: string | null;
};

export type ItemMargin = {
  item_id: string;
  name_ar: string;
  category: string;
  sold_by: "piece" | "weight";
  unit: string;
  price: number;
  cost: number;
  margin: number;
  margin_pct: number | null;
  stock: number;
  low_at: number;
  is_low: boolean;
};

/** تسجيل شراء: الكمية والمبلغ الكلي — وكلفة الوحدة تُحسب. */
export async function addPurchase(input: {
  item_id: string;
  qty: number;
  total_cost: number;
  supplier?: string;
  note?: string;
}) {
  await requireStaff();
  if (!input.item_id) return { ok: false as const, error: "اختر الصنف." };
  const qty = Math.round((Number(input.qty) || 0) * 1000) / 1000;
  if (qty <= 0) return { ok: false as const, error: "أدخل الكمية المشتراة." };
  const total = Math.max(0, Math.round(Number(input.total_cost) || 0));

  const svc = createSupabaseServiceClient();
  // الدالة تفعل الثلاثة معاً — لو نُفّذت هنا خطوةً خطوة لأمكن أن يزيد المخزون
  // بلا أن تُحدَّث الكلفة إن انقطع الاتصال بينهما
  const { data, error } = await svc.rpc("record_purchase", {
    p_item: input.item_id,
    p_qty: qty,
    p_total: total,
    p_supplier: input.supplier?.trim() || null,
    p_note: input.note?.trim() || null,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/purchases");
  revalidatePath("/dashboard");
  const row = Array.isArray(data) ? data[0] : null;
  return { ok: true as const, unit_cost: row?.unit_cost ?? 0, stock: row?.stock ?? 0 };
}

/** حدّ التنبيه: عند هذا الرقم أو دونه يظهر الصنف في «النواقص». */
export async function setLowAt(itemId: string, low: number) {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  const { error } = await svc.rpc("set_low_at", { p_item: itemId, p_low: Math.max(0, Number(low) || 0) });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/purchases");
  return { ok: true as const };
}

/** جرد: يضبط الرصيد على ما عُدّ فعلاً، بلا أن يُحسب شراءً. */
export async function setStock(itemId: string, qty: number) {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  const { error } = await svc.rpc("adjust_stock", { p_item: itemId, p_delta: null, p_set: Math.max(0, Number(qty) || 0) });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/purchases");
  return { ok: true as const };
}

export async function listPurchases(limit = 40): Promise<PurchaseRow[]> {
  await requireStaff();
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("purchases")
    .select("id, business_day, item_id, qty, total_cost, unit_cost, supplier")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!data?.length) return [];

  // الأسماء باستعلام ثانٍ لا بربط مدمج: صنف محذوف يجعل الربط يُسقِط السطر
  // كلَّه من السجلّ، وسجلّ المشتريات لا يجوز أن تختفي منه فاتورة
  const ids = [...new Set(data.map((p) => p.item_id))];
  const { data: items } = await svc.from("menu_items").select("id, name_ar").in("id", ids);
  const nameOf = new Map((items ?? []).map((i) => [i.id, i.name_ar]));

  return data.map((p) => ({
    id: p.id,
    business_day: p.business_day,
    item_name: nameOf.get(p.item_id) ?? "صنف محذوف",
    qty: Number(p.qty),
    total_cost: p.total_cost,
    unit_cost: p.unit_cost,
    supplier: p.supplier,
  }));
}

/** كل صنف: سعره وكلفته وربحه ورصيده — مرتَّب بالناقص أولاً. */
export async function listMargins(): Promise<ItemMargin[]> {
  await requireAdmin(); // الكلفة والربح للإدارة وحدها
  const svc = createSupabaseServiceClient();
  const { data } = await svc.from("item_margins").select("*").order("name_ar");
  return (data ?? [])
    .map((m) => ({
      ...m,
      qty: undefined,
      price: m.price,
      cost: m.cost,
      margin: m.margin,
      margin_pct: m.margin_pct === null ? null : Number(m.margin_pct),
      stock: Number(m.stock),
      low_at: Number(m.low_at),
    }))
    .sort((a, b) => Number(b.is_low) - Number(a.is_low)) as ItemMargin[];
}

/** ما أُنفق على البضاعة في المدى — نقد خارج، لا مصروف تشغيلي. */
export async function purchasesSpent(days = 7): Promise<{ today: number; range: number }> {
  await requireAdmin();
  const svc = createSupabaseServiceClient();
  const today = businessDay();
  const [from, to] = lastNDays(days);
  const [a, b] = await Promise.all([
    svc.rpc("purchases_summary", { p_from: today, p_to: today }),
    svc.rpc("purchases_summary", { p_from: from, p_to: to }),
  ]);
  const one = (d: unknown) => (Array.isArray(d) ? ((d[0] as { spent?: number })?.spent ?? 0) : 0);
  return { today: one(a.data), range: one(b.data) };
}
