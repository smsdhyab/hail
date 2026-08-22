/**
 * Icons for the two cash registers.
 *
 * Drawn as strokes that inherit `currentColor`, exactly like MenuIcon, so they
 * tint with the HAIL palette wherever they sit (olive on cream, cream on
 * olive) instead of dropping a fixed-colour emoji into the design.
 */

import type { StationSlug } from "@/lib/cafe/hail-menu";

const BASE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** المعجنات والمخبوزات — croissant: a body with three scored folds. */
function PastryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...BASE}>
      <path d="M3.4 15.6c-.7-.5-.6-1.5.2-1.8 3-1.2 5.4-3.2 6.9-5.9.4-.7 1.4-.7 1.8 0 1.5 2.7 3.9 4.7 6.9 5.9.8.3.9 1.3.2 1.8-1.2.9-2.6 1.4-4.1 1.4H7.5c-1.5 0-2.9-.5-4.1-1.4Z" />
      <path d="M9.6 9.7c-.5 2.3-.6 4.7-.3 7.3M14.4 9.7c.5 2.3.6 4.7.3 7.3M12 8.3v8.7" />
      <path d="M4.2 14.2c-.9-.6-1.7-1.4-2.2-2.4M19.8 14.2c.9-.6 1.7-1.4 2.2-2.4" />
    </svg>
  );
}

/** الكافيه — a cup on a saucer with rising steam. */
function CafeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...BASE}>
      <path d="M5 10h12v3.5A4.5 4.5 0 0 1 12.5 18h-3A4.5 4.5 0 0 1 5 13.5V10Z" />
      <path d="M17 11h1.3a2.2 2.2 0 0 1 0 4.4H17" />
      <path d="M3.5 20.5h16" />
      <path d="M9 7.2c.7-.8.7-1.6 0-2.4M12 6.8c.7-.8.7-1.6 0-2.4M15 7.2c.7-.8.7-1.6 0-2.4" opacity={0.75} />
    </svg>
  );
}

export function StationIcon({ station, className }: { station: StationSlug; className?: string }) {
  return station === "pastry" ? <PastryIcon className={className} /> : <CafeIcon className={className} />;
}
