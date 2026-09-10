/// <reference types="vitest" />

import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite";

import { relayShim } from "@anlg/plugin-relay/vite";

import { changelog } from "./plugins/changelog";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  // One name for both halves of the app: the Rust side reads SENTRY_DSN through
  // option_env!, and this hands the same value to the webview. Empty means error
  // reporting stays off.
  define: {
    "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(
      process.env.SENTRY_DSN ?? "",
    ),
  },
  plugins: [
    relayShim(),
    changelog(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    lingui(),
    babel({
      presets: [linguiTransformerBabelPreset()],
    }),
  ],
  resolve: {
    tsconfigPaths: true,
    alias:
      process.env.NODE_ENV === "development"
        ? {
            "@tauri-apps/plugin-updater": "/src/shared/mock-updater.ts",
          }
        : {},
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/autocomplete",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/lang-jinja",
      "codemirror-readonly-ranges",
      "@uiw/react-codemirror",
    ],
  },
  test: {
    reporters: "default",
    onConsoleLog: (_, type) => {
      return type === "stderr";
    },
    exclude: ["**/node_modules/**", "**/src-tauri/**"],
    projects: [
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          setupFiles: ["./src/test-setup.ts"],
          exclude: [
            "**/node_modules/**",
            "**/src-tauri/**",
            "**/*.sql.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "sql",
          environment: "node",
          setupFiles: [],
          include: ["**/*.sql.test.ts"],
        },
      },
    ],
  },
  ...tauri,
}));

// https://v2.tauri.app/start/frontend/vite/#update-vite-configuration
const tauri: UserConfig = {
  clearScreen: false,
  server: {
    port: 1422,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1423,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    outDir: "./dist",
    chunkSizeWarningLimit: 500 * 10,
    target:
      process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "terser",
    // Maps are built for a release only when there is somewhere to send them.
    // "hidden" keeps the bundle from pointing at them — Sentry matches them by
    // the debug id injected before the upload — and before-bundle.mjs deletes
    // them, so the app never ships its own source.
    sourcemap: process.env.TAURI_ENV_DEBUG
      ? true
      : process.env.SENTRY_AUTH_TOKEN
        ? "hidden"
        : false,
  },
};
