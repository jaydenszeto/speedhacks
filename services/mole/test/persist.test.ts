/**
 * Shared persistence (persist.ts): the record and identity ledger mirrored to one private Vercel Blob each.
 *
 *   always        ETag normalization (the weak-tag bug: a compressed read returned W/"…", and every conditional write
 *                 after it failed with "couldn't save after concurrent writes")
 *   with a token  two mirrors standing in for two function instances, on a scratch blob: a fresh instance reads a
 *                 record-sized blob (served compressed, weak ETag), writes, and both instances end with the union.
 *                 Needs BLOB_READ_WRITE_TOKEN (`vercel env pull .env.local`, then source it).
 */
import { del } from "@vercel/blob";
import { afterAll, describe, expect, it } from "vitest";
import { BlobMirror, strongEtag, type Mergeable } from "../src/lab/persist.js";

describe("blob ETags", () => {
  it("strips the weak prefix so If-Match accepts it", () => {
    expect(strongEtag('W/"a7fe05e2"')).toBe('"a7fe05e2"');
    expect(strongEtag('"a7fe05e2"')).toBe('"a7fe05e2"');
    expect(strongEtag(undefined)).toBeUndefined();
  });
});

class Memory implements Mergeable<{ id: string; n: number }> {
  items: { id: string; n: number }[] = [];
  snapshot() { return [...this.items]; }
  merge(more: { id: string; n: number }[]) {
    const have = new Set(this.items.map((i) => i.id));
    this.items.push(...more.filter((i) => !have.has(i.id)));
  }
}

const PATH = `mole/_test-${Date.now().toString(36)}.json`;

describe.skipIf(!process.env.BLOB_READ_WRITE_TOKEN)("blob mirror · real Vercel Blob", () => {
  afterAll(async () => { await del(PATH).catch(() => undefined); });

  it("a fresh instance can write after reading a large (compressed, weak-ETag) blob, and nothing is lost", async () => {
    const a = new Memory();
    a.items = Array.from({ length: 400 }, (_, i) => ({ id: `a${i}`, n: i }));
    await new BlobMirror(PATH, "items", a).push();

    const b = new Memory();
    const mb = new BlobMirror(PATH, "items", b);
    await mb.pull();
    expect(b.items).toHaveLength(400);
    b.items.push({ id: "b0", n: -1 });
    await mb.push(); // failed before the fix

    const c = new Memory();
    await new BlobMirror(PATH, "items", c).pull();
    expect(c.items).toHaveLength(401);
    expect(c.items.some((i) => i.id === "b0")).toBe(true);
  }, 60_000);
});
