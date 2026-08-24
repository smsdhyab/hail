import { listMargins, listPurchases, type ItemMargin, type PurchaseRow } from "@/lib/cafe/purchase-actions";
import { PurchasesClient } from "@/components/cafe/PurchasesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "المشتريات والمخزون — مخبز ومقهى هيل" };

export default async function PurchasesPage() {
  let margins: ItemMargin[] = [];
  let purchases: PurchaseRow[] = [];
  try {
    [margins, purchases] = await Promise.all([listMargins(), listPurchases()]);
  } catch {
    // كاشير أو جلسة منتهية — الكلفة والربح للإدارة، والقائمة تخفي الصفحة عنه
  }
  return <PurchasesClient margins={margins} purchases={purchases} />;
}
