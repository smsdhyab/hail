import { SignInForm } from "@/components/auth/SignInForm";
import { isLocalDb } from "@/lib/cafe/local-db";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const sp = await searchParams;
  const redirectTo = typeof sp.redirect === "string" && sp.redirect.startsWith("/") ? sp.redirect : "/dashboard";
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SignInForm redirectTo={redirectTo} localMode={isLocalDb()} />
    </main>
  );
}
