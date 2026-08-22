"use server";

import { cookies } from "next/headers";
import { requireStaff } from "./auth";
import { stationName, type StationSlug } from "./hail-menu";
import { TILL_COOKIE } from "./till";

/**
 * Opening a register.
 *
 * Signing in with Supabase only proves WHO you are — it says nothing about
 * WHICH till you may open. This is the second half: the register picked on the
 * sign-in screen is checked against the employee's own register, server-side,
 * and only then remembered for the session.
 *
 *   • a cashier may open ONLY their own register;
 *   • the manager may open either, and the choice is what the receipts and the
 *     cash drawer are attributed to.
 *
 * The caller signs the user straight back out when this refuses, so a rejected
 * choice never leaves a usable session behind.
 */
export async function openTill(
  station: StationSlug,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await requireStaff();

  if (staff.role !== "admin" && staff.station !== station) {
    return {
      ok: false,
      error: `هذا الحساب يعمل على ${stationName(staff.station)} فقط — لا يمكنه فتح ${stationName(station)}.`,
    };
  }

  (await cookies()).set(TILL_COOKIE, station, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // one shift
  });
  return { ok: true };
}

export async function closeTill(): Promise<void> {
  (await cookies()).delete(TILL_COOKIE);
}
