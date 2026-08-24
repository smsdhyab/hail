import { redirect } from "next/navigation";
import { getStaff } from "@/lib/cafe/auth";
import { isDemoServer } from "@/lib/cafe/demo";
import { getPastryAlertCount } from "@/lib/cafe/pastry-actions";
import { isLocalDb } from "@/lib/cafe/local-db";
import { stationName } from "@/lib/cafe/hail-menu";
import { StaffShell } from "@/components/cafe/StaffShell";

// Auth + role are resolved per request (runtime env, session cookie).
export const dynamic = "force-dynamic";

// Staff screens install as the separate «إدارة هيل» PWA (admin badge icon,
// opens on the dashboard) instead of the customer menu app.
export const metadata = { manifest: "/admin-manifest.webmanifest" };

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const pushKey = process.env.WEB_PUSH_PUBLIC_KEY ?? null;
  const local = isLocalDb();
  // LOCAL mode has real (file-backed) sessions, so it must be checked BEFORE
  // the demo shortcut — otherwise every visitor would be shown as an admin.
  if (local) {
    const staff = await getStaff();
    if (!staff) redirect("/sign-in");
    return (
      <StaffShell role={staff.role} isDeveloper={staff.isDeveloper} name={staff.name} station={stationName(staff.station)} localMode pushKey={pushKey}>
        {children}
      </StaffShell>
    );
  }
  if (isDemoServer()) {
    // Demo trial (no Supabase configured): browsable shell, no real data.
    return (
      <StaffShell role="admin" name="وضع تجريبي" pushKey={pushKey}>
        {children}
      </StaffShell>
    );
  }
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  const pastryAlert = await getPastryAlertCount().catch(() => 0);
  return (
    <StaffShell role={staff.role} isDeveloper={staff.isDeveloper} name={staff.name} station={stationName(staff.station)} pushKey={pushKey} pastryAlert={pastryAlert}>
      {children}
    </StaffShell>
  );
}
