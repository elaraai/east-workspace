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
 * keeps it under that name. An object too large to hold is answered, and
 * kept, as a stream, so no read holds it whole.
 */

import { encodeBeast2For, variant } from '@elaraai/east';
import { E3_RELEASE, PackageObjectType, compareReleases, type SyncDescription } from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, TOUCH_BATCH, eachAtMost } from '../concurrency.js';
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
/** The largest object {@link originObjects} answers whole: a larger one is a stream. */
const WHOLE_BYTES = 8 * 1024 * 1024;
/** The most bytes one answer of {@link originObjects} holds whole: the rest are streams. */
const ANSWER_BYTES = 64 * 1024 * 1024;
/** The bytes a stream of {@link originObjects} reads at once. */
const STREAM_BYTES = 8 * 1024 * 1024;

/** What a replica reads its origin's objects through. */
export interface OriginObjects {
  /**
   * The objects asked for that the origin holds and this replica may read,
   * each whole or, for one too large to hold, as a stream of its bytes, which
   * the replica's store takes in with `writeStream`. One it does not hold, or
   * may not give, is left out of the answer.
   *
   * @param hashes - The objects' hashes
   * @returns Each object answered, by its hash
   */
  read(hashes: readonly string[]): Promise<ReadonlyMap<string, Uint8Array | AsyncIterable<Uint8Array>>>;
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
              const stored = bytes instanceof Uint8Array ? await this.local.write(this.repo, bytes) : await this.local.writeStream(this.repo, bytes);
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
 *
 * @example
 * ```ts
 * const origin = originObjects(storage, originRepo, description);
 * await replicaCreate(storage, replicaRepo, 'dev', description, origin);
 * await dataflowExecute(withReadThrough(storage, replicaRepo, origin), replicaRepo, 'dev');
 * ```
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

/** An object's bytes, read a range at a time as they are wanted. */
async function* streamOf(storage: StorageBackend, repo: string, hash: string, size: number): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < size; offset += STREAM_BYTES) {
    yield await storage.objects.readRange(repo, hash, offset, Math.min(STREAM_BYTES, size - offset));
  }
}

/**
 * An origin's objects, limited to what a description reaches: its roots
 * (`descriptionRoots`) and every object they name, as gc's mark finds them.
 *
 * @remarks
 * The closure is worked out at the first read, and again at the next read
 * after one that could not work it out. An object of at most 8 MiB is
 * answered whole, until an answer holds 64 MiB; every other is answered as a
 * stream, read 8 MiB at a time as the replica takes it in.
 *
 * It reads the origin's store as it stands: an object nothing of the origin
 * roots any more, such as an input's value that changed after the
 * description was made, may be swept by a gc beside running work, and is then
 * left out. The origin's run then asks over its new inputs, which a replica
 * of the old ones does not answer.
 *
 * @param storage - The origin's backend
 * @param repo - The origin's repository
 * @param description - The description a replica was made from
 * @returns The origin's objects
 *
 * @example
 * ```ts
 * const description = await syncDescribe(storage, originRepo, 'dev', selection);
 * await replicaCreate(storage, replicaRepo, 'dev', description, originObjects(storage, originRepo, description));
 * ```
 */
