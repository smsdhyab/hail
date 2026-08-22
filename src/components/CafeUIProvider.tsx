"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { translate, type Language, type Translator } from "@/lib/i18n";

/**
 * Single authority over document direction, theme, and language. Persists to
 * localStorage. Arabic-first: defaults to `ar` / RTL. (No table/cards view mode —
 * that was Traveliun-specific.)
 */

export type ThemeMode = "Light" | "Dark" | "System";

type CafeUIContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  dir: "rtl" | "ltr";
  t: Translator;
};

const CafeUIContext = createContext<CafeUIContextValue | null>(null);

const STORAGE_KEY = "hail-ui";

type PersistedState = { language: Language; theme: ThemeMode };

function readPersisted(): Partial<PersistedState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedState>) : {};
  } catch {
    return {};
  }
}

function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const isDark = theme === "Dark" || (theme === "System" && prefersDark);
  document.documentElement.classList.toggle("dark", isDark);
}

export function CafeUIProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("ar");
  const [theme, setThemeState] = useState<ThemeMode>("System");

  useEffect(() => {
    // one-time sync from localStorage AFTER hydration — deliberate: a lazy
    // useState initializer would mismatch the server-rendered HTML.
    const persisted = readPersisted();
    /* eslint-disable react-hooks/set-state-in-effect */
    if (persisted.language) setLanguageState(persisted.language);
    if (persisted.theme) setThemeState(persisted.theme);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const persist = useCallback(
    (next: Partial<PersistedState>) => {
      if (typeof window === "undefined") return;
      const current = readPersisted();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ language, theme, ...current, ...next }));
    },
    [language, theme],
  );

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "System" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("System");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  const setLanguage = useCallback((next: Language) => { setLanguageState(next); persist({ language: next }); }, [persist]);
  const setTheme = useCallback((next: ThemeMode) => { setThemeState(next); persist({ theme: next }); }, [persist]);

  const dir = language === "ar" ? "rtl" : "ltr";
  const t = useCallback<Translator>((key, params) => translate(language, key, params), [language]);

  return (
    <CafeUIContext.Provider value={{ language, setLanguage, theme, setTheme, dir, t }}>
      {children}
    </CafeUIContext.Provider>
  );
}

export function useCafeUI(): CafeUIContextValue {
  const ctx = useContext(CafeUIContext);
  if (!ctx) {
    // Safe fallback for components rendered outside the provider — Arabic, light.
    return {
      language: "ar",
      setLanguage: () => {},
      theme: "System",
      setTheme: () => {},
      dir: "rtl",
      t: (key, params) => translate("ar", key, params),
    };
  }
  return ctx;
}
