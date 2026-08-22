"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, QrCode } from "lucide-react";
import {
  createCard,
  findCard,
  adjustPoints,
  awardForSpend,
  type FoundCard,
  type CustomerRow,
} from "@/lib/cafe/loyalty-actions";
import { QrScanner } from "./QrScanner";
import { PriceInput } from "./PriceInput";

/** Open WhatsApp with the customer's card link prefilled — lands the card in
 *  their chat AND puts the cafe in their contacts for later marketing. */
function sendCardWhatsApp(phone: string, serial: string) {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.startsWith("964") ? digits : digits.replace(/^0/, "964");
  const url = `${window.location.origin}/card/${serial}`;
  const text = `مرحباً بك في مخبز ومقهى هيل ☕\nهذه بطاقة الولاء الخاصة بك — احفظها لديك:\n${url}\n\nاجمع النقاط مع كل طلب واستبدلها بمكافآت مجانية 🎁`;
  window.open(`https://wa.me/${intl}?text=${encodeURIComponent(text)}`, "_blank");
}

export function LoyaltyClient({ customers, isAdmin, customerCount }: { customers: CustomerRow[]; isAdmin: boolean; customerCount: number }) {
  const router = useRouter();

  // create card
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ serial: string; phone: string } | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // find / adjust
  const [serialInput, setSerialInput] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [found, setFound] = useState<FoundCard | null>(null);
  const [delta, setDelta] = useState("");
  const [spend, setSpend] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateErr(null);
    setCreated(null);
    const res = await createCard({ name, phone });
    setCreating(false);
    if (!res.ok) {
      setCreateErr(res.error);
      return;
    }
    setCreated({ serial: res.serial, phone: phone.trim() });
    setName("");
    setPhone("");
    router.refresh();
  }

  async function lookup(serial: string) {
    const s = serial.trim();
    if (!s) return;
    setMsg(null);
    const card = await findCard(s);
    if (!card) {
      setMsg("لا توجد بطاقة بهذا الرقم — تأكد من الرقم أو أنشئ بطاقة جديدة.");
      setFound(null);
      return;
    }
    setFound(card);
  }

  const onScanned = useCallback((text: string) => {
    setScanOpen(false);
    setSerialInput(text);
    void lookup(text);
  }, []);

  async function applyDelta(sign: 1 | -1) {
    if (!found) return;
    const n = Math.round(Number(delta));
    if (!n || n <= 0) {
      setMsg("أدخل عدد نقاط صحيحاً.");
      return;
    }
    const res = await adjustPoints(found.id, sign * n);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setFound({ ...found, points: res.balance });
    setDelta("");
    setMsg("تم التحديث.");
    router.refresh();
  }

  async function awardSpend() {
    if (!found || spend <= 0) return;
    const res = await awardForSpend(found.id, spend);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setFound({ ...found, points: res.balance });
    setSpend(0);
    setMsg("تم منح النقاط.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">الولاء</h1>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">البطاقات: {customerCount}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* create card */}
        <form onSubmit={onCreate} className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="font-bold">إنشاء بطاقة جديدة</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">اسم الزبون</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">رقم الهاتف</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
            </label>
          </div>
          <button type="submit" disabled={creating} className="rounded-lg bg-primary px-5 py-2 font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
            {creating ? "…" : "إنشاء البطاقة"}
          </button>
          {createErr && <p className="text-sm text-destructive">{createErr}</p>}
          {created && (
            <div className="space-y-2 rounded-lg bg-secondary p-3 text-sm">
              <p>
                تم الإنشاء — افتح البطاقة وشاركها مع الزبون:{" "}
                <a href={`/card/${created.serial}`} target="_blank" className="inline-flex items-center gap-1 font-semibold text-primary underline">
                  /card/{created.serial}
                  <ExternalLink className="size-3.5" />
                </a>
              </p>
              {created.phone && (
                <button
                  onClick={() => sendCardWhatsApp(created.phone, created.serial)}
                  className="w-full rounded-lg bg-[#25D366] px-3 py-2 font-bold text-white transition hover:opacity-90"
                >
                  📲 إرسال البطاقة للزبون عبر واتساب
                </button>
              )}
            </div>
          )}
        </form>

        {/* find + adjust */}
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="font-bold">بحث / إضافة نقاط</h2>
          <div className="flex gap-1.5">
            <input
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              placeholder="رقم البطاقة أو رقم الهاتف"
              dir="ltr"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button onClick={() => lookup(serialInput)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary">
              بحث
            </button>
            <button onClick={() => setScanOpen(true)} aria-label="مسح QR" className="rounded-lg bg-primary p-2.5 text-primary-foreground hover:opacity-90">
              <QrCode className="size-4" />
            </button>
          </div>
          {found && (
            <div className="space-y-2 rounded-lg bg-secondary/60 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{found.name_ar ?? "زبون"}</span>
                <button
                  onClick={() => sendCardWhatsApp(serialInput.trim().replace(/\s/g, ""), found.serial)}
                  className="rounded-md bg-[#25D366] px-2 py-1 text-xs font-bold text-white hover:opacity-90"
                  hidden={!/^\d{6,}$/.test(serialInput.trim().replace(/\s/g, ""))}
                >
                  واتساب
                </button>
                <span>
                  الرصيد: <b>{found.points}</b> نقطة
                </span>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min={1}
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="عدد النقاط"
                  dir="ltr"
                  className="w-32 rounded-lg border border-input bg-background px-2 py-1.5 outline-none focus:ring-2 focus:ring-ring"
                />
                <button onClick={() => applyDelta(1)} className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:opacity-90">
                  + إضافة
                </button>
                <button onClick={() => applyDelta(-1)} className="rounded-lg border border-border px-3 py-1.5 font-semibold text-destructive hover:bg-background">
                  − خصم
                </button>
                <a href={`/card/${found.serial}`} target="_blank" className="mr-auto self-center text-primary underline">
                  فتح البطاقة
                </a>
              </div>
              {/* quick-fill: grant points from the purchase amount */}
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/40 p-2">
                <span className="text-sm text-muted-foreground">أو منح نقاط بمبلغ الشراء:</span>
                <PriceInput value={spend} onChange={setSpend} />
                <span className="text-sm font-bold text-primary">= {Math.floor((spend || 0) / 250)} نقطة</span>
                <button onClick={awardSpend} className="rounded-lg bg-primary px-4 py-1.5 font-semibold text-primary-foreground hover:opacity-90">
                  منح النقاط
                </button>
              </div>
            </div>
          )}
          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        </div>
      </div>

      {/* customers (admin) */}
      {isAdmin && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">الزبائن ({customers.length})</h2>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-right text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">الاسم</th>
                  <th className="px-4 py-2.5 font-medium">الهاتف</th>
                  <th className="px-4 py-2.5 font-medium">النقاط</th>
                  <th className="px-4 py-2.5 font-medium">البطاقة</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                      لا يوجد زبائن بعد.
                    </td>
                  </tr>
                )}
                {customers.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{c.name_ar ?? "—"}</td>
                    <td className="px-4 py-2.5" dir="ltr">
                      {c.phone ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-primary">{c.points}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <a href={`/card/${c.card_serial}`} target="_blank" className="text-primary underline">
                          فتح
                        </a>
                        {c.phone && (
                          <button
                            onClick={() => sendCardWhatsApp(c.phone!, c.card_serial)}
                            className="rounded-md bg-[#25D366] px-2 py-1 text-xs font-bold text-white hover:opacity-90"
                          >
                            واتساب
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {scanOpen && <QrScanner onScan={onScanned} onClose={() => setScanOpen(false)} />}
    </div>
  );
}
