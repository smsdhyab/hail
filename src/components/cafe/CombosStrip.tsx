"use client";

import { Sparkles } from "lucide-react";
import type { ComboView, MenuCategoryView } from "@/lib/cafe/menu-data";
import { formatIqdLabel } from "@/lib/cafe/money";
import { MenuIcon } from "./MenuIcon";

/**
 * «عروض اليوم» — the pairings from the design's «محتار شنو تطلب؟» screen.
 *
 * Tapping one adds BOTH items to the cart as ordinary lines, so the order still
 * splits to the two registers normally and each books its own list price. The
 * combo's own price is applied server-side (place_order reads it from the
 * database) — the client never gets to set a price.
 */
export function CombosStrip({
  combos,
  menu,
  onPick,
}: {
  combos: ComboView[];
  menu: MenuCategoryView[];
  /** adds the combo's items to the cart and records the combo on the order */
  onPick: (combo: ComboView) => void;
}) {
  if (!combos.length) return null;

  const byId = new Map(menu.flatMap((c) => c.items).map((i) => [i.id, i]));

  return (
    <section className="mb-4">
      <div className="mb-2.5 flex items-baseline gap-2 px-1">
        <Sparkles className="size-5 shrink-0 text-[var(--accent2)]" />
        <h2 className="text-lg font-extrabold text-[var(--accent)]">محتار شنو تطلب؟</h2>
        <span className="text-sm text-[var(--muted)]">خلينا نساعدك</span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {combos.map((combo) => {
          const parts = combo.item_ids.map((id) => byId.get(id)).filter(Boolean);
          // the design's combos cost MORE than the parts (bigger portions), so
          // only show a struck-through list price when it really is a saving
          const saves = combo.list_total > combo.price;

          return (
            <button
              key={combo.slug}
              onClick={() => onPick(combo)}
              className="w-[230px] shrink-0 overflow-hidden rounded-2xl border-2 border-[var(--accent2)]/50 bg-[var(--panelsoft)] text-right transition active:scale-[0.98]"
            >
              <div className="flex h-24 items-center justify-center gap-1 bg-[var(--panel)]">
                {parts.map((p) => (
                  <div key={p!.id} className="relative size-20 overflow-hidden rounded-xl">
                    <MenuIcon
                      name={p!.name_ar}
                      className="absolute inset-0 m-auto size-9 text-[var(--accent)] opacity-45"
                    />
                    {p!.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p!.image_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                    )}
                  </div>
                ))}
              </div>

              <div className="px-3 py-2.5">
                <p className="line-clamp-2 min-h-[2.4em] text-[13px] font-bold leading-tight">{combo.title_ar}</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-lg font-extrabold tabular-nums text-[var(--accent2)]">
                    {formatIqdLabel(combo.price)}
                  </span>
                  {saves && (
                    <span className="text-xs text-[var(--muted)] line-through tabular-nums">
                      {formatIqdLabel(combo.list_total)}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
