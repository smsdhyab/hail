"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "./auth";
import type { StationSlug } from "./hail-menu";

export type AdminVariant = { id: string; name_ar: string; price_override: number | null; kind: string; sort: number };
export type AdminItem = {
  id: string;
  category_id: string;
  name_ar: string;
  description_ar: string | null;
  image_url: string | null;
  price: number;
  cost: number;
  flavors: string[];
  is_active: boolean;
  sort: number;
  variants: AdminVariant[];
};
export type AdminCategory = {
  id: string; name_ar: string; sort: number; is_active: boolean;
  /** which register sells this category — the whole routing rule lives here */
  station_slug: StationSlug | null;
  items: AdminItem[];
};

function revalidateMenu() {
  revalidatePath("/menu-admin");
  revalidatePath("/menu");
  revalidatePath("/kiosk");
  revalidatePath("/cashier");
}

/** Full menu for the admin editor (includes cost — service client only). */
export async function listMenuAdmin(): Promise<AdminCategory[]> {
  await requireAdmin();
  const svc = createSupabaseServiceClient();
  const [{ data: cats }, { data: items }, { data: vars }] = await Promise.all([
    svc.from("categories").select("id, name_ar, sort, is_active, station_id").order("sort"),
    svc.from("menu_items").select("id, category_id, name_ar, description_ar, image_url, price, cost, flavors, is_active, sort").order("sort"),
    svc.from("item_variants").select("id, item_id, name_ar, price_override, kind, sort").order("sort"),
  ]);

  const varsByItem = new Map<string, AdminVariant[]>();
  for (const v of vars ?? []) {
    const arr = varsByItem.get(v.item_id) ?? [];
    arr.push({ id: v.id, name_ar: v.name_ar, price_override: v.price_override, kind: v.kind, sort: v.sort });
    varsByItem.set(v.item_id, arr);
  }
  const itemsByCat = new Map<string, AdminItem[]>();
  for (const it of items ?? []) {
    const arr = itemsByCat.get(it.category_id) ?? [];
    arr.push({ ...it, variants: varsByItem.get(it.id) ?? [] });
    itemsByCat.set(it.category_id, arr);
  }
  const { data: stations } = await svc.from("stations").select("id, slug");
  const slugOf = new Map((stations ?? []).map((st) => [st.id, st.slug as StationSlug]));
  return (cats ?? []).map((c) => ({
    id: c.id,
    name_ar: c.name_ar,
    sort: c.sort,
    is_active: c.is_active,
    station_slug: c.station_id ? (slugOf.get(c.station_id) ?? null) : null,
    items: itemsByCat.get(c.id) ?? [],
  }));
}

export async function listCategoriesAdmin() {
  await requireAdmin();
  const svc = createSupabaseServiceClient();
  const { data } = await svc.from("categories").select("id, name_ar, sort, is_active").order("sort");
  return data ?? [];
}

export type ItemInput = {
  id?: string;
  category_id: string;
  name_ar: string;
  description_ar?: string | null;
  image_url?: string | null;
  price: number;
  cost?: number;
  flavors?: string[];
  is_active?: boolean;
  sort?: number;
};

export async function upsertItem(input: ItemInput) {
  await requireAdmin();
  if (!input.name_ar?.trim()) return { ok: false as const, error: "أدخل اسم الصنف." };
  if (!input.category_id) return { ok: false as const, error: "اختر القسم." };
  const svc = createSupabaseServiceClient();
  const row = {
    category_id: input.category_id,
    name_ar: input.name_ar.trim(),
    description_ar: input.description_ar?.trim() || null,
    image_url: input.image_url || null,
    price: Math.max(0, Math.round(input.price || 0)),
    cost: Math.max(0, Math.round(input.cost || 0)),
    flavors: (input.flavors ?? []).map((f) => f.trim()).filter(Boolean),
    is_active: input.is_active ?? true,
    sort: Math.round(input.sort ?? 0),
  };
  const { error } = input.id
    ? await svc.from("menu_items").update(row).eq("id", input.id)
    : await svc.from("menu_items").insert(row);
  if (error) return { ok: false as const, error: error.message };
  revalidateMenu();
  return { ok: true as const };
}

export async function toggleItem(id: string, is_active: boolean) {
  await requireAdmin();
  const svc = createSupabaseServiceClient();
  const { error } = await svc.from("menu_items").update({ is_active }).eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidateMenu();
  return { ok: true as const };
}

export async function deleteItem(id: string) {
  await requireAdmin();
  const svc = createSupabaseServiceClient();
  const { error } = await svc.from("menu_items").delete().eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidateMenu();
  return { ok: true as const };
}

export async function addVariant(itemId: string, name_ar: string, price: number) {
  await requireAdmin();
  if (!name_ar.trim()) return { ok: false as const, error: "أدخل اسم الحجم." };
  const svc = createSupabaseServiceClient();
  const { error } = await svc.from("item_variants").insert({
    item_id: itemId,
    kind: "size",
    name_ar: name_ar.trim(),
    price_override: Math.max(0, Math.round(price)),
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateMenu();
  return { ok: true as const };
}

export async function deleteVariant(id: string) {
  await requireAdmin();
  const svc = createSupabaseServiceClient();
  const { error } = await svc.from("item_variants").delete().eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidateMenu();
  return { ok: true as const };
}

/** A new category MUST name its register — that is what decides where its
 *  items are prepared and whose books the money lands on. */
export async function addCategory(name_ar: string, station: StationSlug, sort = 0) {
  await requireAdmin();
  if (!name_ar.trim()) return { ok: false as const, error: "أدخل اسم القسم." };
  const svc = createSupabaseServiceClient();
  const { data: st } = await svc.from("stations").select("id").eq("slug", station).maybeSingle();
  if (!st) return { ok: false as const, error: "الكاشير غير معروف." };
  const { error } = await svc.from("categories").insert({ name_ar: name_ar.trim(), sort: Math.round(sort), station_id: st.id });
  if (error) return { ok: false as const, error: error.message };
  revalidateMenu();
  return { ok: true as const };
}

/** Move a whole category to the other register (e.g. cake moves to the cafe). */
export async function setCategoryStation(categoryId: string, station: StationSlug) {
  await requireAdmin();
  const svc = createSupabaseServiceClient();
  const { data: st } = await svc.from("stations").select("id").eq("slug", station).maybeSingle();
  if (!st) return { ok: false as const, error: "الكاشير غير معروف." };
  const { error } = await svc.from("categories").update({ station_id: st.id }).eq("id", categoryId);
  if (error) return { ok: false as const, error: error.message };
  revalidateMenu();
  return { ok: true as const };
}

/** Upload an item image to the public `menu` bucket. Returns its URL.
 *  The browser already resized it to webp (see resize-image.ts), so there is no
 *  native image library on the server and this runs on any runtime. */
export async function uploadItemImage(formData: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "لا يوجد ملف." };
  if (!file.type.startsWith("image/")) return { ok: false, error: "الملف ليس صورة." };
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: "الصورة كبيرة جداً (أكثر من 8MB)." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = file.type === "image/webp" ? "webp" : file.type === "image/png" ? "png" : "jpg";

  const svc = createSupabaseServiceClient();
  const path = `items/${crypto.randomUUID()}.${ext}`;
  const { error } = await svc.storage.from("menu").upload(path, bytes, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };
  const { data } = svc.storage.from("menu").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
