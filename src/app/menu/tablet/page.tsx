import { getPublicMenu } from "@/lib/cafe/menu-data";
import { getActiveItemOffers, getScreensaver } from "@/lib/cafe/pastry-actions";
import { TabletMenuClient } from "@/components/cafe/TabletMenuClient";

export const dynamic = "force-dynamic";

/** نفس النظام اللوحي (بديل لـ /menu). */
export default async function TabletMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const sp = await searchParams;
  const [menu, offers, screensaver] = await Promise.all([
    getPublicMenu(),
    getActiveItemOffers().catch(() => ({})),
    getScreensaver().catch(() => ({ url: null, afterSec: 120, on: true })),
  ]);
  return <TabletMenuClient menu={menu} table={sp.t ?? null} channel="qr" offers={offers} screensaver={screensaver} />;
}
