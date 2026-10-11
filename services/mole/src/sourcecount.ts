/**
 * Measure what a person would have had to review before trusting this server: source files, lines of code, and
 * dependencies. Every number here is counted from disk — nothing is estimated. If the target's source can't be
 * located on disk (e.g. a remote-only package), the counts are reported as unavailable rather than guessed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface SourceCount {
  root?: string;
  files: number;
  lines: number;
  dependencies: number;
  depsKind: "transitive" | "direct" | "none";
  located: boolean;
}

const CODE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rb", ".rs", ".java", ".php"]);
const SKIP_ALWAYS = new Set(["node_modules", ".git", ".worlds", "coverage", ".next", ".cache"]);
// Generated output we skip only when real source sits alongside it (a published package ships just dist/).
const SKIP_IF_SRC = new Set(["dist", "build", "out"]);

function ext(p: string): string {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i);
}

function nearestPackageRoot(start: string): string {
  let dir = statSync(start).isDirectory() ? start : dirname(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return statSync(start).isDirectory() ? start : dirname(start);
}

/** Resolve the target command to a source directory on disk, if we can find one. */
function locateRoot(command: string, args: string[]): string | undefined {
  // 1. A local path argument that exists (node server.js, tsx server.ts, a directory).
  for (const a of [command, ...args]) {
    if (!a || a.startsWith("-")) continue;
    if (["node", "npx", "tsx", "npm", "pnpm", "bunx", "uvx", "python", "python3"].includes(a)) continue;
    const p = resolve(a);
    if (existsSync(p) && p !== process.cwd()) return nearestPackageRoot(p);
  }
  // 2. A package name (bare or scoped) we can resolve from our own node_modules.
  const pkg = args.find((a) => !a.startsWith("-") && /^(@[\w.-]+\/)?[\w.-]+$/.test(a) && a !== ".");
  if (pkg) {
    try {
      const req = createRequire(join(process.cwd(), "noop.js"));
      return dirname(req.resolve(`${pkg}/package.json`));
    } catch { /* not in scope */ }
    // 3. npx cache: ~/.npm/_npx/<hash>/node_modules/<pkg>
    const npx = join(homedir(), ".npm", "_npx");
    if (existsSync(npx)) {
      for (const h of readdirSync(npx)) {
        const cand = join(npx, h, "node_modules", pkg, "package.json");
        if (existsSync(cand)) return dirname(cand);
      }
    }
  }
  return undefined;
}

function walk(root: string): { files: number; lines: number } {
  let files = 0, lines = 0;
  const hasSrc = existsSync(join(root, "src")) || existsSync(join(root, "lib"));
  const skip = (name: string) => SKIP_ALWAYS.has(name) || (hasSrc && SKIP_IF_SRC.has(name));
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { if (!skip(name) && !name.startsWith(".")) stack.push(full); continue; }
      if (!CODE_EXT.has(ext(name))) continue;
      files++;
      try { lines += readFileSync(full, "utf8").split("\n").length; } catch { /* unreadable */ }
    }
  }
  return { files, lines };
}

function countDeps(root: string): { dependencies: number; depsKind: SourceCount["depsKind"] } {
  // Transitive if the package's node_modules is present; else direct from package.json.
  const nm = join(root, "node_modules");
  if (existsSync(nm)) {
    let n = 0;
    for (const name of readdirSync(nm)) {
      if (name.startsWith(".")) continue;
      if (name.startsWith("@")) { try { n += readdirSync(join(nm, name)).length; } catch { /* skip */ } }
      else n++;
    }
    if (n > 0) return { dependencies: n, depsKind: "transitive" };
  }
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const n = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }).length;
    return { dependencies: n, depsKind: n ? "direct" : "none" };
  } catch { return { dependencies: 0, depsKind: "none" }; }
}

export function countSource(command: string, args: string[]): SourceCount {
  const root = locateRoot(command, args);
  if (!root) return { files: 0, lines: 0, dependencies: 0, depsKind: "none", located: false };
  const { files, lines } = walk(root);
  const { dependencies, depsKind } = countDeps(root);
  return { root, files, lines, dependencies, depsKind, located: true };
}