export function originObjects(storage: StorageBackend, repo: string, description: SyncDescription): OriginObjects {
  let closure: Promise<Set<string>> | undefined;
  const reached = (): Promise<Set<string>> => {
    if (closure === undefined) {
      const working = (async () => {
        const roots = descriptionRoots(description);
        const { readObject, readHead } = gcObjectReaders(storage, repo);
        const set = await markReachable(readObject, new Set(roots), { readHead });
        for (const root of roots) set.add(root);
        return set;
      })();
      closure = working;
      // One that could not be worked out is worked out again at the next read
      working.catch(() => {
        if (closure === working) closure = undefined;
      });
    }
    return closure;
  };
  return {
    async read(hashes) {
      const allowed = await reached();
      const wanted = [...new Set(hashes)].filter((hash) => allowed.has(hash));
      const sizes = new Map<string, number>();
      await eachAtMost(wanted, OBJECT_CONCURRENCY, async (hash) => {
        try {
          sizes.set(hash, (await storage.objects.stat(repo, hash)).size);
        } catch (err) {
          if (!(err instanceof ObjectNotFoundError)) throw err;
        }
      });
      const answered = new Map<string, Uint8Array | AsyncIterable<Uint8Array>>();
      const whole: string[] = [];
      let bytes = 0;
      for (const hash of wanted) {
        const size = sizes.get(hash);
        if (size === undefined) continue;
        if (size <= WHOLE_BYTES && bytes + size <= ANSWER_BYTES) {
          whole.push(hash);
          bytes += size;
        } else {
          answered.set(hash, streamOf(storage, repo, hash, size));
        }
      }
      await eachAtMost(whole, OBJECT_CONCURRENCY, async (hash) => {
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
 * @throws {SyncObjectError} When it names no release, a dataset its package
 *   does not declare, an execution of a task its package does not have, or
 *   one that is not a success
 * @throws {InvalidNameError} When it names something by a hash or an id of no
 *   form e3 makes them in, a version vector's entry among them
 */
function checkDescription(description: SyncDescription): void {
  let newer: boolean;
  try {
    newer = compareReleases(description.release, E3_RELEASE) > 0;
  } catch {
    throw new SyncObjectError(`the description names release '${description.release}', which is no release`);
  }
  if (newer) throw new SyncReleaseError(description.release, E3_RELEASE);
  for (const root of descriptionRoots(description)) checkHash('object hash', root);
  const declared = new Set(collectLeafPaths(description.package.data.structure).map(keypathToRefPath));
  for (const [path, ref] of description.datasets) {
    if (!declared.has(path)) throw new SyncObjectError(`the description holds a ref of '${path}', which its package does not declare`);
    // The replica's gc roots a ref's self-entry: each entry must be a hash
    if (ref.type !== 'unassigned') for (const hash of ref.value.versions.values()) checkHash('object hash', hash);
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
 * held once it has been read, and so must every object the read reached. The
 * package is the description's own, which is nobody's named package: no
 * package ref is written for it. The workspace names it by the origin's
 * package's name, at a version of its own: the origin's, then `-replica.` and
 * the first twelve characters of its hash. So nothing that carries a
 * workspace's package on, such as a bundle's export, names the cut by the
 * origin's version.
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
 * @throws {InvalidNameError} When `ws` is no workspace's name, or the
 *   description names something by no hash
 * @throws {SyncReleaseError} When a newer release wrote the description
 * @throws {WorkspaceExistsError} When the workspace exists
 * @throws {WorkspaceLockError} When something holds its name
 * @throws {SyncObjectError} When the description names no release or what
 *   its package does not have, or the origin answers other bytes for an
 *   object than were asked for, or leaves out an object the description
 *   reaches, naming them
 * @throws {GcReadError} When an object could not be read for another reason,
 *   such as the origin's failure
 *
 * @example
 * ```ts
 * const description = await syncDescribe(storage, originRepo, 'dev', selection);
 * const origin = originObjects(storage, originRepo, description);
 * const { packageHash } = await replicaCreate(storage, replicaRepo, 'dev', description, origin);
 * ```
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

      // The structure, read through to the origin. The mark takes an object
      // it cannot read for one that names nothing: each is noted, as the
      // origin left it out
      const roots = descriptionRoots(description);
      const { backend, fetches } = readThrough(storage, repo, origin);
      const { readObject, readHead } = gcObjectReaders(backend, repo);
      const lacking = new Set<string>();
      const noting = async (hash: string, length: number): Promise<Uint8Array | null> => {
        const head = await readHead(hash, length);
        if (head === null) lacking.add(hash);
        return head;
      };
      let reached: Set<string>;
      try {
        reached = await markReachable(readObject, new Set(roots), { readHead: noting });
      } catch (err) {
        // The mark names the object it could not read, not why
        throw fetches.refused ?? err;
      }
      for (let from = 0; from < roots.length; from += TOUCH_BATCH) {
        const batch = roots.slice(from, from + TOUCH_BATCH);
        const held = await storage.objects.touch(repo, batch);
        for (const [i, root] of batch.entries()) if (held[i] !== true) lacking.add(root);
      }
      if (lacking.size > 0) {
        const named = [...lacking].sort();
        throw new SyncObjectError(`the origin did not give ${named.length === 1 ? 'an object' : `${named.length} objects`} the description reaches: ${named.slice(0, 8).join(', ')}${named.length > 8 ? ', …' : ''}`);
      }
      for (const root of roots) reached.add(root);

      await writeMadeWorkspace(storage, repo, ws, {
        package: { name: description.origin.name, version: `${description.origin.version}-replica.${packageHash.slice(0, 12)}`, hash: packageHash },
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
