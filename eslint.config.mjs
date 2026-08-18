import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    /**
     * Generated and vendored trees. Without this `npm run lint` walks into the build
     * output and reports tens of thousands of errors in code nobody wrote — which
     * hides the handful that are real. `.next` is Next's output, and `.claude/skills`
     * is installed by `npx skills add`, so neither is ours to fix.
     */
    ignores: [".next/**", "out/**", "build/**", ".claude/skills/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
