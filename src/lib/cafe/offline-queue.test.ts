import { beforeEach, describe, expect, it, vi } from "vitest";
import { drop, enqueue, flush, newClientId, pending, pendingCount } from "./offline-queue";

// المتصفح غير موجود في الاختبار — تخزين بسيط في الذاكرة يكفي
beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
  });
});

const order = (n: number) => ({ lines: [{ item_id: `item-${n}`, qty: 1 }] });

describe("طابور البيع بلا إنترنت", () => {
  it("يحفظ الطلب ويعطيه رقماً محلياً متصاعداً", () => {
    const a = enqueue(newClientId(), order(1));
    const b = enqueue(newClientId(), order(2));
    expect(a.localNo).toBe(1);
    expect(b.localNo).toBe(2);
    expect(pendingCount()).toBe(2);
  });

  it("يرفع الطابور بالترتيب ويفرغه عند النجاح", async () => {
    enqueue("c1", order(1));
    enqueue("c2", order(2));
    const seen: string[] = [];
    const res = await flush(async (_p, id) => {
      seen.push(id);
      return { ok: true };
    });
    expect(seen).toEqual(["c1", "c2"]);
    expect(res.sent).toBe(2);
    expect(pendingCount()).toBe(0);
  });

  it("يتوقّف عند انقطاع الشبكة ولا يحرق بقية الطابور", async () => {
    enqueue("c1", order(1));
    enqueue("c2", order(2));
    enqueue("c3", order(3));
    let calls = 0;
    await flush(async (_p, id) => {
      calls++;
      if (id === "c2") throw new Error("network down");
      return { ok: true };
    });
    // c1 نجح، c2 قطع المحاولة، c3 لم يُمَسّ
    expect(calls).toBe(2);
    expect(pending().map((r) => r.clientId)).toEqual(["c2", "c3"]);
  });

  it("الطلب المرفوض من الخادم يبقى معلّقاً مع سبب الرفض — لا يُفقد ولا يُعاد للأبد", async () => {
    enqueue("c1", order(1));
    await flush(async () => ({ ok: false, error: "صنف غير متاح" }));
    const row = pending()[0];
    expect(row.clientId).toBe("c1");
    expect(row.tries).toBe(1);
    expect(row.lastError).toBe("صنف غير متاح");
  });

  it("إعادة الرفع لا تُرسل ما رُفع — لا بيعة مرتين", async () => {
    enqueue("c1", order(1));
    await flush(async () => ({ ok: true }));
    const again: string[] = [];
    await flush(async (_p, id) => {
      again.push(id);
      return { ok: true };
    });
    expect(again).toEqual([]);
  });

  it("المعرّف يبقى نفسه بين المحاولات، فترفض القاعدة التكرار", async () => {
    enqueue("stable-id", order(1));
    const ids: string[] = [];
    await flush(async (_p, id) => {
      ids.push(id);
      return { ok: false, error: "مؤقّت" };
    });
    await flush(async (_p, id) => {
      ids.push(id);
      return { ok: true };
    });
    expect(ids).toEqual(["stable-id", "stable-id"]);
  });

  it("تخزين تالف لا يمنع البيع", () => {
    window.localStorage.setItem("hail-pending-orders", "{ليس JSON");
    expect(pending()).toEqual([]);
    expect(() => enqueue("c1", order(1))).not.toThrow();
  });

  it("يمكن إسقاط طلب لن يُقبل أبداً", () => {
    enqueue("c1", order(1));
    enqueue("c2", order(2));
    drop("c1");
    expect(pending().map((r) => r.clientId)).toEqual(["c2"]);
  });
});
