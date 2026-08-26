/**
 * طابور البيع بلا إنترنت.
 *
 * حين تنقطع الشبكة يُحفظ الطلب في الجهاز ويُعطى الزبون وصله فوراً، ثم يُرفع
 * وحده حين تعود. الكاشير لا ينتظر ولا يوقف البيع.
 *
 * التخزين في localStorage لا IndexedDB: الطلب سطران من النصّ، وحتى مئة طلب
 * معلّق لا تبلغ عُشر السعة المتاحة. وIndexedDB يفرض عمليات غير متزامنة على
 * مسار الدفع، وهو آخر مكان يُحتمل فيه تعقيد.
 *
 * ولكل طلب معرّف يولّده الجهاز قبل الإرسال: القاعدة ترفض تكراره، فلو وصل الطلب
 * وضاع ردّه لم تُسجَّل البيعة مرتين عند إعادة المحاولة.
 */

const KEY = "hail-pending-orders";
const MAX = 200; // حارس: طابور أكبر من هذا يعني عطلاً لا انقطاعاً

export type QueuedOrder = {
  /** المعرّف الذي يمنع الازدواج — يُولَّد مرة واحدة ويبقى مع الطلب */
  clientId: string;
  /** ما يُرسل إلى الخادم حرفياً */
  payload: unknown;
  /** رقم محلي يُطبع على الوصل حتى يصل الرقم الحقيقي */
  localNo: number;
  at: number;
  tries: number;
  lastError?: string;
};

function read(): QueuedOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return []; // تخزين تالف لا يجوز أن يمنع البيع
  }
}

function write(list: QueuedOrder[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* ممتلئ — الطلب المُرسل أهم من الطلب المحفوظ */
  }
}

export function newClientId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** رقم محلي متصاعد يُطبع على وصل الطلب غير المرسَل. */
function nextLocalNo(): number {
  const n = Number(window.localStorage.getItem("hail-local-seq") || "0") + 1;
  window.localStorage.setItem("hail-local-seq", String(n));
  return n;
}

export function enqueue(clientId: string, payload: unknown): QueuedOrder {
  const list = read();
  const row: QueuedOrder = { clientId, payload, localNo: nextLocalNo(), at: Date.now(), tries: 0 };
  write([...list, row]);
  return row;
}

export function pending(): QueuedOrder[] {
  return read();
}

export function pendingCount(): number {
  return read().length;
}

function remove(clientId: string) {
  write(read().filter((r) => r.clientId !== clientId));
}

function markFailed(clientId: string, error: string) {
  write(read().map((r) => (r.clientId === clientId ? { ...r, tries: r.tries + 1, lastError: error } : r)));
}

export type SendResult = { ok: boolean; error?: string };

/**
 * يرفع الطابور بالترتيب.
 *
 * يتوقّف عند أول فشل شبكة بدل أن يكمل: الشبكة لمّا تعد بعد، ومواصلة المحاولة
 * تحرق الطابور كله بأخطاء وتخلط ترتيب الأرقام. أما الطلب الذي يرفضه الخادم
 * لسبب في بياناته (صنف حُذف مثلاً) فيبقى معلّقاً ليُراجَع لا ليُعاد إلى الأبد.
 */
export async function flush(send: (payload: unknown, clientId: string) => Promise<SendResult>): Promise<{
  sent: number;
  failed: number;
}> {
  let sent = 0;
  let failed = 0;
  for (const row of read()) {
    let res: SendResult;
    try {
      res = await send(row.payload, row.clientId);
    } catch (e) {
      markFailed(row.clientId, (e as Error).message);
      failed++;
      break; // انقطاع — نتوقّف ونعاود لاحقاً
    }
    if (res.ok) {
      remove(row.clientId);
      sent++;
    } else {
      markFailed(row.clientId, res.error ?? "رفض الخادم");
      failed++;
    }
  }
  return { sent, failed };
}

/** إزالة طلب معلّق يدوياً — للطلبات التي رفضها الخادم ولن تُقبل أبداً. */
export function drop(clientId: string) {
  remove(clientId);
}
