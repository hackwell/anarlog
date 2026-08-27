import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  sourceLocale: "en",
  locales: ["de", "en"],
  compileNamespace: "ts",
  format: formatter({ lineNumbers: false }),
  fallbackLocales: {
    default: "en",
  },
  catalogs: [
    {
      path: "<rootDir>/src/i18n/locales/{locale}/messages",
      include: ["<rootDir>/src"],
      exclude: ["**/*.test.*", "**/routeTree.gen.ts", "**/i18n/locales/**"],
    },
  ],
});
