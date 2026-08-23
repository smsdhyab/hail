import type { StationSlug } from "./hail-menu";

/** Which register this session opened. A plain module, not a server action,
 *  so both auth.ts and till-actions.ts can share the cookie name. */
export const TILL_COOKIE = "hail-till";

/**
 * ما يفتحه هذا الجهاز.
 *
 * «all» = صندوق واحد يبيع القسمين معاً — المحل صار كاشيراً واحداً في مكان
 * واحد. الدفتران يبقيان منفصلين لأن الفصل يتم بالصنف لا بالصندوق.
 */
export const TILL_ALL = "all" as const;
export type TillChoice = StationSlug | typeof TILL_ALL;

export function isTillChoice(v: string | undefined | null): v is TillChoice {
  return v === "pastry" || v === "cafe" || v === TILL_ALL;
}
