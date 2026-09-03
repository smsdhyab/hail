import type { MenuCategoryView } from "./menu-data";
import { HAIL_MENU } from "./hail-menu";

/**
 * The public menu shape, derived from the HAIL catalog (hail-menu.ts) — the
 * one place items and prices live. Inactive items (no price set yet, e.g. the
 * coffee crops) are dropped, and categories left empty disappear, exactly as
 * the `menu_public` DB view behaves.
 */
export const DEMO_MENU: MenuCategoryView[] = HAIL_MENU.map((c) => ({
  name_ar: c.name_ar,
  image_url: null,
  station: c.station,
  items: c.items
    .filter((i) => i.active !== false)
    .map((i) => ({
      id: i.id,
      name_ar: i.name_ar,
      description: i.description ?? null,
      image_url: null,
      price: i.price,
      sold_by: i.sold_by ?? "piece",
      unit_label: i.unit_label ?? (i.sold_by === "weight" ? "كغم" : "قطعة"),
      flavors: i.flavors ?? [],
      suggest: false,
      plu: null,
      variants: (i.variants ?? []).map(([n, p]) => ({ id: `${i.id}-${p}`, name_ar: n, price: p })),
    })),
})).filter((c) => c.items.length > 0);
