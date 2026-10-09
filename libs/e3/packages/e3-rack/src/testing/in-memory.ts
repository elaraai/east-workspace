/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { createHash } from 'node:crypto';
import type { StorageBackend } from '@elaraai/e3-core';
import type { RackLeaseStore } from '../lease/lease-store.js';
import type { RackObjectRead, RackPutTarget, RackStorageBridge } from '../server/storage-bridge.js';

/**
 * Models versioned rack uploads in memory over an explicit repository backend.
 * Ported from pinned e3-cloud testing; this is not an isolation boundary.
 * @example
 * const bridge = new InMemoryRackStorageBridge(storage, leases);
 */
export class InMemoryRackStorageBridge implements RackStorageBridge {
  /** Serves objects up to this size inline. */
  inlineThreshold = 4096;
  /** The store objects are read from, and committed to */
  readonly storage: StorageBackend;
  /** `${repo} ${hash}` → the versions PUTs made at the address, oldest first */
  readonly versions = new Map<string, Array<{ version: string; bytes: Uint8Array; lease: string; pinned: boolean }>>();
  /** uploadId → declared staged output (#210). */
  readonly targets = new Map<string, { repo: string; hash: string; size: bigint }>();
  /** uploadId → bytes the fake agent staged (#210). */
  readonly staged = new Map<string, Uint8Array>();
  /** manifestKey → published manifest JSON (#94 Slice B test seam). */
  readonly envManifests = new Map<string, string>();
  private seq = 0;

  /**
   * @param storage - The store objects are read from and committed to
   *   (required: tests use a real temporary repository)
   * @param leases - The leases a commit is held to (default: none, and every
   *   commit is taken as held)
   */
  constructor(storage: StorageBackend, private readonly leases?: Pick<RackLeaseStore, 'get'>) {
    this.storage = storage;
  }

  private key(repo: string, hash: string): string {
    return `${repo} ${hash}`;
  }

  /** Test hook: seed a committed object, returning its hash. */
  async seedObject(repo: string, data: Uint8Array): Promise<string> {
    return this.storage.objects.write(repo, data);
  }

  /** Test hook: simulate the agent's staged PUT of a whole output (#210). */
  stageUpload(uploadId: string, data: Uint8Array): void {
    this.staged.set(uploadId, data);
  }

  /**
   * Test hook: a presigned GET of `mem://{repo}/{hash}`, as the agent sends it.
   *
   * @returns The object's bytes, or null when the store holds none
   */
  async fetch(url: string): Promise<Uint8Array | null> {
    const [repo, hash] = url.slice('mem://'.length).split('/') as [string, string];
    try {
      return await this.storage.objects.read(decodeURIComponent(repo), hash);
    } catch {
      return null;
    }
  }

  /**
   * Test hook: a PUT through a write target, as S3 serves it: refused unless
   * its bytes hash to the address and it sends the headers signed into its
   * URL; otherwise a new version at the address.
   *
   * @returns The version the PUT made, or why it was refused
   */
  put(url: string, bytes: Uint8Array, headers: Readonly<Record<string, string>>): { version: string } | { refused: string } {
    const match = /^mem:\/\/put\/([^/]+)\/([0-9a-f]{64})\?lease=(.+)$/.exec(url);
    if (match === null) return { refused: `not a write target: ${url}` };
    const [, repo, hash, lease] = match as unknown as [string, string, string, string];
    const checksum = Buffer.from(hash, 'hex').toString('base64');
    if (headers['x-amz-checksum-sha256'] !== checksum || headers['x-amz-meta-e3-lease'] !== decodeURIComponent(lease)) {
      return { refused: 'SignatureDoesNotMatch: the PUT sent other headers than its URL signs' };
    }
    if (createHash('sha256').update(bytes).digest('base64') !== checksum) {
      return { refused: 'BadDigest: the SHA256 you specified did not match the calculated checksum' };
    }
    const version = `v${++this.seq}`;
    const key = this.key(decodeURIComponent(repo), hash);
    this.versions.set(key, [...(this.versions.get(key) ?? []), { version, bytes: new Uint8Array(bytes), lease: decodeURIComponent(lease), pinned: false }]);
    return { version };
  }

  /** Serves small objects inline and larger objects through the test transport. */
  async readDescriptor(repo: string, hash: string): Promise<RackObjectRead> {
    const data = await this.storage.objects.read(repo, hash);
    if (data.length <= this.inlineThreshold) {
      return { kind: 'inline', data };
    }
    return { kind: 'url', url: `mem://${encodeURIComponent(repo)}/${hash}` };
  }

