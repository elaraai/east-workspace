/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The rack data-plane seam (#74, epic #67 design §10) — how the /rack
 * storage routes hand object bytes to a credential-free agent:
 *
 * - objects travel by **presigned URL** — the API mints URLs, the agent
 *   transfers directly against the store, the API is never a byte proxy. A
 *   bridge that holds an object's bytes at hand may send them **inline** in
 *   the response body instead; the AWS bridge does not, as every object's
 *   bytes are in S3 (elaraai/e3-cloud#201);
 * - each object a lease's guest wrote is **PUT at its content address**
 *   through a target bound to its SHA-256 and to the lease (#214), so the
 *   store refuses any other bytes; its commit checks the version the agent
 *   made (size, checksum, lease) and registers it, and never reads its body;
 * - a lease that ends without committing what it wrote has those versions
 *   **discarded**: no uncatalogued version is left at a content address.
 *
 * Implemented by `S3DynamoRackStorageBridge` (e3-aws, over S3 and the object
 * catalogue) and `InMemoryRackStorageBridge` (testing).
 */

/** How the agent should obtain one object. */
export type RackObjectRead =
  | { kind: 'inline'; data: Uint8Array }
  | { kind: 'url'; url: string };

/** A PUT target for one object at its content address (#214). */
export interface RackPutTarget {
  /** The presigned URL */
  readonly url: string;
  /** The headers the PUT must send, as given: they are signed into its URL
   *  (the SHA-256 the store checks, and the lease's tag) */
  readonly headers: Readonly<Record<string, string>>;
}

/** Supplies scoped object transfers and environment layers to rack routes. */
export interface RackStorageBridge {
  /**
   * Descriptor for an object the agent lacks: a presigned GET URL, or the
   * bytes inline when the bridge holds them at hand.
   *
   * @param repo - The lease's repo
   * @param hash - The object hash (already scope-validated by the route)
   */
  readDescriptor(repo: string, hash: string): Promise<RackObjectRead>;

  /**
   * A PUT target for an object a lease's guest wrote, at its content address,
   * bound to its SHA-256 (the store refuses other bytes) and tagged with the
   * lease (what {@link discardWrites} deletes). When the store holds the
   * object already, it is re-referenced instead, as a write of it would be,
   * and nothing is to be sent.
   *
   * @param repo - The lease's repo
   * @param leaseId - The lease
   * @param hash - The object's hash, as the agent declares it
   * @param size - Its size in bytes
   * @returns The target, or null when the store holds the object
   */
  writeTarget(repo: string, leaseId: string, hash: string, size: number): Promise<RackPutTarget | null>;

  /**
   * Takes in an object the agent PUT through a {@link writeTarget}: the
   * version it made is checked (its size, its SHA-256 as the store computed
   * it, and the lease's tag) and registered in the object catalogue, in one
   * write with the condition that the rack holds the lease. So a commit that
   * races its lease's end registers nothing, and the end's
   * {@link discardWrites} never deletes a version the catalogue pins. Never a
   * body read. An object another writer registered first is re-referenced,
   * and this version deleted; a commit sent again is answered as the first.
   *
   * @param repo - The lease's repo
   * @param leaseId - The lease
   * @param rackId - The rack that holds it
   * @param hash - The object's hash
   * @param size - Its size in bytes
   * @param version - The version the agent's PUT made, as the store answered it
   * @returns false when the version is not the lease's, not these bytes, or
   *   the lease is not the rack's
   */
  commitWrite(repo: string, leaseId: string, rackId: string, hash: string, size: number, version: string): Promise<boolean>;

  /**
   * Deletes what a lease wrote that no catalogue row pins: every version at
   * the keys it was issued targets for that carries its tag. A version the
   * catalogue pins, and another lease's, are kept. Called only once the lease
   * has ended.
   *
   * @param repo - The lease's repo
   * @param leaseId - The lease
   * @param hashes - The keys it was issued targets for
   * @returns How many versions it deleted
   */
  discardWrites(repo: string, leaseId: string, hashes: readonly string[]): Promise<number>;

  /**
   * A presigned PUT target to a staging key for a whole output (#74, #210):
   * nothing is trusted until {@link commitStaged} takes it in.
   *
   * @param repo - The lease's repo
   * @param workspace - The lease's workspace (recorded on the transfer)
   * @param hash - The agent-declared output hash
   * @param size - The agent-declared output size in bytes
   */
  stagedTarget(repo: string, workspace: string, hash: string, size: bigint): Promise<{ url: string; uploadId: string }>;

  /**
   * Takes a staged output in once the store's server-side copy of it hashes
   * to the declared hash (#210): the large-output commit of an output sent
   * whole.
   *
   * @returns false when verification fails (tampered/wrong upload) — the
   *   caller must then reject the completion
   */
  commitStaged(repo: string, hash: string, uploadId: string): Promise<boolean>;

  /**
   * Write an inline (small) output through the normal object-store write —
   * the server computes the hash itself.
   *
   * @returns The server-computed content hash
   */
  writeInline(repo: string, data: Uint8Array): Promise<string>;

  /**
   * Read a published env-layer manifest (#94 Slice B) from the data
   * bucket. Deployment-global (not repo-scoped) — the route has already
   * scope-checked the env hash against the lease.
   *
   * @returns The manifest JSON, or null when unpublished
   */
  readEnvManifest(manifestKey: string): Promise<string | null>;

  /**
   * Mint a presigned GET for one published env-layer blob (#94 Slice B).
   *
   * @param blobKey - The content-addressed data-bucket key
   */
  presignEnvLayer(blobKey: string): Promise<string>;
}
