import { getActiveCombos, getPublicMenu } from "@/lib/cafe/menu-data";
import { getActiveItemOffers, getDeliveryFee } from "@/lib/cafe/pastry-actions";
import { TabletMenuClient } from "@/components/cafe/TabletMenuClient";
import { DELIVERY_AREA_AR, SHOP } from "@/lib/cafe/branding";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `طلب توصيل — ${SHOP.name_ar}`,
  description: `${DELIVERY_AREA_AR}. تصفّح المنيو واطلب، ونوصّلك لباب البيت.`,
  openGraph: {
    title: `طلب توصيل — ${SHOP.name_ar}`,
    description: DELIVERY_AREA_AR,
    images: ["/icons/icon-512.png"],
  },
};

/**
 * The link that goes on Instagram.
 *
 * Same menu the tables use — one implementation, one price list — but in
 * delivery mode: no table number, and the cart asks for the name, phone,
 * address and location a driver actually needs. The order still splits between
 * the two registers exactly like any other, because delivery is a channel, not
 * a third counter.
 */
export default async function DeliveryPage() {
  const [menu, offers, combos, fee] = await Promise.all([
    getPublicMenu(),
    getActiveItemOffers().catch(() => ({})),
    getActiveCombos().catch(() => []),
    getDeliveryFee().catch(() => 0),
  ]);
  return (
    <TabletMenuClient menu={menu} combos={combos} table={null} channel="delivery" offers={offers} deliveryFee={fee} />
  );
}
