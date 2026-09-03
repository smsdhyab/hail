import { getActiveCombos, getPublicMenu } from "@/lib/cafe/menu-data";
import { getActiveItemOffers, getScreensaver, getSuggestionsOn } from "@/lib/cafe/pastry-actions";
import { TabletMenuClient } from "@/components/cafe/TabletMenuClient";
import { SHOP } from "@/lib/cafe/branding";

export const dynamic = "force-dynamic";

// وصف خاص بالمنيو — بلا حقوق النظام. الوصف العام في `layout.tsx` يذكر المطوّر،
// وهو نصّ يظهر للزبون في نتائج البحث ومعاينة الرابط على واتساب، والزبون لا شأن
// له بمن كتب النظام. صفحة التوصيل تحمل وصفها الخاص أصلاً.
export const metadata = {
  title: `المنيو — ${SHOP.name_ar}`,
  description: `منيو ${SHOP.name_ar} — ${SHOP.city_ar}. تصفّح واطلب من طاولتك.`,
};

/** المنيو الأساسي للزبون — النظام اللوحي (أقسام يمين + شبكة صور + سلة وطلب).
 *  كل روابط/بطاقات الطاولات تفتح هنا: /menu?t=رقم-الطاولة. */
export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const sp = await searchParams;
  const [menu, offers, combos, screensaver, suggestionsOn] = await Promise.all([
    getPublicMenu(),
    getActiveItemOffers().catch(() => ({})),
    getActiveCombos().catch(() => []),
    getScreensaver().catch(() => ({ url: null, afterSec: 120, on: true })),
    getSuggestionsOn().catch(() => true),
  ]);
  return <TabletMenuClient menu={menu} combos={combos} table={sp.t ?? null} channel="qr" offers={offers} screensaver={screensaver} suggestionsOn={suggestionsOn} />;
}
