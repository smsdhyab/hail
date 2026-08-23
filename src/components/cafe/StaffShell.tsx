"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Armchair,
  Bell,
  BellOff,
  BellRing,
  Calculator,
  ClipboardList,
  CreditCard,
  Croissant,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Moon,
  MoreHorizontal,
  QrCode,
  Sun,
  HandCoins,
  UtensilsCrossed,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCafeUI } from "@/components/CafeUIProvider";
import type { StaffRole } from "@/lib/cafe/auth";
import { listPendingOrders } from "@/lib/cafe/cashier-actions";
import { savePushSubscription, removePushSubscription } from "@/lib/cafe/push-actions";
import { HailMark } from "./Logo";
import { SYSTEM } from "@/lib/cafe/branding";
import { signOutLocal } from "@/lib/cafe/local-auth";
import { closeTill } from "@/lib/cafe/till-actions";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Shared AudioContext: browsers keep audio suspended until a user gesture,
// so we create ONE context, resume it on the first tap/click anywhere, and
// reuse it for every chime (a fresh context per chime stays silently blocked).
let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  audioCtx ??= new Ctx();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

/** two-tone chime for a new incoming order (WebAudio — no asset needed) */
function chime() {
  try {
    const ctx = getAudioCtx();
    [880, 1175].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.35);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
  } catch {
    /* audio blocked before first interaction — fine */
  }
}

type NavItem = { href: string; label: string; short: string; adminOnly: boolean; icon: LucideIcon };
const NAV: NavItem[] = [
  { href: "/dashboard", label: "لوحة التحكم", short: "التحكم", adminOnly: true, icon: LayoutDashboard },
  { href: "/cashier", label: "الكاشير", short: "الكاشير", adminOnly: false, icon: Calculator },
  { href: "/orders", label: "الطلبات الواردة", short: "الطلبات", adminOnly: false, icon: ClipboardList },
  { href: "/tables", label: "الطاولات", short: "الطاولات", adminOnly: false, icon: Armchair },
  { href: "/loyalty", label: "الولاء", short: "الولاء", adminOnly: false, icon: CreditCard },
  { href: "/pastries", label: "المعجنات والعروض", short: "المعجنات", adminOnly: false, icon: Croissant },
  { href: "/debts", label: "سجل الديون", short: "الديون", adminOnly: false, icon: HandCoins },
  { href: "/menu-admin", label: "المنيو", short: "المنيو", adminOnly: true, icon: UtensilsCrossed },
  { href: "/expenses", label: "المصروفات", short: "المصروفات", adminOnly: false, icon: Wallet },
  { href: "/employees", label: "الموظفون", short: "الموظفون", adminOnly: true, icon: Users },
  { href: "/qr", label: "رموز QR", short: "QR", adminOnly: true, icon: QrCode },
  { href: "/help", label: "التعليمات", short: "تعليمات", adminOnly: false, icon: HelpCircle },
];

