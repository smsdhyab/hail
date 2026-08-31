import { isDemoServer } from "./demo";
import type { StationSlug } from "./hail-menu";
import type { SoldBy } from "./order";
import { DEMO_MENU } from "./demo-menu";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type MenuVariantView = { id: string; name_ar: string; price: number };
export type MenuItemView = {
  id: string;
  name_ar: string;
  description: string | null;
  image_url: string | null;
  /** سعر القطعة — أو سعر الكيلو حين يكون sold_by = "weight" */
  price: number;
  sold_by: SoldBy;
  /** «كغم» / «قطعة» — ما يُكتب بعد السعر وفي السلة */
  unit_label: string;
  flavors: string[];
  /** يظهر في «يناسبها مع…» داخل نافذة أي صنف — يؤشّره المدير */
  suggest: boolean;
  variants: MenuVariantView[];
};
export type MenuCategoryView = {
  name_ar: string;
  image_url: string | null;
  /** which cash register owns every item in this category — drives order routing */
  station: StationSlug;
  items: MenuItemView[];
};

// The menu is identical for every (anon) visitor and changes rarely, yet every
// page open re-hit the DB (pages are force-dynamic). Memoize the result per warm
// server instance for 30s so repeated opens skip the round-trip — admin edits
// still show within 30s. ponytail: in-memory TTL, no cross-instance cache; a
// cold serverless start pays one fetch. Bump/clear by redeploy if needed.
let _menuCache: { at: number; data: MenuCategoryView[] } | null = null;
const MENU_TTL_MS = 30_000;

/** The public menu (active items only). Demo → local seed; real → cost-free DB views. */
export async function getPublicMenu(): Promise<MenuCategoryView[]> {
  if (isDemoServer()) return DEMO_MENU;
  if (_menuCache && Date.now() - _menuCache.at < MENU_TTL_MS) return _menuCache.data;

  const supabase = await createSupabaseServerClient();
  const [{ data: rows }, { data: vars }] = await Promise.all([
    supabase.from("menu_public").select("*").order("category_sort").order("sort"),
    supabase.from("variant_public").select("*").order("sort"),
  ]);

  const varsByItem = new Map<string, MenuVariantView[]>();
  for (const v of vars ?? []) {
    const arr = varsByItem.get(v.item_id) ?? [];
    arr.push({ id: v.id, name_ar: v.name_ar, price: v.price });
    varsByItem.set(v.item_id, arr);
  }

  const cats = new Map<string, MenuCategoryView>();
  for (const r of rows ?? []) {
    let c = cats.get(r.category_name);
    if (!c) {
      c = { name_ar: r.category_name, image_url: r.category_image, station: (r.station_slug ?? "cafe") as StationSlug, items: [] };
      cats.set(r.category_name, c);
    }
    c.items.push({
      id: r.id,
      name_ar: r.name_ar,
      description: r.description_ar,
      image_url: r.image_url,
      price: r.price,
      sold_by: (r.sold_by ?? "piece") as SoldBy,
      unit_label: r.unit_label ?? "قطعة",
      flavors: r.flavors ?? [],
      suggest: r.suggest === true,
      variants: varsByItem.get(r.id) ?? [],
    });
  }
  const result = [...cats.values()];
  // only cache a real menu — never a transient empty/failed fetch
  if (result.length > 0) _menuCache = { at: Date.now(), data: result };
  return result;
}

export type ComboView = {
  slug: string;
  title_ar: string;
  price: number;
  /** Σ of the parts' list prices — shown struck through when the combo is cheaper */
  list_total: number;
  item_ids: string[];
  item_names: string[];
};

/**
 * «عروض اليوم» — the drink + pastry pairings.
 *
 * Read from the `combo_public` view, which already filters to active combos
 * whose items are all still active: an offer whose pastry was disabled would
 * otherwise sit on the menu and fail at checkout.
 */
export async function getActiveCombos(): Promise<ComboView[]> {
  if (isDemoServer()) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("combo_public").select("*").order("sort");
  return (data ?? []) as ComboView[];
}
