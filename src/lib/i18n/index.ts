import { en } from "./en";
import { ar } from "./ar";

/**
 * HAIL i18n core.
 *
 * - `en` is the master key set; `TranslationKey = keyof typeof en`.
 * - `ar` (./ar.ts) is typed `Dictionary` = Record<TranslationKey, string>, so
 *   both dictionaries are guaranteed identical at TYPECHECK time: a missing key
 *   in `ar` OR an extra key not present in `en` is a type error.
 * - `translate()` never falls back across languages — completeness is enforced
 *   by the types. Values may contain `{param}` placeholders.
 *
 * The app is Arabic-first; `en` exists mainly to power this completeness guard.
 */

export type Language = "ar" | "en";
export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;
export type TranslationParams = Record<string, string | number>;
export type Translator = (key: TranslationKey, params?: TranslationParams) => string;

export { en, ar };

const DICTIONARIES: Record<Language, Dictionary> = { en, ar };

export function translate(language: Language, key: TranslationKey, params?: TranslationParams): string {
  const raw = DICTIONARIES[language][key];
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