export function StaffShell({
  role,
  name,
  station = null,
  localMode = false,
  pushKey = null,
  pastryAlert = 0,
  children,
}: {
  role: StaffRole | null;
  name: string;
  /** the register this session is working — shown so nobody rings up on the wrong till */
  station?: string | null;
  localMode?: boolean;
  pushKey?: string | null;
  pastryAlert?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { setTheme } = useCafeUI();
  const links = NAV.filter((n) => !n.adminOnly || role === "admin");
  const bottomTabs = links.filter((l) => l.href !== "/help").slice(0, 4); // first 4 as bottom tabs, rest in «المزيد»
  const [moreOpen, setMoreOpen] = useState(false);

  // Keep the session alive on staff screens: instantiating the browser client
  // starts supabase-js's auto-refresh loop, which renews the access token and
  // writes it back to the cookie the server reads. Without this, server reads
  // silently degrade to anon an hour after login.
  useEffect(() => {
    try {
      createSupabaseBrowserClient();
    } catch {
      /* demo mode: no supabase env */
    }
  }, []);

  // unlock audio on the first interaction so later chimes actually sound
  useEffect(() => {
    const unlock = () => {
      try {
        getAudioCtx();
      } catch {
        /* no audio device */
      }
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // new-order alert on EVERY staff screen: poll pending self-orders, badge the
  // cashier nav item, and chime + toast when a fresh table order lands.
  const [pendingCount, setPendingCount] = useState(0);
  const [toast, setToast] = useState<{ seq: number; table: string | null } | null>(null);
  const knownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const orders = await listPendingOrders();
        if (stopped) return;
        setPendingCount(orders.length);
        if (knownIds.current) {
          const fresh = orders.find((o) => !knownIds.current!.has(o.id));
          if (fresh) {
            setToast({ seq: fresh.group_no, table: fresh.table_no });
            chime();
            setTimeout(() => setToast(null), 9000);
          }
        }
        knownIds.current = new Set(orders.map((o) => o.id));
      } catch {
        // Signed out (the shell can outlive the session for a moment) — stop
        // rather than retry every 10s and fill the server log with auth errors.
        stopped = true;
      }
    }
    tick();
    const t = setInterval(() => {
      if (!stopped) tick();
    }, 10000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  // Web Push: notifications that reach the device even with the app closed.
  const [pushState, setPushState] = useState<"unsupported" | "off" | "on" | "denied">("unsupported");
  useEffect(() => {
    if (!pushKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setPushState(sub ? "on" : Notification.permission === "denied" ? "denied" : "off");
      })
      .catch(() => {});
  }, [pushKey]);
  async function togglePush() {
    if (!pushKey) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
        await removePushSubscription(existing.endpoint);
        setPushState("off");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setPushState(perm === "denied" ? "denied" : "off");
        return;
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pushKey) });
      const j = sub.toJSON();
      if (!j.keys?.p256dh || !j.keys?.auth) return;
      await savePushSubscription({ endpoint: sub.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } });
      setPushState("on");
    } catch {
      /* unsupported browser / user dismissed */
    }
  }

  async function signOut() {
    try {
      if (localMode) await signOutLocal();
      else {
        await closeTill();
        await createSupabaseBrowserClient().auth.signOut();
      }
    } catch {
      /* already signed out */
    } finally {
      router.replace("/sign-in");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-4">
            <Link href={role === "admin" ? "/dashboard" : "/cashier"} className="flex shrink-0 items-center gap-2 whitespace-nowrap text-lg font-extrabold text-primary">
              <HailMark className="size-9" />
              مخبز ومقهى هيل
            </Link>
            <nav className="hidden gap-1 overflow-x-auto md:flex">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`relative whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    pathname.startsWith(l.href)
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground/80 hover:bg-secondary"
                  }`}
                >
                  {l.label}
                  {((l.href === "/orders" && pendingCount > 0) || (l.href === "/pastries" && pastryAlert > 0)) && (
                    <span className="absolute -left-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                      {l.href === "/orders" ? pendingCount : pastryAlert}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {name}
              {station && station !== "—" && <span className="ms-2 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-bold text-primary">{station}</span>}
            </span>
            <button
              onClick={() => setTheme(document.documentElement.classList.contains("dark") ? "Light" : "Dark")}
              aria-label="المظهر الليلي/النهاري"
              title="تبديل المظهر الليلي/النهاري"
              className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-secondary"
            >
              <Sun className="hidden size-4 dark:block" />
              <Moon className="size-4 dark:hidden" />
            </button>
            <button
              onClick={chime}
              aria-label="تجربة صوت التنبيه"
              title="تجربة صوت التنبيه — إن لم تسمع شيئاً افحص صوت الجهاز"
              className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-secondary"
            >
              🔊
            </button>
            {pushState !== "unsupported" && (
              <button
                onClick={togglePush}
                aria-label="إشعارات الطلبات"
                title={
                  pushState === "on"
                    ? "الإشعارات مفعّلة — تصل حتى والتطبيق مغلق"
                    : pushState === "denied"
                      ? "الإشعارات محظورة — فعّلها من إعدادات الموقع في المتصفح"
                      : "تفعيل إشعارات الطلبات (تصل حتى والتطبيق مغلق)"
                }
                className={`rounded-lg border p-2 transition ${
                  pushState === "on" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
                }`}
              >
                {pushState === "on" ? <Bell className="size-4" /> : <BellOff className="size-4" />}
              </button>
            )}
            <button onClick={signOut} aria-label="تسجيل الخروج" className="rounded-lg border border-border p-2 hover:bg-secondary">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-24 md:pb-5">{children}</main>

      {/* حقوق النظام — تظهر لطاقم العمل فقط، لا للزبون */}
      <footer className="mx-auto w-full max-w-6xl px-4 pb-24 pt-2 text-center text-[11px] leading-relaxed text-muted-foreground print:hidden md:pb-6">
        <p className="font-semibold">{SYSTEM.name_ar}</p>
        <p>
          تطوير{" "}
          <a href={SYSTEM.site} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline">
            {SYSTEM.vendor_ar}
          </a>
        </p>
      </footer>

      {/* app-like bottom tab bar (mobile only) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background/95 backdrop-blur md:hidden print:hidden">
        {bottomTabs.map((l) => {
          const active = pathname.startsWith(l.href);
          const Icon = l.icon;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="size-5" />
              {l.short}
              {l.href === "/orders" && pendingCount > 0 && (
                <span className="absolute right-1/2 top-1 translate-x-4 rounded-full bg-destructive px-1.5 text-[9px] font-bold text-destructive-foreground">
                  {pendingCount}
                </span>
              )}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className="relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-muted-foreground"
        >
          <MoreHorizontal className="size-5" />
          المزيد
          {pastryAlert > 0 && (
            <span className="absolute right-1/2 top-1 translate-x-4 rounded-full bg-destructive px-1.5 text-[9px] font-bold text-destructive-foreground">
              {pastryAlert}
            </span>
          )}
        </button>
      </nav>

      {/* «المزيد» sheet — the full menu */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden print:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-card p-4 pb-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="font-bold">{name}</span>
              <button onClick={() => setMoreOpen(false)} aria-label="إغلاق" className="rounded-lg border border-border p-1.5 hover:bg-secondary">
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {links.map((l) => {
                const Icon = l.icon;
                const active = pathname.startsWith(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setMoreOpen(false)}
                    className={`relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-xs font-semibold transition ${
                      active ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary"
                    }`}
                  >
                    <Icon className="size-6" />
                    {l.label}
                    {l.href === "/pastries" && pastryAlert > 0 && (
                      <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                        {pastryAlert}
                      </span>
                    )}
                  </Link>
                );
              })}
              <button
                onClick={signOut}
                className="flex flex-col items-center gap-1.5 rounded-2xl border border-border p-3 text-xs font-semibold text-destructive hover:bg-secondary"
              >
                <LogOut className="size-6" />
                تسجيل الخروج
              </button>
            </div>
          </div>
        </div>
      )}

      {/* new-order toast */}
      {toast && (
        <Link
          href="/orders"
          onClick={() => setToast(null)}
          className="fixed inset-x-4 top-16 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-primary/30 bg-primary px-4 py-3 text-primary-foreground shadow-xl print:hidden"
        >
          <BellRing className="size-6 shrink-0 animate-bounce" />
          <span className="font-bold">
            طلب جديد #{String(toast.seq).padStart(3, "0")}
            {toast.table ? ` — طاولة ${toast.table}` : ""}
          </span>
          <span className="mr-auto text-xs opacity-80">اضغط للفتح</span>
        </Link>
      )}
    </div>
  );
}
