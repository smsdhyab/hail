"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { StationSlug } from "./hail-menu";
import { findEmployee, isLocalDb, LOCAL_STAFF_COOKIE } from "./local-db";

/**
 * Sign-in for LOCAL mode only (no Supabase). Deliberately minimal: the cookie
 * holds the employee id, nothing is signed, and PINs live in plain text in the
 * JSON store. `isLocalDb()` gates every entry point, and it requires an
 * explicit HAIL_LOCAL_DB=1 plus the absence of Supabase creds, so this path
 * cannot be reached on a real deployment.
 *
 * ponytail: replaced wholesale by Supabase Auth (SignInForm's existing
 * email/password flow) the moment a database is configured.
 */

export async function signInLocal(
  login: string,
  pin: string,
  station: StationSlug,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isLocalDb()) return { ok: false, error: "الوضع المحلي غير مفعّل." };

  const emp = findEmployee(login, pin);
  if (!emp) return { ok: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة." };
  // A cashier may only open their own register; the manager may open either.
  if (emp.role !== "admin" && emp.station !== station) {
    return { ok: false, error: "هذا الحساب لا يعمل على هذا الكاشير." };
  }

  const jar = await cookies();
  jar.set(LOCAL_STAFF_COOKIE, `${emp.id}:${station}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // one shift
  });
  return { ok: true };
}

export async function signOutLocal(): Promise<void> {
  const jar = await cookies();
  jar.delete(LOCAL_STAFF_COOKIE);
  redirect("/sign-in");
}
