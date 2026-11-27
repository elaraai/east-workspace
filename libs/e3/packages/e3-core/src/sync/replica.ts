/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A replica of a selection: a workspace made in another repository from a
 * description, whose objects are read from its origin as they are wanted.
 *
 * A replica is made with its structure alone: the objects that name others,
 * read from the description's roots as gc's mark reads them, header first. A
 * collection's segments, and a task's program, name nothing, so they are not
 * read then. Every read of the replica's object store after that falls back
 * to the origin for an object the store lacks ({@link withReadThrough}), so a
 * task's run fetches what it reads, as it stages it, and nothing a task of
 * the selection does not read is ever fetched.
 *
 * Every object is checked against the hash it was asked for before the store
 * keeps it under that name.
 */

import { encodeBeast2For, variant } from '@elaraai/east';
import { E3_RELEASE, PackageObjectType, compareReleases, type SyncDescription } from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, eachAtMost } from '../concurrency.js';
import { collectLeafPaths, keypathToRefPath } from '../dataset-refs.js';
import {
  ObjectNotFoundError, SyncObjectError, SyncReleaseError, WorkspaceExistsError, WorkspaceLockError,
  checkHash, checkId, checkName, lockStateToHolderInfo,
} from '../errors.js';
import { gcObjectReaders, markReachable } from '../gc-graph.js';
import { withRunningWork } from '../running-work.js';
import type { ObjectStore, StorageBackend } from '../storage/interfaces.js';
import { writeMadeWorkspace } from '../workspace-bundle.js';
import { descriptionRoots } from './describe.js';

/** The most objects one request asks the origin for. */
const READ_BATCH = 256;

/** What a replica reads its origin's objects through. */
export interface OriginObjects {
  /**
   * The objects asked for that the origin holds and this replica may read.
   * One it does not hold, or may not give, is left out of the answer.
   *
   * @param hashes - The objects' hashes
   * @returns Each object answered, by its hash
   */
  read(hashes: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>>;
}

/** One object asked for and not yet answered. */
interface Wanted {
  readonly held: Promise<boolean>;
  resolve(held: boolean): void;
  reject(error: unknown): void;
}

/**
 * The objects a replica has asked its origin for: each asked once while it is
 * wanted, and those wanted while a request is out asked together in the next.
 */
class OriginFetches {
  private readonly queued = new Map<string, Wanted>();
  private readonly asked = new Map<string, Wanted>();
  private requesting = false;
  /** The first object the origin answered other bytes for: a reader that
   *  wraps a read's failure in its own loses it, and is told it from here */
  refused: SyncObjectError | undefined;

  constructor(
    private readonly local: ObjectStore,
    private readonly repo: string,
    private readonly origin: OriginObjects,
  ) {}

  /**
   * Asks the origin for an object the store lacks, and stores it.
   *
   * @param hash - The object's hash
   * @returns Whether the store now holds it: false when the origin left it out
   * @throws {SyncObjectError} When the origin answered other bytes for it
   */
  fetch(hash: string): Promise<boolean> {
    const known = this.asked.get(hash) ?? this.queued.get(hash);
    if (known !== undefined) return known.held;
    let resolve!: (held: boolean) => void;
    let reject!: (error: unknown) => void;
    const held = new Promise<boolean>((res, rej) => { resolve = res; reject = rej; });
    this.queued.set(hash, { held, resolve, reject });
    if (!this.requesting) void this.request();
    return held;
  }

