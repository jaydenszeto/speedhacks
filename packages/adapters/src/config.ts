/**
 * Composition root: read env, decide live vs mock per sponsor, and build the adapter set. Every live dependency has a
 * mock fallback so DEMO_FALLBACK=1 (or a missing key) produces the same on-screen result.
 */
import { DarwinLive, DarwinMock, type DarwinAdapter } from "./darwin.js";
import { DialLive, DialMock, type DialAdapter } from "./dial.js";
import { KeewanoLive, KeewanoMock, type KeewanoAdapter } from "./keewano.js";
import { SpartaLive, SpartaMock, type SpartaAdapter } from "./sparta.js";
import { AlikeMock, type AlikeAdapter } from "./alike.js";

export interface TripwireConfig {
  demoFallback: boolean;
  ownerPhone?: string;
  liveCanaryCalls: boolean;
  dialCanaryNumbers: string[];
  mirrorPath: string;
  sparta: { url: string; adminToken?: string };
}

export interface Adapters {
  sparta: SpartaAdapter;
  dial: DialAdapter;
  keewano: KeewanoAdapter;
  darwin: DarwinAdapter;
  alike: AlikeAdapter;
  config: TripwireConfig;
}

function flag(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TripwireConfig {
  return {
    demoFallback: flag(env.DEMO_FALLBACK),
    ownerPhone: env.OWNER_PHONE?.trim() || undefined,
    liveCanaryCalls: flag(env.LIVE_CANARY_CALLS),
    dialCanaryNumbers: (env.DIAL_CANARY_NUMBERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    mirrorPath: env.KEEWANO_MIRROR ?? "data/keewano-mirror.jsonl",
    sparta: { url: env.WORLDS_URL ?? "http://127.0.0.1:4242", adminToken: env.WORLDS_ADMIN_TOKEN },
  };
}

export function buildAdapters(env: NodeJS.ProcessEnv = process.env): Adapters {
  const config = loadConfig(env);
  const demo = config.demoFallback;

  const sparta: SpartaAdapter = demo ? new SpartaMock() : new SpartaLive(config.sparta.url, config.sparta.adminToken);

  const dialKey = env.DIAL_API_KEY?.trim();
  const dialFrom = env.DIAL_FROM_NUMBER?.trim();
  const dial: DialAdapter = demo || !dialKey || !dialFrom
    ? new DialMock(dialFrom ?? "+14155550100", config.dialCanaryNumbers)
    : new DialLive(dialKey, dialFrom, config.dialCanaryNumbers);

  const kwKey = env.KEEWANO_API_KEY?.trim();
  const keewano: KeewanoAdapter = demo || !kwKey
    ? new KeewanoMock(config.mirrorPath)
    : new KeewanoLive({ apiKey: kwKey, pat: env.KEEWANO_PAT?.trim(), projectId: env.KEEWANO_PROJECT_ID?.trim(), email: env.KEEWANO_EMAIL?.trim(), mirrorPath: config.mirrorPath });

  const darwin: DarwinAdapter = demo ? new DarwinMock() : new DarwinLive(env.DARWIN_API_KEY?.trim());

  return { sparta, dial, keewano, darwin, alike: new AlikeMock(), config };
}
