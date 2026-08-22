/**
 * The HAIL badge — the owner's official circular mark («مخبز ومقهى هيل / HAIL
 * BAKERY & CAFE»), extracted from the Adobe XD design file and keyed to a
 * transparent background so it reads on the olive panels and the cream menu
 * alike. Source: design/xd/ · regenerate the icon set with make-pwa-icons.mjs.
 */
export function HailMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo.png" alt="مخبز ومقهى هيل" className={className} loading="lazy" />
  );
}
