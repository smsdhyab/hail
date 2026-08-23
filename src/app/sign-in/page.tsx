import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/SignInForm";
import { getStaff, homeFor } from "@/lib/cafe/auth";
import { isLocalDb } from "@/lib/cafe/local-db";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const sp = await searchParams;
  // already signed in → straight to work, don't ask again
  const signed = await getStaff().catch(() => null);
  if (signed) redirect(homeFor(signed.role));
  // الكاشير يبدأ من شاشة البيع لا من الأرقام — والدور غير معروف قبل الدخول،
  // فالتحويل يتم بعده في صفحة الجذر
  const redirectTo = typeof sp.redirect === "string" && sp.redirect.startsWith("/") ? sp.redirect : "/";
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SignInForm redirectTo={redirectTo} localMode={isLocalDb()} />
    </main>
  );
}
