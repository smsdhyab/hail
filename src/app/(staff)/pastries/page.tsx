import { listPastryBatches, listOffers, listTodayItemOffers, listCombosAdmin, listComboPickerItems, type PastryBatch, type Offer, type ItemOffer, type ComboAdmin } from "@/lib/cafe/pastry-actions";
import { CombosAdmin } from "@/components/cafe/CombosAdmin";
import { getPublicMenu } from "@/lib/cafe/menu-data";
import { isDemoServer } from "@/lib/cafe/demo";
import { PastriesClient } from "@/components/cafe/PastriesClient";

export const dynamic = "force-dynamic";

export default async function PastriesPage() {
  let batches: PastryBatch[] = [];
  let offers: Offer[] = [];
  let itemOffers: ItemOffer[] = [];
  let pastryItems: { id: string; name_ar: string; price: number }[] = [];
  let combos: ComboAdmin[] = [];
  let comboGroups: { category: string; items: { id: string; name_ar: string; price: number }[] }[] = [];
  try {
    if (!isDemoServer()) {
      const [b, o, io, menu, cb, cg] = await Promise.all([
        listPastryBatches(), listOffers(), listTodayItemOffers(), getPublicMenu(),
        listCombosAdmin(), listComboPickerItems(),
      ]);
      combos = cb;
      comboGroups = cg;
      batches = b;
      offers = o;
      itemOffers = io;
      pastryItems = (menu.find((c) => c.name_ar.includes("معجنات"))?.items ?? []).map((i) => ({ id: i.id, name_ar: i.name_ar, price: i.price }));
    }
  } catch {
    // signed-out / demo — empty state
  }
  return (
    <div className="space-y-4">
      <PastriesClient batches={batches} offers={offers} itemOffers={itemOffers} pastryItems={pastryItems} />
      <CombosAdmin combos={combos} groups={comboGroups} />
    </div>
  );
}
