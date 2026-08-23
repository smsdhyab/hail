import { cache } from "react";
import { cookies } from "next/headers";
import { getServerUser, createSupabaseServiceClient } from "@/lib/supabase/server";
import type { StationSlug } from "./hail-menu";
import { employeeById, isLocalDb, LOCAL_STAFF_COOKIE } from "./local-db";
import { TILL_ALL, TILL_COOKIE, isTillChoice, type TillChoice } from "./till";

/** Resolved staff identity. Server-only. */
export type StaffRole = "admin" | "cashier";
export type Staff = {
  userId: string;
  employeeId: string;
  name: string;
  email: string | null;
  role: StaffRole | null;
  /** the register this session is working — null when the till serves both */
  station: StationSlug | null;
  /** ما فُتح فعلاً: قسم بعينه أو «الكل». null = لم يُفتح صندوق بعد */
  till: TillChoice | null;
};

/**
 * The current signed-in staff member, or null.
 *
 * ONE database round trip: the employee row embeds its role and its station.
 * It used to be three sequential queries, which cost ~1s per page render when
 * the database is far away — the shop is in Iraq. `cache()` also collapses the
 * repeated calls inside a single render into one.
 */
export const getStaff = cache(async function getStaff(): Promise<Staff | null> {
  if (isLocalDb()) return getLocalStaff();

  const user = await getServerUser();
  if (!user) return null;

  const svc = createSupabaseServiceClient();
  const { data: emp } = await svc
    .from("employees")
    .select("id, name_ar, roles(name_en), stations(slug)")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!emp) return null;

  const one = <T,>(v: T[] | T | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const roleName = one(emp.roles)?.name_en;
  const role: StaffRole | null = roleName === "admin" ? "admin" : roleName === "cashier" ? "cashier" : null;

  // A cashier IS their register — the till cookie can never move them. Only a
  // manager (who owns no register) works whichever till they opened.
  const own = (one(emp.stations)?.slug as StationSlug | undefined) ?? null;
  const raw = (await cookies()).get(TILL_COOKIE)?.value;
  const till: TillChoice | null = isTillChoice(raw) ? raw : null;
  // موظف له قسم هو قسمه مهما فتح. ومن لا قسم له يتبع ما فتحه — و«الكل» يبقيه
  // بلا قسم، أي يرى القسمين ويبيعهما.
  const station = own ?? (till && till !== TILL_ALL ? till : null);

  return { userId: user.id, employeeId: emp.id, name: emp.name_ar, email: user.email ?? null, role, station, till };
});

/** Local (no-DB) session: an httpOnly cookie holding `<employeeId>:<station>`. */
async function getLocalStaff(): Promise<Staff | null> {
  const raw = (await cookies()).get(LOCAL_STAFF_COOKIE)?.value;
  if (!raw) return null;
  const [id, station] = raw.split(":");
  const emp = employeeById(id);
  if (!emp) return null;
  return {
    userId: emp.id,
    employeeId: emp.id,
    name: emp.name_ar,
    email: null,
    role: emp.role,
    // an admin works whichever register they signed into
    station: (emp.station ?? (station as StationSlug)) || null,
    till: isTillChoice(station) ? station : null,
  };
}

export async function requireStaff(): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) throw new Error("غير مصرّح — سجّل الدخول.");
  return staff;
}

export async function requireAdmin(): Promise<Staff> {
  const staff = await requireStaff();
  if (staff.role !== "admin") throw new Error("هذه الصفحة للمدير فقط.");
  return staff;
}

/**
 * The register the caller is allowed to see. Cashiers are pinned to their own;
 * an admin sees everything (null = no filter). Every station-scoped query goes
 * through this so no screen can leak the other register's numbers by accident.
 */
export function stationScope(staff: Staff): StationSlug | null {
  return staff.role === "admin" ? null : staff.station;
}

/**
 * الصفحة التي يبدأ منها كل دور.
 *
 * المدير يبدأ من لوحة التحكم، والكاشير من شاشة البيع — لا من الأرقام. كانت
 * الوجهة `/dashboard` للجميع، فكان أول ما يراه الكاشير عند الدخول مبيعات اليوم
 * وعدد الطلبات، وهي أرقام لا تخصّه ولا يحتاجها ليبيع.
 *
 * مكتوبة هنا وحدها لأن ثلاثة مواضع كانت تقرّر الوجهة كلٌّ على حدة (صفحة
 * الدخول، الجذر، وشعار الشريط العلوي) — فتغييرها في واحد يترك الآخرين.
 */
export function homeFor(role: StaffRole | null): string {
  return role === "admin" ? "/dashboard" : "/cashier";
}
