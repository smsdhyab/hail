import QRCode from "qrcode";
import { getCardPublic } from "@/lib/cafe/loyalty-actions";
import { HailMark } from "@/components/cafe/Logo";
import { InstallCardButton } from "@/components/cafe/InstallCardButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  // per-card manifest so "install" opens straight on this customer's card
  return { title: "بطاقة هيل", manifest: `/card/${serial}/manifest.webmanifest` };
}

/** Public loyalty card — the customer's "wallet" page. Unguessable serial in the
 *  URL is the access key; shows points + a QR the cashier scans. */
export default async function CardPage({ params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  let card: { name_ar: string | null; points: number } | null = null;
  try {
    card = await getCardPublic(serial);
  } catch {
    card = null;
  }

  if (!card) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-muted-foreground">البطاقة غير موجودة.</p>
      </main>
    );
  }

  const qr = await QRCode.toDataURL(serial, {
    width: 320,
    margin: 1,
    color: { dark: "#42301f", light: "#ffffff" },
  });

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-background to-secondary p-6">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card shadow-lg">
        <div className="flex items-center justify-between bg-primary px-6 py-5 text-primary-foreground">
          <div>
            <p className="text-sm opacity-80">بطاقة ولاء</p>
            <h1 className="text-2xl font-extrabold">مخبز ومقهى هيل</h1>
          </div>
          <HailMark className="size-14 shrink-0" />
        </div>
        <div className="space-y-4 p-6 text-center">
          {card.name_ar && <p className="text-lg font-semibold">{card.name_ar}</p>}
          <div>
            <p className="text-sm text-muted-foreground">رصيد النقاط</p>
            <p className="text-5xl font-extrabold text-primary">{card.points}</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR" className="mx-auto size-56 rounded-xl border border-border" />
          <p className="text-sm text-muted-foreground">اعرض هذا الرمز عند الكاشير لإضافة النقاط أو استبدال المكافآت.</p>
          <InstallCardButton />
        </div>
      </div>
    </main>
  );
}
