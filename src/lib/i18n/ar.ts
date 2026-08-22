import type { Dictionary } from "./index";

/**
 * Arabic dictionary — the shipped UI language. Typed as `Dictionary`, so it must
 * contain exactly the keys in `en` (a missing or extra key is a type error).
 */
export const ar: Dictionary = {
  "app.name": "مخبز ومقهى هيل",
  "app.tagline": "طلبات الكافيه والولاء",

  "nav.menu": "المنيو",
  "nav.signIn": "دخول الموظفين",
  "nav.dashboard": "لوحة التحكم",

  "auth.title": "دخول الموظفين",
  "auth.email": "رقم الهاتف أو اسم المستخدم",
  "auth.password": "كلمة المرور",
  "auth.signIn": "تسجيل الدخول",
  "auth.signingIn": "جارٍ الدخول…",
  "auth.error": "فشل تسجيل الدخول — تحقّق من البريد وكلمة المرور.",

  "common.loading": "جارٍ التحميل…",
  "common.currency": "د.ع",

  "dashboard.title": "لوحة التحكم",
  "dashboard.comingSoon": "قيد الإنشاء.",
};
