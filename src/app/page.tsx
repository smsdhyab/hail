import Link from "next/link";
import { HailMark } from "@/components/cafe/Logo";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6 text-center">
      <div className="space-y-3">
        <HailMark className="mx-auto size-28" />
        <h1 className="text-4xl font-extrabold text-primary">مخبز ومقهى هيل</h1>
        <p className="text-muted-foreground">منيو وطلبات وولاء الكافيه</p>
      </div>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link
          href="/menu"
          className="rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
        >
          تصفّح المنيو
        </Link>
        <Link
          href="/sign-in"
          className="rounded-lg border border-border px-6 py-3 font-semibold text-foreground transition hover:bg-secondary"
        >
          دخول الموظفين
        </Link>
      </div>
    </main>
  );
}
