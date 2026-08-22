"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Armchair, Settings2 } from "lucide-react";
import { listTableStatus } from "@/lib/cafe/table-actions";
import { SEATED_MINUTES, tableLabel, type CafeTable, type TableStatus } from "@/lib/cafe/tables";
import { TableLayoutEditor } from "./TableLayoutEditor";

const stateColor: Record<string, string> = {
  pending: "border-destructive bg-destructive/10 text-destructive",
  seated: "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  free: "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

/** Live floor view with a positioned map + a drag editor to arrange tables. */
export function TablesClient() {
  const [tables, setTables] = useState<TableStatus[]>([]);
  const [layout, setLayout] = useState<CafeTable[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { tables, layout } = await listTableStatus();
      setTables(tables);
      setLayout(layout);
      setLoaded(true);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    if (editing) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling an external system; state is set after an await
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh, editing]);

  const statusByName = new Map(tables.map((t) => [t.table, t]));
  const activeLayout = layout.filter((t) => t.active);
  // one map per storey — the floor is delivery information, so the runner can
  // see at a glance which level a live order is on
  const floors = [...new Set(activeLayout.map((t) => t.floor ?? 1))].sort((a, b) => a - b);
  const busy = tables.filter((t) => t.state === "pending").length;
  const seated = tables.filter((t) => t.state === "seated").length;
  const free = tables.filter((t) => t.state === "free").length;
  const guests = tables.reduce((s, t) => s + (t.guests ?? 0), 0);

  if (editing) {
    return (
      <div className="space-y-4">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Settings2 className="size-5 text-primary" />
          تنظيم الطاولات
        </h1>
        <TableLayoutEditor
          initial={layout}
          onSaved={() => {
            setEditing(false);
            void refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Armchair className="size-5 text-primary" />
          الطاولات
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-destructive">🔴 معلق: {busy}</span>
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-600 dark:text-amber-400">🟠 جالسون: {seated}</span>
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-600 dark:text-emerald-400">🟢 متاحة: {free}</span>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-primary">👥 الزبائن الآن: {guests}</span>
          <button onClick={() => setEditing(true)} className="flex items-center gap-1 rounded-full border border-border px-3 py-1 hover:bg-secondary">
            <Settings2 className="size-3.5" />
            تنظيم الطاولات
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        الطاولة مشغولة عند وجود طلب معلق، وبعد الدفع تبقى محجوزة {SEATED_MINUTES} دقيقة ثم تتحرر تلقائياً. عدد الزبائن = عدد الأصناف المطلوبة. تتحدث كل 15 ثانية.
      </p>

      {!loaded ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">جارٍ التحميل…</p>
      ) : activeLayout.length > 0 ? (
        floors.map((floor) => (
        // positioned floor map, one per storey
        <div key={floor} className="relative h-[64vh] min-h-[400px] w-full overflow-hidden rounded-2xl border-2 border-border bg-secondary/20 p-2">
          <span className="pointer-events-none absolute right-3 top-2 text-xs text-muted-foreground">
            {floors.length > 1 ? `🏢 الطابق ${floor}` : "🚪 واجهة المحل"}
          </span>
          {activeLayout.filter((lt) => (lt.floor ?? 1) === floor).map((lt) => {
            const s = statusByName.get(lt.name);
            const state = s?.state ?? "free";
            return (
              <div
                key={lt.name}
                style={{ left: `${lt.x}%`, top: `${lt.y}%`, transform: "translate(-50%, -50%)" }}
                className={`absolute flex min-h-16 w-20 flex-col items-center justify-center rounded-xl border-2 p-1 text-center shadow ${stateColor[state]}`}
              >
                <span className="text-sm font-extrabold leading-tight">{tableLabel(lt.name)}</span>
                {state === "pending" && (
                  <span className="text-[10px] font-bold">#{String(s?.seq).padStart(3, "0")} · {s?.sinceMin}د</span>
                )}
                {state === "seated" && <span className="text-[10px] font-bold">دُفع · {s?.freeInMin}د</span>}
                {state !== "free" && (s?.guests ?? 0) > 0 && <span className="text-[10px]">👥 {s?.guests}</span>}
                {state === "free" && <span className="text-[10px]">متاحة</span>}
              </div>
            );
          })}
        </div>
        ))
      ) : (
        // fallback grid when no layout is configured yet
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {tables.map((t) => (
            <div
              key={t.table}
              className={`rounded-2xl border-2 p-4 text-center ${
                t.state === "pending" ? "border-destructive bg-destructive/5" : t.state === "seated" ? "border-amber-500 bg-amber-500/5" : "border-border bg-card"
              }`}
            >
              <p className="text-2xl font-extrabold">{tableLabel(t.table)}</p>
              {t.state === "pending" && <p className="mt-1 text-sm font-bold text-destructive">🔴 معلق #{String(t.seq).padStart(3, "0")}</p>}
              {t.state === "seated" && <p className="mt-1 text-sm font-bold text-amber-600 dark:text-amber-400">🟠 دُفع · {t.freeInMin}د</p>}
              {t.state === "free" && <p className="mt-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">🟢 متاحة</p>}
              {t.state !== "free" && (t.guests ?? 0) > 0 && <p className="text-xs text-muted-foreground">👥 {t.guests} زبون</p>}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Link href="/orders" className="font-semibold text-primary underline">
          فتح الطلبات الواردة
        </Link>
      </div>
    </div>
  );
}
