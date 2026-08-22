/**
 * English master key set. `ar.ts` must mirror every key (enforced at typecheck).
 * Arabic is the shipped UI language; English strings here mostly feed the guard.
 * Grow this per feature — keep keys namespaced by area (`auth.*`, `menu.*`, …).
 */
export const en = {
  "app.name": "HAIL",
  "app.tagline": "Cafe ordering & loyalty",

  "nav.menu": "Menu",
  "nav.signIn": "Staff sign in",
  "nav.dashboard": "Dashboard",

  "auth.title": "Staff sign in",
  "auth.email": "Phone or username",
  "auth.password": "Password",
  "auth.signIn": "Sign in",
  "auth.signingIn": "Signing in…",
  "auth.error": "Sign-in failed — check your email and password.",

  "common.loading": "Loading…",
  "common.currency": "IQD",

  "dashboard.title": "Dashboard",
  "dashboard.comingSoon": "Under construction.",
} as const;
