import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // supabase/functions is Deno code with its own runtime/rules — not part of the Next app.
  globalIgnores([".next/**", ".netlify/**", ".open-next/**", ".wrangler/**", "out/**", "build/**", "next-env.d.ts", "supabase/functions/**", "docs/**"]),
]);

export default eslintConfig;
