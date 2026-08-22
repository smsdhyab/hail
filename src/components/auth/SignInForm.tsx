"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCafeUI } from "@/components/CafeUIProvider";
import { HailMark } from "@/components/cafe/Logo";
import { StationIcon } from "@/components/cafe/StationIcon";
import { STATIONS, type StationSlug } from "@/lib/cafe/hail-menu";
import { SYSTEM } from "@/lib/cafe/branding";
import { signInLocal } from "@/lib/cafe/local-auth";
import { openTill } from "@/lib/cafe/till-actions";

/**
 * Two registers, one screen: pick which counter you are opening, then sign in.
 * The station choice scopes the whole session — the order queue, the receipts
 * and the sales figures all follow it, so the two sets of books never mix.
 */
export function SignInForm({ redirectTo, localMode }: { redirectTo: string; localMode: boolean }) {
  const { t } = useCafeUI();
  const router = useRouter();

  const [station, setStation] = useState<StationSlug | null>(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the visitor landed here only because their access token expired, the
  // browser client can silently refresh it from the refresh token — then send
  // them straight back in instead of asking for the password again.
  useEffect(() => {
    if (localMode) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await createSupabaseBrowserClient().auth.getSession();
        if (!cancelled && data.session) router.replace(redirectTo);
      } catch {
        /* demo mode or no session — stay on the form */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, redirectTo, localMode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!station) return;
    setLoading(true);
    setError(null);
    try {
      if (localMode) {
        const res = await signInLocal(login, password, station);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.replace(redirectTo);
        router.refresh();
        return;
      }

      // phone numbers & usernames map to <login>@hail.iq auth accounts
      const email = login.includes("@") ? login.trim() : `${login.trim()}@hail.iq`;
      // Supabase enforces >=6-char passwords; short PINs (e.g. the cashier's
      // «123») are stored zero-padded to 6, so pad the same way on login.
      const realPassword = password.length < 6 ? password.padEnd(6, "0") : password;
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: realPassword });
      if (signInError) {
        setError(t("auth.error"));
        return;
      }

      // Signing in only proves WHO you are. Opening a register is a separate
      // server-side check: a cashier may open only their own. A refusal signs
      // them straight back out, so a wrong choice leaves no usable session.
      const till = await openTill(station);
      if (!till.ok) {
        await supabase.auth.signOut();
        setError(till.error);
        return;
      }

      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError(t("auth.error"));
    } finally {
      setLoading(false);
    }
  }

  // step 1 — which register is this device?
  if (!station) {
    return (
      <div className="w-full max-w-md space-y-5 text-center">
        <HailMark className="mx-auto size-24" />
        <div>
          <h1 className="text-2xl font-bold text-primary">مخبز ومقهى هيل</h1>
          <p className="mt-1 text-sm text-muted-foreground">اختر الكاشير الذي تعمل عليه</p>
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">{SYSTEM.name_ar}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {STATIONS.map((s) => (
            <button
              key={s.slug}
              type="button"
              onClick={() => setStation(s.slug)}
              className="flex flex-col items-center gap-2 rounded-2xl border-2 border-border bg-card p-6 transition hover:border-primary hover:bg-primary/5 active:scale-95"
            >
              <StationIcon station={s.slug} className="size-12 text-accent" />
              <span className="text-lg font-extrabold text-primary">{s.name_ar}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const chosen = STATIONS.find((s) => s.slug === station)!;

  // step 2 — who is opening it?
  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="space-y-2 text-center">
        <HailMark className="mx-auto size-16" />
        <h1 className="text-xl font-bold text-primary">مخبز ومقهى هيل</h1>
        <button
          type="button"
          onClick={() => {
            setStation(null);
            setError(null);
          }}
          className="mx-auto flex items-center gap-2 rounded-full bg-accent/15 px-4 py-1.5 text-sm font-bold text-primary transition hover:bg-accent/25"
        >
          <StationIcon station={chosen.slug} className="size-5" />
          <span>{chosen.name_ar}</span>
          <span className="text-xs font-normal text-muted-foreground">— تغيير</span>
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("auth.email")}</span>
        <input
          type="text"
          required
          autoComplete="username"
          placeholder={localMode ? "pastry" : "07XXXXXXXXX"}
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
          dir="ltr"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("auth.password")}</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
          dir="ltr"
        />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {loading ? t("auth.signingIn") : t("auth.signIn")}
      </button>

      <p className="text-center text-[11px] text-muted-foreground">
        {SYSTEM.name_ar}
        <br />
        تطوير{" "}
        <a href={SYSTEM.site} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline">
          {SYSTEM.vendor_ar}
        </a>
      </p>

      {localMode && (
        <p className="text-center text-xs text-muted-foreground">
          وضع محلي بلا قاعدة بيانات · admin/1234 · pastry/1111 · cafe/2222
        </p>
      )}
    </form>
  );
}
