import { cookies } from "next/headers";
import { getServerUser, createSupabaseServiceClient } from "@/lib/supabase/server";
import type { StationSlug } from "./hail-menu";
import { employeeById, isLocalDb, LOCAL_STAFF_COOKIE } from "./local-db";

/** Resolved staff identity. Server-only. */
export type StaffRole = "admin" | "cashier";
export type Staff = {
  userId: string;
  employeeId: string;
  name: string;
  email: string | null;
  role: StaffRole | null;
  /** the register this session is working — null only for an unassigned admin */
  station: StationSlug | null;
};

/** The current signed-in staff member, or null. Uses the service client to read
 *  the employees/roles tables reliably (after the auth token is validated). */
export async function getStaff(): Promise<Staff | null> {
  if (isLocalDb()) return getLocalStaff();

  const user = await getServerUser();
  if (!user) return null;

  const svc = createSupabaseServiceClient();
  const { data: emp } = await svc
    .from("employees")
    .select("id, name_ar, role_id, station_id")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!emp) return null;

  let role: StaffRole | null = null;
  if (emp.role_id) {
    const { data: r } = await svc.from("roles").select("name_en").eq("id", emp.role_id).maybeSingle();
    role = r?.name_en === "admin" ? "admin" : r?.name_en === "cashier" ? "cashier" : null;
  }

  let station: StationSlug | null = null;
  if (emp.station_id) {
    const { data: s } = await svc.from("stations").select("slug").eq("id", emp.station_id).maybeSingle();
    station = (s?.slug as StationSlug) ?? null;
  }

  return { userId: user.id, employeeId: emp.id, name: emp.name_ar, email: user.email ?? null, role, station };
}

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
