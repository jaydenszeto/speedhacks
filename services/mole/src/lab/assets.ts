/**
 * Where the lab's runnable assets and data live.
 *
 * From the repo (the default): fixtures run as TypeScript through tsx, and data goes to ./.mole.
 * In a bundled deploy, scripts/build-vercel.ts lays out the same tree under one directory and sets MOLE_ASSETS to it.
 * Each fixture also ships prebuilt as plain JS under prebuilt/, so the same code runs without a TypeScript toolchain.
 * MOLE_DATA points the record and the identity ledger at a writable directory (a serverless filesystem is read-only).
 */
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));

export const ASSETS = process.env.MOLE_ASSETS;
export const REPO = ASSETS ?? resolve(HERE, "../../../..");
export const OBSERVER = join(REPO, "services/mole/sandbox/observe.cjs");
export const dataDir = () => process.env.MOLE_DATA ?? join(process.cwd(), ".mole");

/** The prebuilt JS for a fixture entry (a .ts path under REPO). */
export const prebuilt = (entry: string) => join(REPO, "prebuilt", relative(REPO, entry).replace(/\.ts$/, ".mjs"));

/** Node arguments that run a fixture entry: tsx from the repo, the prebuilt JS in a bundled deploy. */
export const nodeArgs = (entry: string): string[] => (ASSETS ? [prebuilt(entry)] : ["--import", "tsx", entry]);

/** How a run is described in the UI: the source path, relative to the repo. */
export const describeEntry = (entry: string) => `node ${ASSETS ? "" : "--import tsx "}${relative(REPO, entry)}`;
