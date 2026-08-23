"use client";

import { Sparkles } from "lucide-react";
import type { ComboView, MenuCategoryView } from "@/lib/cafe/menu-data";
import { formatIqdLabel } from "@/lib/cafe/money";
import { MenuIcon } from "./MenuIcon";

/** اسم القسم في الشريط الجانبي — مثبّت في الأعلى ولا يأتي من قاعدة البيانات. */
export const OFFERS_CAT = "عروض اليوم";

/**
 * قسم «عروض اليوم».
 *
 * كان شريطاً أفقياً أعلى الشبكة، فصار قسماً كامل الصفحة: أغلب الزبائن يفتحون
 * المنيو من الموبايل، والتمرير الأفقي يخفي كل عرض بعد الأول — فلا يُرى.
 * الآن العروض تنزل رأسياً كبقية الأصناف، والقسم نفسه ينبض بلوني الهوية في
 * الشريط ليلفت النظر إليه.
 */
export function CombosSection({
  combos,
  menu,
  onPick,
}: {
  combos: ComboView[];
  menu: MenuCategoryView[];
  /** يضيف صنفَي العرض إلى السلة ويسجّل العرض على الطلب */
  onPick: (combo: ComboView) => void;
}) {
  const byId = new Map(menu.flatMap((c) => c.items).map((i) => [i.id, i]));

  return (
    <>
      <div className="mb-4 rounded-2xl border-2 border-[var(--accent2)]/40 bg-[var(--panelsoft)] px-4 py-3 text-center">
        <h2 className="flex items-center justify-center gap-2 text-xl font-extrabold text-[var(--accent)]">
          <Sparkles className="size-5 shrink-0 text-[var(--accent2)]" />
          محتار شنو تطلب؟
        </h2>
        <p className="mt-0.5 text-sm text-[var(--muted)]">خلينا نساعدك — اختر عرضاً بضغطة</p>
      </div>

      {combos.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--muted)]">لا توجد عروض اليوم — تابعنا لاحقاً.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {combos.map((combo) => {
            const parts = combo.item_ids.map((id) => byId.get(id)).filter(Boolean);
            // أسعار عروض التصميم أعلى من مجموع القائمة (حصص أكبر)، فالشطب
            // لا يظهر إلا حين يكون العرض أرخص فعلاً
            const saves = combo.list_total > combo.price;

            return (
              <button
                key={combo.slug}
                onClick={() => onPick(combo)}
                className="overflow-hidden rounded-2xl border-2 border-[var(--accent2)]/50 bg-[var(--panelsoft)] text-right transition active:scale-[0.98]"
              >
                <div className="flex h-32 items-center justify-center gap-1.5 bg-[var(--panel)] px-2">
                  {parts.map((p) => (
                    <div key={p!.id} className="relative h-28 flex-1 overflow-hidden rounded-xl">
                      <MenuIcon name={p!.name_ar} className="absolute inset-0 m-auto size-10 text-[var(--accent)] opacity-45" />
                      {p!.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p!.image_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                      )}
                    </div>
                  ))}
                </div>

                <div className="px-3.5 py-3">
                  <p className="line-clamp-2 min-h-[2.4em] text-[15px] font-bold leading-tight">{combo.title_ar}</p>
                  <div className="mt-1.5 flex items-baseline justify-between gap-2">
                    <span className="text-xl font-extrabold tabular-nums text-[var(--accent2)]">{formatIqdLabel(combo.price)}</span>
                    {saves && (
                      <span className="text-xs text-[var(--muted)] line-through tabular-nums">{formatIqdLabel(combo.list_total)}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
