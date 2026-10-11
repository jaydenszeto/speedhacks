#!/usr/bin/env -S node --import tsx
// Mole CLI launcher. Runs the TypeScript entry directly via the tsx loader so there is no build step.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
await import(resolve(here, "../src/cli.ts"));