  /** Asks for what is queued, a batch at a time, until nothing is. */
  private async request(): Promise<void> {
    this.requesting = true;
    try {
      while (this.queued.size > 0) {
        const batch = [...this.queued].slice(0, READ_BATCH);
        for (const [hash, wanted] of batch) {
          this.queued.delete(hash);
          this.asked.set(hash, wanted);
        }
        try {
          const answered = await this.origin.read(batch.map(([hash]) => hash));
          await eachAtMost(batch, OBJECT_CONCURRENCY, async ([hash, wanted]) => {
            const bytes = answered.get(hash);
            if (bytes === undefined) {
              wanted.resolve(false);
              return;
            }
            try {
              // The store names what it keeps by its own hash of the bytes:
              // bytes that are another object are never kept under this name
              const stored = await this.local.write(this.repo, bytes);
              if (stored === hash) {
                wanted.resolve(true);
                return;
              }
              const refusal = new SyncObjectError(`the origin answered object ${stored} for object ${hash}`);
              this.refused ??= refusal;
              wanted.reject(refusal);
            } catch (err) {
              wanted.reject(err);
            }
          });
        } catch (err) {
          for (const [, wanted] of batch) wanted.reject(err);
        } finally {
          for (const [hash] of batch) this.asked.delete(hash);
        }
      }
    } finally {
      this.requesting = false;
    }
  }
}

/** The object store's reads that fall back to the origin: those of one object. */
const READS = new Set<PropertyKey>(['read', 'readRange', 'stat', 'materialize']);

/**
 * A backend whose object reads fall back to the origin.
 *
 * @remarks
 * `read`, `readRange`, `stat` and `materialize` of an object of `repo` try the
 * store first. An object it lacks is asked of the origin, stored, and the
 * read is made again; one the origin leaves out is the store's
 * `ObjectNotFoundError`. Every other method, and every other repository,
 * answers for the store alone: `exists` and `touch` say what the replica
 * holds, not what it could fetch.
 *
 * @param storage - The replica's backend
 * @param repo - The replica's repository
 * @param origin - Its origin's objects
 * @returns The backend
 */
export function withReadThrough(storage: StorageBackend, repo: string, origin: OriginObjects): StorageBackend {
  return readThrough(storage, repo, origin).backend;
}

/** A read-through backend ({@link withReadThrough}), and what it fetched. */
function readThrough(storage: StorageBackend, repo: string, origin: OriginObjects): { backend: StorageBackend; fetches: OriginFetches } {
  const local = storage.objects;
  const fetches = new OriginFetches(local, repo, origin);
  const through = async (hash: string, attempt: () => Promise<unknown>): Promise<unknown> => {
    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof ObjectNotFoundError) || !(await fetches.fetch(hash))) throw err;
      return await attempt();
    }
  };
  const objects = new Proxy(local, {
    get(target, key) {
      const member: unknown = Reflect.get(target, key, target);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]): unknown => {
        const call = () => Reflect.apply(member, target, args) as Promise<unknown>;
        return READS.has(key) && args[0] === repo && typeof args[1] === 'string' ? through(args[1], call) : call();
      };
    },
  });
  const backend = new Proxy(storage, { get: (target, key) => (key === 'objects' ? objects : Reflect.get(target, key, target) as unknown) });
  return { backend, fetches };
}

/**
 * An origin's objects, limited to what a description reaches: its roots
 * (`descriptionRoots`) and every object they name, as gc's mark finds them.
 * The closure is worked out once, at the first read.
 *
 * @param storage - The origin's backend
 * @param repo - The origin's repository
 * @param description - The description a replica was made from
 * @returns The origin's objects
 */
export function originObjects(storage: StorageBackend, repo: string, description: SyncDescription): OriginObjects {
  let closure: Promise<Set<string>> | undefined;
  const reached = (): Promise<Set<string>> => {
    closure ??= (async () => {
      const roots = descriptionRoots(description);
      const { readObject, readHead } = gcObjectReaders(storage, repo);
      const set = await markReachable(readObject, new Set(roots), { readHead });
      for (const root of roots) set.add(root);
      return set;
    })();
    return closure;
  };
  return {
    async read(hashes) {
      const allowed = await reached();
      const answered = new Map<string, Uint8Array>();
      await eachAtMost([...new Set(hashes)].filter((hash) => allowed.has(hash)), OBJECT_CONCURRENCY, async (hash) => {
        try {
          answered.set(hash, await storage.objects.read(repo, hash));
        } catch (err) {
          if (!(err instanceof ObjectNotFoundError)) throw err;
        }
      });
      return answered;
    },
  };
}

/**
 * Refuses a description a replica cannot be made from: one a newer release
 * wrote, or one that names what its own package does not have.
 *
 * @throws {SyncReleaseError} When a newer release wrote it
 * @throws {SyncObjectError} When it names a dataset its package does not
 *   declare, an execution of a task its package does not have, or one that is
 *   not a success
 * @throws {InvalidNameError} When it names something by a hash or an id of no
 *   form e3 makes them in
 */
