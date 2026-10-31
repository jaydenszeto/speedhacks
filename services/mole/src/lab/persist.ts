/**
 * Shared persistence for a deploy that runs on many short-lived instances (Vercel Functions).
 *
 * Locally the record and the identity ledger are JSON files and nothing here runs. When a Vercel Blob store is
 * attached (BLOB_READ_WRITE_TOKEN, or OIDC with BLOB_STORE_ID), each collection is mirrored to one private blob:
 *
 *   pull()   fetch the blob if it changed (ETag) and merge it into memory
 *   push()   pull, merge, then write with If-Match; on a conflict, retry
 *
 * Both collections are append-only sets keyed by id, so merging is a union and never loses a trial or an identity,
 * whichever instance wrote it.
 */
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

export interface Mergeable<T extends { id: string }> {
  snapshot(): T[];
  merge(items: T[]): void;
}

/**
 * Blob serves larger bodies compressed, and a compressed response carries a weak ETag (W/"…"). Conditional writes
 * (If-Match) only accept the strong form, so a weak tag made every write after a fresh read fail its precondition.
 */
export const strongEtag = (etag?: string) => etag?.replace(/^W\//, "");

export const blobEnabled = () => !!(process.env.BLOB_READ_WRITE_TOKEN || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN));

export class BlobMirror<T extends { id: string }> {
  private etag?: string;
  private lastPull = 0;

  constructor(private readonly pathname: string, private readonly key: string, private readonly target: Mergeable<T>) {}

  /** Merge the shared copy into memory. Skipped if pulled within `maxAgeMs`. */
  async pull(maxAgeMs = 0): Promise<void> {
    if (Date.now() - this.lastPull < maxAgeMs) return;
    const res = await get(this.pathname, { access: "private", useCache: false, ifNoneMatch: this.etag });
    this.lastPull = Date.now();
    if (!res || res.statusCode === 304) return;
    const text = await new Response(res.stream).text();
    this.etag = strongEtag(res.blob.etag);
    try { this.target.merge(((JSON.parse(text) as Record<string, T[]>)[this.key]) ?? []); } catch { /* corrupt copy: keep memory */ }
  }

  /** Write memory (merged with the latest shared copy) back, with optimistic concurrency. */
  async push(): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.pull();
      try {
        const body = JSON.stringify({ [this.key]: this.target.snapshot() });
        const r = await put(this.pathname, body, {
          access: "private", contentType: "application/json", cacheControlMaxAge: 60, addRandomSuffix: false,
          ...(this.etag ? { ifMatch: this.etag } : { allowOverwrite: true }),
        });
        this.etag = r.etag;
        return;
      } catch (e) {
        if (!(e instanceof BlobPreconditionFailedError)) throw e;
        this.lastPull = 0; // someone else wrote: re-pull and merge
      }
    }
    throw new Error(`couldn't save ${this.pathname} after concurrent writes`);
  }
}
