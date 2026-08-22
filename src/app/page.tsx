import Link from "next/link";
import { redirect } from "next/navigation";
import { HailMark } from "@/components/cafe/Logo";
import { getStaff } from "@/lib/cafe/auth";

export const dynamic = "force-dynamic";

/**
 * Routing used to live in a Next `proxy` (middleware). Next 16 pins proxy to
 * the Node runtime, which edge hosts cannot run, so the two redirects it did
 * now live in the pages that own them. Nothing security-related moved: the
 * gate was always `(staff)/layout.tsx` re-checking the session server-side.
 */
export default async function Home() {
  const staff = await getStaff().catch(() => null);
  if (staff) redirect("/dashboard");
  if (process.env.MODERN_ONLY === "1") redirect("/menu");

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
