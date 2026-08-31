"use server";

import { isDemoServer } from "./demo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendNewOrderPush } from "./push";
import { isLocalDb, placeOrderLocal, tableFloor } from "./local-db";
import { stationName, type StationSlug } from "./hail-menu";
import type { Json } from "@/lib/types";

export type OrderLineInput = {
  item_id: string;
  variant_id?: string | null;
  flavor?: string | null;
  qty: number;
};

export type SubmitOrderInput = {
  channel: "qr" | "kiosk" | "delivery";
  table?: string | null;
  lines: OrderLineInput[];
  /** optional customer capture — builds the loyalty base */
  name?: string | null;
  phone?: string | null;
  /** free-text order note («سكر قليل، بدون سكر…») */
  note?: string | null;
  /** «عروض اليوم» slugs taken with this order — priced server-side, never here */
  combos?: string[];
  /** delivery only — kept on the order, not on the customer: the address
   *  changes between orders and would otherwise overwrite the previous one */
  address?: string | null;
  geo?: string | null;
  deliverAt?: string | null;
};

/** One customer order can land on both registers — the confirmation tells them
 *  which counters are preparing what, under a single order number. */
export type OrderSplitPart = { station: StationSlug; station_ar: string; subtotal: number; count: number };

export type SubmitOrderResult =
  | {
      ok: true;
      orderNumber: string;
      orderId?: string | null;
      cardSerial?: string | null;
      /** empty when the order stayed on one register */
      parts?: OrderSplitPart[];
      floor?: number | null;
    }
  | { ok: false; error: string };

/** Place a self-order. Demo → a plausible number, no persistence. Real → place_order rpc.
 *  A provided phone finds-or-creates the customer (loyalty card) and attaches the
 *  order to them, so paying at the counter auto-awards their points. */
export async function submitOrder(input: SubmitOrderInput): Promise<SubmitOrderResult> {
  if (!input.lines?.length) return { ok: false, error: "السلة فارغة" };

  if (isLocalDb()) {
    const placed = placeOrderLocal({
      channel: input.channel,
      lines: input.lines,
      table: input.table,
      note: input.note,
    });
    if ("error" in placed) return { ok: false, error: placed.error };
    await sendNewOrderPush({
      seq: placed.group_no,
      table: input.table?.trim() || null,
      count: input.lines.reduce((s, l) => s + l.qty, 0),
    });
    return {
      ok: true,
      orderNumber: String(placed.group_no).padStart(3, "0"),
      orderId: placed.orders[0]?.id ?? null,
      floor: tableFloor(input.table?.trim() || null),
      parts: placed.orders.map((o) => ({
        station: o.station,
        station_ar: stationName(o.station),
        subtotal: o.subtotal,
        count: 0,
      })),
    };
  }

  if (isDemoServer()) {
    const n = Math.floor(Math.random() * 900 + 100);
    return { ok: true, orderNumber: String(n).padStart(3, "0") };
  }

  const supabase = await createSupabaseServerClient();

  let customerId: string | null = null;
  let cardSerial: string | null = null;
  const phone = input.phone?.trim();
  if (phone) {
    const { data: serial } = await supabase.rpc("create_card", {
      p_phone: phone,
      p_name: input.name?.trim() || null,
    });
    if (serial) {
      cardSerial = serial;
      const { data: card } = await supabase.rpc("get_card", { p_serial: serial });
      customerId = card?.[0]?.id ?? null;
    }
  }

  const { data, error } = await supabase.rpc("place_order", {
    p_channel: input.channel,
    p_lines: input.lines as unknown as Json,
    p_customer: customerId,
    p_table: input.table?.trim() || null,
    p_note: input.note?.trim() || null,
    p_combos: (input.combos ?? []) as unknown as Json,
    p_address: input.address?.trim() || null,
    p_geo: input.geo?.trim() || null,
    p_deliver_at: input.deliverAt?.trim() || null,
  });
  if (error || !data?.[0]) {
    // القاعدة ترفع رموزاً إنجليزية لا نصّاً عربياً — بوستغرس يعامل % في الرسالة
    // كعلامة استبدال، والترجمة مكانها هنا حيث تُعرض على الزبون
    const code = error?.message ?? "";
    if (code.includes("table_closed")) {
      return { ok: false, error: "هذه الطاولة غير متاحة حالياً — تفضّل بالطلب من الكاشير." };
    }
    if (code.includes("table_unknown")) {
      return { ok: false, error: "رقم الطاولة غير صحيح — تفضّل بالطلب من الكاشير." };
    }
    return { ok: false, error: "تعذّر إرسال الطلب، حاول مجدداً." };
  }
  // alert subscribed staff devices even when the app is closed (never throws)
  await sendNewOrderPush({
    seq: data[0].group_no,
    table: input.table?.trim() || null,
    count: input.lines.reduce((s, l) => s + l.qty, 0),
    delivery: input.channel === "delivery",
  });
  return { ok: true, orderNumber: String(data[0].group_no).padStart(3, "0"), orderId: data[0].order_id, cardSerial };
}

export type PublicOrderItem = { name_ar: string; flavor_ar: string | null; qty: number; unit_price: number; line_total: number };
export type PublicOrder = {
  id: string;
  order_seq: number;
  status: string;
  table_no: string | null;
  subtotal: number;
  discount: number;
  created_at: string;
  items: PublicOrderItem[];
};

/** Customer-side order tracking — looks up their own orders by unguessable id. */
export async function getMyOrders(ids: string[]): Promise<PublicOrder[]> {
  if (!ids.length || isDemoServer() || isLocalDb()) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("get_orders_public", { p_orders: ids.slice(0, 20) });
  return (Array.isArray(data) ? data : []) as PublicOrder[];
}
