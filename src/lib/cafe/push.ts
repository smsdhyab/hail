import "server-only";
import webpush from "web-push";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** Push a new-order alert to every subscribed staff device. Never throws —
 *  a push failure must never fail the customer's order.
 *  ponytail: sent inline from the order action (zero extra infra); move to a
 *  DB trigger + edge function if order-submit latency ever matters. */
export async function sendNewOrderPush(p: { seq: number; table: string | null; count: number; delivery?: boolean }) {
  try {
    const pub = process.env.WEB_PUSH_PUBLIC_KEY;
    const priv = process.env.WEB_PUSH_PRIVATE_KEY;
    if (!pub || !priv) return;
    const svc = createSupabaseServiceClient();
    const { data: subs } = await svc.from("push_subscriptions").select("endpoint, p256dh, auth");
    if (!subs?.length) return;

    webpush.setVapidDetails("mailto:teletelksa@gmail.com", pub, priv);
    const payload = JSON.stringify({
      title: `طلب جديد #${String(p.seq).padStart(3, "0")}`,
      // a delivery order has no table — say so rather than leaving the line bare
      body: `${p.delivery ? "🛵 توصيل · " : p.table ? `طاولة ${p.table} · ` : ""}${p.count} صنف`,
      url: "/orders",
      tag: `hail-order-${p.seq}`,
    });

    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 600 });
        } catch (e) {
          // subscription gone (uninstalled / permission revoked) → drop the row
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await svc.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }),
    );
  } catch {
    /* missing env / transient DB error — order flow continues */
  }
}
