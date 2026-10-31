/**
 * esbuild settings for turning a TypeScript entry into one plain-JS file that runs on bare Node. Shared by
 * scripts/build-vercel.ts (the function, the fixtures, the microVM runner) and microvm.ts (building the runner on
 * the fly in dev). A plain object, so importing it doesn't load esbuild.
 */
export const bundleOptions = {
  bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "warning", legalComments: "none",
  // ESM bundles of CommonJS dependencies still call require / __dirname.
  banner: {
    js: [
      'import { createRequire as __mkRequire } from "node:module";',
      'import { fileURLToPath as __toPath } from "node:url";',
      'import { dirname as __dirnameOf } from "node:path";',
      "const require = __mkRequire(import.meta.url);",
      "const __filename = __toPath(import.meta.url);",
      "const __dirname = __dirnameOf(__filename);",
    ].join("\n"),
  },
} as const;
