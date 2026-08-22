/**
 * Shared Supabase configuration. Keys are read from the environment only.
 * The auth session is persisted under a cookie (not localStorage) so the
 * Next.js proxy (auth gate) and server components can read it — this replaces
 * the role normally played by @supabase/ssr, which we intentionally do not add.
 */

/** Cookie/storage key that holds the serialized Supabase session. */
export const AUTH_STORAGE_KEY = "hail-auth";

/** Session cookie lifetime (7 days). Access tokens still auto-refresh. */
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * Reads an env var via BRACKET access so Next.js does NOT statically inline it
 * at build time. On the server this returns the RUNTIME value — which is what
 * makes the public Supabase config work on hosts (Netlify / VPS) where the
 * NEXT_PUBLIC_* vars were not present during `next build`.
 */
function readEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** Server-side: the PUBLIC Supabase config, read at RUNTIME. Null if unset. */
export function getPublicSupabaseConfig(): { url: string; anonKey: string } | null {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return url && anonKey ? { url, anonKey } : null;
}

/** Shape injected into the HTML by the root layout. */
export type PublicEnv = { supabaseUrl?: string; supabaseAnonKey?: string };

export function getSupabaseEnv(): { url: string; anonKey: string } {
  // On the client, prefer the config injected by the server at runtime. This is
  // what lets the app work when NEXT_PUBLIC_* were NOT baked into the bundle at
  // build time — the browser reads them from the server-rendered <script>.
  if (typeof window !== "undefined") {
    const injected = (window as unknown as { __ENV__?: PublicEnv }).__ENV__;
    if (injected?.supabaseUrl && injected?.supabaseAnonKey) {
      return { url: injected.supabaseUrl, anonKey: injected.supabaseAnonKey };
    }
  }

  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL") ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (in .env.local locally, or as environment variables on your host).",
    );
  }

  return { url, anonKey };
}

/** Extracts `access_token` / `expires_at` from a serialized session cookie value. */
export function parseSessionCookie(
  raw: string | undefined,
): { accessToken: string; refreshToken: string | null; expiresAt: number | null } | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const session = JSON.parse(decoded) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    };
    if (!session.access_token) return null;
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token ?? null,
      expiresAt: typeof session.expires_at === "number" ? session.expires_at : null,
    };
  } catch {
    return null;
  }
}
