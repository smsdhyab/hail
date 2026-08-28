import { getActiveCombos, getPublicMenu } from "@/lib/cafe/menu-data";
import { getActiveItemOffers, getScreensaver } from "@/lib/cafe/pastry-actions";
import { TabletMenuClient } from "@/components/cafe/TabletMenuClient";

export const dynamic = "force-dynamic";

/** المنيو الأساسي للزبون — النظام اللوحي (أقسام يمين + شبكة صور + سلة وطلب).
 *  كل روابط/بطاقات الطاولات تفتح هنا: /menu?t=رقم-الطاولة. */
export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const sp = await searchParams;
  const [menu, offers, combos, screensaver] = await Promise.all([
    getPublicMenu(),
    getActiveItemOffers().catch(() => ({})),
    getActiveCombos().catch(() => []),
    getScreensaver().catch(() => ({ url: null, afterSec: 120, on: true })),
  ]);
  return <TabletMenuClient menu={menu} combos={combos} table={sp.t ?? null} channel="qr" offers={offers} screensaver={screensaver} />;
}