  /** Allocates a checksum-bound versioned upload unless the object is already held. */
  async writeTarget(repo: string, leaseId: string, hash: string, _size: number): Promise<RackPutTarget | null> {
    const [held] = await this.storage.objects.touch(repo, [hash]);
    if (held === true) return null;
    return {
      url: `mem://put/${encodeURIComponent(repo)}/${hash}?lease=${encodeURIComponent(leaseId)}`,
      headers: { 'x-amz-checksum-sha256': Buffer.from(hash, 'hex').toString('base64'), 'x-amz-meta-e3-lease': leaseId },
    };
  }

  /** Verifies a version and its claimant before committing the object. */
  async commitWrite(repo: string, leaseId: string, rackId: string, hash: string, size: number, version: string): Promise<boolean> {
    const put = this.versions.get(this.key(repo, hash))?.find((candidate) => candidate.version === version);
    if (put === undefined || put.lease !== leaseId || put.bytes.length !== size) return false;
    if (createHash('sha256').update(put.bytes).digest('hex') !== hash) return false;
    if (this.leases !== undefined) {
      // Held to the lease, as the catalogue's conditional write holds it
      const lease = await this.leases.get(repo, leaseId);
      if (lease?.status !== 'claimed' || lease.claimedBy !== rackId) return false;
    }
    const [held] = await this.storage.objects.touch(repo, [hash]);
    if (held !== true && (await this.storage.objects.write(repo, put.bytes)) !== hash) return false;
    put.pinned = true;
    return true;
  }

  /** Discards uncommitted versions belonging to the lease. */
  discardWrites(repo: string, leaseId: string, hashes: readonly string[]): Promise<number> {
    let deleted = 0;
    for (const hash of hashes) {
      const key = this.key(repo, hash);
      const versions = this.versions.get(key) ?? [];
      const kept = versions.filter((candidate) => candidate.pinned || candidate.lease !== leaseId);
      deleted += versions.length - kept.length;
      this.versions.set(key, kept);
    }
    return Promise.resolve(deleted);
  }

  /** The versions at an address that nothing pinned: what a discard leaves none of. */
  unpinned(repo: string, hash: string): number {
    return (this.versions.get(this.key(repo, hash)) ?? []).filter((candidate) => !candidate.pinned).length;
  }

  /** Allocates a legacy whole-output staging target. */
  stagedTarget(repo: string, _workspace: string, hash: string, size: bigint): Promise<{ url: string; uploadId: string }> {
    const uploadId = `up-${++this.seq}`;
    this.targets.set(uploadId, { repo, hash, size });
    return Promise.resolve({ url: `mem://stage/${encodeURIComponent(repo)}/${hash}`, uploadId });
  }

  /** Verifies and commits a legacy whole-output upload. */
  async commitStaged(repo: string, hash: string, uploadId: string): Promise<boolean> {
    const target = this.targets.get(uploadId);
    const data = this.staged.get(uploadId);
    if (!target || !data || target.repo !== repo || target.hash !== hash) return false;
    if (BigInt(data.length) !== target.size) return false;
    if (createHash('sha256').update(data).digest('hex') !== hash) return false;
    await this.storage.objects.write(repo, data);
    this.targets.delete(uploadId);
    this.staged.delete(uploadId);
    return true;
  }

  /** Reads an environment manifest seeded by a test. */
  readEnvManifest(manifestKey: string): Promise<string | null> {
    return Promise.resolve(this.envManifests.get(manifestKey) ?? null);
  }

  /** Names an environment layer in the test transport. */
  presignEnvLayer(blobKey: string): Promise<string> {
    return Promise.resolve(`mem://env/${blobKey}`);
  }

  /** Stores inline bytes and returns their computed hash. */
  async writeInline(repo: string, data: Uint8Array): Promise<string> {
    return this.storage.objects.write(repo, data);
  }
}

/**
 * Recording LogStore fake for route tests: its appends, and its flushes, each
 * after the appends before it.
 */
export class RecordingLogStore {
  /** Appends received in transport order. */
  readonly entries: Array<{ repo: string; taskHash: string; inputsHash: string; executionId: string; stream: 'stdout' | 'stderr'; data: string }> = [];
  /** Each flush, with how many appends came before it: an attempt's, or every log's (none named) */
  readonly flushes: Array<{ executionId?: string; after: number }> = [];

  /** Records an ordered log append. */
  append(repo: string, taskHash: string, inputsHash: string, executionId: string, stream: 'stdout' | 'stderr', data: string): Promise<void> {
    this.entries.push({ repo, taskHash, inputsHash, executionId, stream, data });
    return Promise.resolve();
  }

  /** An attempt's flush (east-workspace#1051), or, named none, every log's. */
  flush(_repo?: string, _taskHash?: string, _inputsHash?: string, executionId?: string): Promise<void> {
    this.flushes.push({ ...(executionId !== undefined && { executionId }), after: this.entries.length });
    return Promise.resolve();
  }
}