function checkDescription(description: SyncDescription): void {
  if (compareReleases(description.release, E3_RELEASE) > 0) throw new SyncReleaseError(description.release, E3_RELEASE);
  for (const root of descriptionRoots(description)) checkHash('object hash', root);
  const declared = new Set(collectLeafPaths(description.package.data.structure).map(keypathToRefPath));
  for (const path of description.datasets.keys()) {
    if (!declared.has(path)) throw new SyncObjectError(`the description holds a ref of '${path}', which its package does not declare`);
  }
  const tasks = new Set(description.package.tasks.values());
  for (const { taskHash, inputsHash, status } of description.executions) {
    checkHash('task hash', taskHash);
    checkHash('inputs hash', inputsHash);
    checkId('execution id', status.value.executionId);
    if (!tasks.has(taskHash)) throw new SyncObjectError(`the description holds an execution of task ${taskHash}, which its package does not have`);
    if (status.type !== 'success') throw new SyncObjectError(`the description holds execution ${status.value.executionId}, which is ${status.type}: only a success travels`);
  }
}

/**
 * Makes a workspace of a replica from a description: the replica's package,
 * its structure fetched from the origin, then its executions, its refs and
 * its record, as a bundle's import writes them.
 *
 * @remarks
 * The structure is every object the description's roots reach that names
 * others, read as gc's mark reads them, header first, through the
 * read-through backend: so nothing that names nothing is fetched, a
 * collection's segments and a task's program among them. The roots must be
 * held once it has been read. The package is the description's own, which is
 * nobody's named package: no package ref is written for it. The workspace
 * names the origin's package's name and version.
 *
 * A description an older release wrote is taken, as a rack takes work a
 * project of an older release made; one a newer release wrote is refused.
 *
 * @param storage - The replica's backend
 * @param repo - The replica's repository
 * @param ws - The workspace to make
 * @param description - The description
 * @param origin - The origin's objects
 * @returns The replica's package's hash, and every object its structure
 *   reached
 * @throws {InvalidNameError} When `ws` is no workspace's name
 * @throws {SyncReleaseError} When a newer release wrote the description
 * @throws {WorkspaceExistsError} When the workspace exists
 * @throws {WorkspaceLockError} When something holds its name
 * @throws {SyncObjectError} When the origin answers other bytes for an object
 *   than were asked for, or leaves out a root of the description
 */
export async function replicaCreate(
  storage: StorageBackend,
  repo: string,
  ws: string,
  description: SyncDescription,
  origin: OriginObjects,
): Promise<{ packageHash: string; reached: ReadonlySet<string> }> {
  checkName('workspace', ws);
  checkDescription(description);
  return withRunningWork(storage, repo, async () => {
    const lock = await storage.locks.acquire(repo, ws, variant('deployment', null));
    if (lock === null) {
      const state = await storage.locks.getState(repo, ws);
      throw new WorkspaceLockError(ws, state ? lockStateToHolderInfo(state) : undefined);
    }
    try {
      if (await storage.refs.workspaceRead(repo, ws) !== null) throw new WorkspaceExistsError(ws);
      const packageHash = await storage.objects.write(repo, encodeBeast2For(PackageObjectType)(description.package));

      // The structure, read through to the origin
      const roots = descriptionRoots(description);
      const { backend, fetches } = readThrough(storage, repo, origin);
      const { readObject, readHead } = gcObjectReaders(backend, repo);
      let reached: Set<string>;
      try {
        reached = await markReachable(readObject, new Set(roots), { readHead });
      } catch (err) {
        // The mark names the object it could not read, not why
        throw fetches.refused ?? err;
      }
      const held = await storage.objects.touch(repo, roots);
      const missing = roots.filter((_, i) => held[i] !== true);
      if (missing.length > 0) throw new SyncObjectError(`the origin did not give ${missing.length === 1 ? 'a root' : `${missing.length} roots`} of the description: ${missing.join(', ')}`);
      for (const root of roots) reached.add(root);

      await writeMadeWorkspace(storage, repo, ws, {
        package: { name: description.origin.name, version: description.origin.version, hash: packageHash },
        deployedAt: description.deployedAt,
        datasets: description.datasets,
        executions: description.executions,
      }, { packageRef: false });
      return { packageHash, reached };
    } finally {
      await lock.release();
    }
  });
}
