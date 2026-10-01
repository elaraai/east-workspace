/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The adapters' contract: what every implementation of the four adapters
 * does, whether it keeps what it holds in memory, in IndexedDB, in OPFS, with
 * Web Locks or on the machine.
 *
 * A case is a plain function over a setup, asserting with `./assert.js`, so
 * it runs where its adapters are: in Node, registered as a `node:test` test
 * over the in-memory adapters and the machine's files, and in a page over
 * IndexedDB, OPFS and Web Locks, where the page runs it by name and the
 * Node-side spec reports it as a test of its own.
 *
 * @packageDocumentation
 */

import {
  compareKeys,
  type BlobsAdapter,
  type FilesAdapter,
  type LocksAdapter,
  type RecordKey,
  type RecordScan,
  type RecordsAdapter,
  type RecordsTransaction,
} from '../storage/adapters.js';
import { deepEqual, equal, ok, rejects, render, throws } from './assert.js';

// =============================================================================
// Running a case
// =============================================================================

/**
 * A case of the contract: what it holds an adapter to, and how.
 */
export interface AdapterCase<S> {
  /** What the case holds the adapter to, which names its test */
  readonly name: string;
  /** Runs the case over a fresh setup */
  readonly run: (setup: S) => Promise<void>;
}

/** Undoes part of a setup once its case has run. */
export type Cleanup = () => Promise<void> | void;

/**
 * Makes a fresh setup for one case, registering what undoes it.
 *
 * @param cleanup - Registers what runs once the case has, last registered
 *   first, whether or not it passed
 */
export type AdapterSetup<S> = (cleanup: (undo: Cleanup) => void) => Promise<S>;

/**
 * Runs a case over a fresh setup, and undoes the setup after.
 *
 * @param adapterCase - The case
 * @param setup - Makes its setup
 * @throws What the case throws; or, when it passed, what undoing its setup
 *   threw
 */
export async function runAdapterCase<S>(adapterCase: AdapterCase<S>, setup: AdapterSetup<S>): Promise<void> {
  const cleanups: Cleanup[] = [];
  let failure: { error: unknown } | null = null;
  try {
    await adapterCase.run(await setup((undo) => cleanups.push(undo)));
  } catch (error) {
    failure = { error };
  }
  for (const undo of cleanups.reverse()) {
    try {
      await undo();
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure !== null) throw failure.error;
}

/**
 * Finds a case of a contract by its name.
 *
 * @param contract - The contract
 * @param name - The case's name
 * @returns The case
 * @throws {Error} When the contract has no case of that name
 */
export function caseNamed<S>(contract: readonly AdapterCase<S>[], name: string): AdapterCase<S> {
  const found = contract.find((each) => each.name === name);
  if (found === undefined) throw new Error(`the contract has no case '${name}'`);
  return found;
}

// =============================================================================
// Setups
// =============================================================================

/**
 * What a records case runs over: one store, which it opens adapters over.
 */
export interface RecordsSetup {
  /** Opens an adapter over the setup's store: each another connection to
   *  it, as another tab's */
  open(): Promise<RecordsAdapter>;
}

/**
 * What a blobs case runs over: an adapter over blobs of its own.
 */
export interface BlobsSetup {
  /** The adapter, over no blobs yet */
  readonly blobs: BlobsAdapter;
}

/**
 * What a locks case runs over: one origin's locks, which it opens sessions
 * over.
 */
export interface LocksSetup {
  /** Opens a session over the setup's locks: each another, as another tab's */
  open(): Promise<LocksAdapter>;
}

/**
 * What a files case runs over: an adapter, and an empty directory of its own.
 */
export interface FilesSetup {
  /** The adapter */
  readonly files: FilesAdapter;
  /** A directory that is there, empty, for the case's files */
  readonly dir: string;
  /** The path of a name in a directory, as the adapter's paths join */
  join(dir: string, name: string): string;
}

// =============================================================================
// Helpers
// =============================================================================

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The UTF-8 bytes of a text. */
function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/** The text UTF-8 bytes hold. */
function text(data: Uint8Array): string {
  return decoder.decode(data);
}

/** A source that yields the texts' bytes, a chunk each. */
async function* chunks(...texts: string[]): AsyncIterable<Uint8Array> {
  for (const each of texts) yield bytes(each);
}

/** A source that yields the texts' bytes, and then fails. */
async function* failing(...texts: string[]): AsyncIterable<Uint8Array> {
  for (const each of texts) yield bytes(each);
  throw new Error('the source failed');
}

/**
 * A source that yields its first chunk, and the rest only once it is let
 * through: a write in flight for as long as a case needs one.
 */
function gated(first: string, ...rest: string[]): { source: AsyncIterable<Uint8Array>; waiting: Promise<void>; open(): void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  async function* source(): AsyncIterable<Uint8Array> {
    yield bytes(first);
    reached();
    await opened;
    for (const each of rest) yield bytes(each);
  }
  return { source: source(), waiting, open };
}

/** Writes records whose values are their keys' parts, joined by `/`. */
async function putAll(records: RecordsAdapter, keys: readonly RecordKey[]): Promise<void> {
  await records.transact(async (tx) => {
    for (const key of keys) tx.put(key, bytes(key.join('/')));
  });
}

/** Reads a file whole, and how many chunks it came in. */
async function readAll(files: FilesAdapter, path: string): Promise<{ data: Uint8Array; chunks: number }> {
  const parts: Uint8Array[] = [];
  for await (const chunk of files.read(path)) parts.push(chunk);
  const data = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return { data, chunks: parts.length };
}

// =============================================================================
// Records
// =============================================================================

/**
 * The records adapter's contract.
 */
export const recordsContract: readonly AdapterCase<RecordsSetup>[] = [
  {
    name: 'reads a record a transaction put, and nothing of a key never written',
    run: async ({ open }) => {
      const records = await open();
      equal(await records.get(['a']), null);
      deepEqual(await records.scan([]), []);
      const answer = await records.transact(async (tx) => {
        tx.put(['a'], bytes('one'));
        return 'done';
      });
      equal(answer, 'done', 'the transaction answers what its work does');
      deepEqual(await records.get(['a']), bytes('one'));
      deepEqual(await records.scan([]), [{ key: ['a'], value: bytes('one') }]);
    },
  },
  {
    name: 'orders keys part by part, by UTF-16 code unit, and a key before the keys it is a prefix of',
    run: async ({ open }) => {
      const records = await open();
      const ordered: RecordKey[] = [
        ['A'], ['a'], ['a', ''], ['a', '\u0000'], ['a', 'Z'], ['a', 'b'], ['a', 'b', 'c'], ['ab'], ['b'], ['é'], ['😀'], ['￿'],
      ];
      const written = [5, 0, 11, 3, 8, 1, 10, 2, 7, 4, 9, 6].map((i) => ordered[i]!);
      await putAll(records, written);
      deepEqual(await records.keys([]), ordered);
      deepEqual((await records.scan([])).map(({ key }) => key), ordered);
      deepEqual([...written].sort(compareKeys), ordered, 'compareKeys orders keys as the store does');
    },
  },
  {
    name: 'scans the records under a prefix, the prefix\'s own among them, and no others',
    run: async ({ open }) => {
      const records = await open();
      await putAll(records, [['x'], ['x', '1'], ['x', '2', 'deep'], ['xy'], ['w'], ['x2']]);
      deepEqual(await records.keys(['x']), [['x'], ['x', '1'], ['x', '2', 'deep']]);
      deepEqual(await records.scan(['x', '2']), [{ key: ['x', '2', 'deep'], value: bytes('x/2/deep') }]);
      deepEqual(await records.keys(['none']), []);
      deepEqual(await records.keys(['x', '1', 'below']), []);
    },
  },
  {
    name: 'pages a scan by the keys it starts after and ends before, a number at a time, from either end',
    run: async ({ open }) => {
      const records = await open();
      const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      await putAll(records, [['o'], ...digits.map((digit) => ['p', digit]), ['q']]);
      const page = async (options: RecordScan): Promise<string[]> => (await records.keys(['p'], options)).map((key) => key[1]!);
      deepEqual(await page({ limit: 3 }), ['0', '1', '2']);
      deepEqual(await page({ after: ['p', '2'], limit: 3 }), ['3', '4', '5']);
      deepEqual(await page({ after: ['p', '2', 'z'], limit: 1 }), ['3'], 'after a key that sorts between two');
      deepEqual(await page({ before: ['p', '3'] }), ['0', '1', '2']);
      deepEqual(await page({ after: ['p', '2'], before: ['p', '5'] }), ['3', '4']);
      deepEqual(await page({ reverse: true, limit: 2 }), ['9', '8']);
      deepEqual(await page({ reverse: true, before: ['p', '8'], limit: 2 }), ['7', '6']);
      deepEqual(await page({ reverse: true, after: ['p', '7'] }), ['9', '8']);
      deepEqual(await page({ after: ['p', '9'] }), []);
      deepEqual(await page({ after: ['p', '5'], before: ['p', '5'] }), []);
      deepEqual(await page({ after: ['p', '6'], before: ['p', '3'] }), [], 'a range that ends before it starts');
      deepEqual(await page({ after: ['o'] }), digits, 'a bound outside the prefix bounds nothing');
      deepEqual(await page({ before: ['q'] }), digits);
      deepEqual(
        (await records.scan(['p'], { reverse: true, limit: 1 })).map(({ key, value }) => [key, text(value)]),
        [[['p', '9'], 'p/9']],
      );
      for (const limit of [0, -1, 1.5]) {
        await rejects(() => records.keys(['p'], { limit }), { name: 'RangeError' }, `a limit of ${limit}`);
      }
    },
  },
  {
    name: 'applies none of a transaction whose work throws, and fails with what it threw',
    run: async ({ open }) => {
      const records = await open();
      await putAll(records, [['k'], ['k', 'child']]);
      await rejects(() => records.transact(async (tx) => {
        tx.put(['k'], bytes('changed'));
        tx.put(['new'], bytes('new'));
        tx.deletePrefix(['k']);
        tx.put(['k', 'child', 'grandchild'], bytes('added'));
        deepEqual(await tx.keys([]), [['k', 'child', 'grandchild'], ['new']], 'the transaction sees its own writes');
        throw new Error('abandoned');
      }), { message: /^abandoned$/ });
      deepEqual(await records.scan([]), [{ key: ['k'], value: bytes('k') }, { key: ['k', 'child'], value: bytes('k/child') }]);
    },
  },
  {
    name: 'shows a transaction its own writes, and applies them together',
    run: async ({ open }) => {
      const records = await open();
      const answer = await records.transact(async (tx) => {
        tx.put(['t', '1'], bytes('one'));
        deepEqual(await tx.get(['t', '1']), bytes('one'));
        tx.delete(['t', '1']);
        equal(await tx.get(['t', '1']), null);
        tx.put(['t', '2'], bytes('two'));
        tx.put(['t', '3'], bytes('three'));
        tx.put(['u'], bytes('u'));
        tx.deletePrefix(['t']);
        deepEqual(await tx.keys(['t']), []);
        tx.put(['t', '4'], bytes('four'));
        deepEqual(await tx.scan(['t']), [{ key: ['t', '4'], value: bytes('four') }]);
        deepEqual(await tx.keys([], { reverse: true }), [['u'], ['t', '4']]);
        return 42;
      });
      equal(answer, 42);
      deepEqual(await records.keys([]), [['t', '4'], ['u']]);
    },
  },
  {
    name: 'deletes a record, and every record under a prefix, and nothing else',
    run: async ({ open }) => {
      const records = await open();
      await putAll(records, [['c'], ['d'], ['d', '1'], ['d', '1', 'x'], ['dd']]);
      await records.transact(async (tx) => {
        tx.delete(['c']);
        tx.delete(['never', 'written']);
        tx.deletePrefix(['d']);
        tx.deletePrefix(['none']);
      });
      deepEqual(await records.keys([]), [['dd']]);
    },
  },
  {
    name: 'runs transactions one after another, so none loses another\'s write, through one adapter or two',
    run: async ({ open }) => {
      const [first, second] = [await open(), await open()];
      const increment = (records: RecordsAdapter): Promise<void> => records.transact(async (tx) => {
        const current = await tx.get(['n']);
        tx.put(['n'], bytes(`${current === null ? 1 : Number(text(current)) + 1}`));
      });
      await Promise.all(Array.from({ length: 24 }, (_, i) => increment(i % 2 === 0 ? first : second)));
      deepEqual(await first.get(['n']), bytes('24'));
    },
  },
  {
    name: 'keeps its own copy of what it is given and what it gives, and only the bytes of a view',
    run: async ({ open }) => {
      const records = await open();
      const given = new Uint8Array([1, 2, 3]);
      await records.transact(async (tx) => {
        tx.put(['given'], given);
      });
      given[0] = 9;
      const read = (await records.get(['given']))!;
      deepEqual(read, new Uint8Array([1, 2, 3]), 'changing what was put changes nothing stored');
      read[1] = 9;
      deepEqual(await records.get(['given']), new Uint8Array([1, 2, 3]), 'changing what was read changes nothing stored');
      await records.transact(async (tx) => {
        tx.put(['view'], new Uint8Array([0, 1, 2, 3, 4]).subarray(1, 3));
      });
      const view = (await records.get(['view']))!;
      deepEqual(view, new Uint8Array([1, 2]));
      equal(view.buffer.byteLength, 2, 'a view is kept as its bytes, not the whole buffer it is into');
    },
  },
  {
    name: 'refuses work that awaits anything but its own operations, and a transaction used after its work',
    run: async ({ open }) => {
      const records = await open();
      await rejects(() => records.transact(async (tx) => {
        await tx.get(['early']);
        await new Promise((resolve) => setTimeout(resolve, 20));
        tx.put(['late'], bytes('late'));
      }), { name: 'RecordsTransactionError' }, 'an operation after a timer');
      equal(await records.get(['late']), null, 'a write after the timer never applies');
      await rejects(() => records.transact(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }), { name: 'RecordsTransactionError' }, 'work that finishes after a timer');
      let kept: RecordsTransaction | undefined;
      await records.transact(async (tx) => {
        kept = tx;
      });
      throws(() => kept!.put(['after'], bytes('after')), { name: 'RecordsTransactionError' }, 'a write after the work');
      await rejects(() => kept!.get(['after']), { name: 'RecordsTransactionError' }, 'a read after the work');
      equal(await records.get(['after']), null);
      await records.transact(async (tx) => {
        tx.put(['after'], bytes('fine'));
      });
      deepEqual(await records.get(['after']), bytes('fine'), 'the adapter takes transactions still');
    },
  },
  {
    name: 'reads through another adapter over the same store what one wrote, and refuses a closed adapter',
    run: async ({ open }) => {
      const [first, second] = [await open(), await open()];
      await first.transact(async (tx) => {
        tx.put(['shared'], bytes('written by the first'));
      });
      deepEqual(await second.get(['shared']), bytes('written by the first'));
      await first.close();
      deepEqual(await second.get(['shared']), bytes('written by the first'), 'the records outlive the adapter that wrote them');
      await rejects(() => first.get(['shared']), { name: 'AdapterClosedError' });
      await rejects(() => first.keys([]), { name: 'AdapterClosedError' });
      await rejects(() => first.transact(async () => undefined), { name: 'AdapterClosedError' });
      deepEqual(await (await open()).keys([]), [['shared']], 'an adapter opened after reads them');
    },
  },
  {
    name: 'refuses a key that is not a list of strings',
    run: async ({ open }) => {
      const records = await open();
      const bad = ['a', 1] as unknown as RecordKey;
      await rejects(() => records.get(bad), { name: 'TypeError' });
      await rejects(() => records.scan(bad), { name: 'TypeError' });
      await rejects(() => records.keys(['a'], { after: bad }), { name: 'TypeError' });
      await rejects(() => records.get('a' as unknown as RecordKey), { name: 'TypeError' });
      await rejects(() => records.transact(async (tx) => {
        tx.put(bad, bytes('x'));
      }), { name: 'TypeError' });
      deepEqual(await records.keys([]), [], 'nothing was written');
    },
  },
];

// =============================================================================
// Blobs
// =============================================================================

/**
 * The blobs adapter's contract.
 */
export const blobsContract: readonly AdapterCase<BlobsSetup>[] = [
  {
    name: 'answers nothing for a blob never written',
    run: async ({ blobs }) => {
      equal(await blobs.read(['none']), null);
      equal(await blobs.readRange(['none'], 0, 1), null);
      equal(await blobs.stat(['none']), null);
      equal(await blobs.delete(['none']), false);
      equal(await blobs.read(['none', 'deeper']), null, 'nor under a key part no blob is under');
      deepEqual(await blobs.list([]), []);
    },
  },
  {
    name: 'keeps a blob whole, with its size and when it was written',
    run: async ({ blobs }) => {
      const before = Date.now();
      equal(await blobs.write(['a', 'b'], bytes('hello')), 5);
      const after = Date.now();
      deepEqual(await blobs.read(['a', 'b']), bytes('hello'));
      const stat = await blobs.stat(['a', 'b']);
      equal(stat?.size, 5);
      ok(stat !== null && stat.lastModified >= before - 2000 && stat.lastModified <= after + 2000,
        `written at ${stat?.lastModified}, between ${before} and ${after}`);
    },
  },
  {
    name: 'writes a stream of chunks as one blob, and nothing as a blob of no bytes',
    run: async ({ blobs }) => {
      equal(await blobs.write(['s'], chunks('one, ', 'two, ', 'three')), 15);
      deepEqual(await blobs.read(['s']), bytes('one, two, three'));
      equal(await blobs.write(['empty'], new Uint8Array(0)), 0);
      deepEqual(await blobs.read(['empty']), new Uint8Array(0));
      equal((await blobs.stat(['empty']))?.size, 0);
      equal(await blobs.write(['streamed-empty'], chunks()), 0);
      deepEqual(await blobs.read(['streamed-empty']), new Uint8Array(0));
    },
  },
  {
    name: 'reads a range of a blob, short only at its end',
    run: async ({ blobs }) => {
      await blobs.write(['r'], bytes('0123456789'));
      deepEqual(await blobs.readRange(['r'], 2, 3), bytes('234'));
      deepEqual(await blobs.readRange(['r'], 7, 10), bytes('789'));
      deepEqual(await blobs.readRange(['r'], 10, 5), new Uint8Array(0));
      deepEqual(await blobs.readRange(['r'], 12, 5), new Uint8Array(0));
      deepEqual(await blobs.readRange(['r'], 3, 0), new Uint8Array(0));
      for (const [offset, length] of [[-1, 1], [0, -1], [1.5, 1], [0, 0.5]] as const) {
        await rejects(() => blobs.readRange(['r'], offset, length), { name: 'RangeError' }, `a range of ${offset}, ${length}`);
      }
    },
  },
  {
    name: 'replaces a blob whole',
    run: async ({ blobs }) => {
      await blobs.write(['w'], bytes('a long first blob'));
      equal(await blobs.write(['w'], bytes('short')), 5);
      deepEqual(await blobs.read(['w']), bytes('short'));
      equal((await blobs.stat(['w']))?.size, 5);
      deepEqual((await blobs.list([])).map(({ key }) => key), [['w']]);
    },
  },
  {
    name: 'deletes a blob, and says whether there was one',
    run: async ({ blobs }) => {
      await blobs.write(['gone'], bytes('x'));
      await blobs.write(['kept'], bytes('y'));
      equal(await blobs.delete(['gone']), true);
      equal(await blobs.read(['gone']), null);
      equal(await blobs.stat(['gone']), null);
      equal(await blobs.delete(['gone']), false);
      deepEqual(await blobs.read(['kept']), bytes('y'));
    },
  },
  {
    name: 'lists the blobs under a prefix in key order, the prefix\'s own among them, with their sizes',
    run: async ({ blobs }) => {
      for (const key of [['r', 'b'], ['r', 'a'], ['r', 'a', 'x'], ['r2'], ['r'], ['q']]) await blobs.write(key, bytes(key.join('/')));
      const listed = async (prefix: readonly string[]): Promise<Array<[readonly string[], number]>> =>
        (await blobs.list(prefix)).map(({ key, size }) => [key, size]);
      deepEqual(await listed(['r']), [[['r'], 1], [['r', 'a'], 3], [['r', 'a', 'x'], 5], [['r', 'b'], 3]]);
      deepEqual(await listed(['r', 'a']), [[['r', 'a'], 3], [['r', 'a', 'x'], 5]]);
      deepEqual(await listed([]), [[['q'], 1], [['r'], 1], [['r', 'a'], 3], [['r', 'a', 'x'], 5], [['r', 'b'], 3], [['r2'], 2]]);
      deepEqual(await listed(['zz']), []);
      deepEqual(await listed(['r', 'b', 'below']), []);
      for (const { lastModified } of await blobs.list([])) ok(Number.isFinite(lastModified), 'each lists when it was written');
    },
  },
  {
    name: 'keeps keys apart that differ only in case, and holds any character in a key',
    run: async ({ blobs }) => {
      const keys: string[][] = [
        ['Case'], ['case'], ['CASE'], ['a b'], ['%41'], ['A'], ['.'], ['..'], ['.hidden'], ['a/b'], ['a\\b'],
        ['é'], ['日本'], ['~'], ['x~'], ['emoji 😀'], ['nul\u0000'], ['dir', 'Nested/Part'],
      ];
      for (const [i, key] of keys.entries()) await blobs.write(key, bytes(`${i}`));
      for (const [i, key] of keys.entries()) deepEqual(await blobs.read(key), bytes(`${i}`), render(key));
      deepEqual((await blobs.list([])).map(({ key }) => key), [...keys].sort(compareKeys));
    },
  },
  {
    name: 'refuses a key with no parts, or an empty part',
    run: async ({ blobs }) => {
      await rejects(() => blobs.write([], bytes('x')), { name: 'TypeError' });
      await rejects(() => blobs.write(['a', ''], bytes('x')), { name: 'TypeError' });
      await rejects(() => blobs.read(['']), { name: 'TypeError' });
      await rejects(() => blobs.stat([]), { name: 'TypeError' });
      await rejects(() => blobs.list(['a', '']), { name: 'TypeError' });
      deepEqual(await blobs.list([]), [], 'nothing was written');
    },
  },
  {
    name: 'deletes every blob under a prefix, and no other',
    run: async ({ blobs }) => {
      for (const key of [['d'], ['d', '1'], ['d', '1', 'x'], ['dd'], ['c', 'd']]) await blobs.write(key, bytes('x'));
      await blobs.deletePrefix(['d']);
      deepEqual((await blobs.list([])).map(({ key }) => key), [['c', 'd'], ['dd']]);
      await blobs.deletePrefix(['none']);
      deepEqual((await blobs.list([])).map(({ key }) => key), [['c', 'd'], ['dd']]);
      await blobs.deletePrefix([]);
      deepEqual(await blobs.list([]), []);
    },
  },
  {
    name: 'leaves a blob as it was when a write of it fails, and no blob of a key it never finished',
    run: async ({ blobs }) => {
      await blobs.write(['f'], bytes('kept'));
      await rejects(() => blobs.write(['f'], failing('partial')), { message: /the source failed/ });
      deepEqual(await blobs.read(['f']), bytes('kept'));
      await rejects(() => blobs.write(['g'], failing('partial')), { message: /the source failed/ });
      equal(await blobs.read(['g']), null);
      deepEqual((await blobs.list([])).map(({ key }) => key), [['f']]);
    },
  },
  {
    name: 'shows no blob before its write has finished',
    run: async ({ blobs }) => {
      await blobs.write(['replaced'], bytes('before'));
      const fresh = gated('in ', 'flight');
      const replacing = gated('af', 'ter');
      const writing = [blobs.write(['fresh'], fresh.source), blobs.write(['replaced'], replacing.source)];
      await Promise.all([fresh.waiting, replacing.waiting]);
      equal(await blobs.read(['fresh']), null, 'a new blob is not there while its write is in flight');
      equal(await blobs.stat(['fresh']), null);
      deepEqual(await blobs.read(['replaced']), bytes('before'), 'a replaced blob is the old one while its write is in flight');
      deepEqual((await blobs.list([])).map(({ key }) => key), [['replaced']]);
      fresh.open();
      replacing.open();
      await Promise.all(writing);
      deepEqual(await blobs.read(['fresh']), bytes('in flight'));
      deepEqual(await blobs.read(['replaced']), bytes('after'));
    },
  },
  {
    name: 'keeps its own copy of what it is given and what it gives',
    run: async ({ blobs }) => {
      const given = new Uint8Array([1, 2, 3]);
      await blobs.write(['given'], given);
      given[0] = 9;
      const read = (await blobs.read(['given']))!;
      deepEqual(read, new Uint8Array([1, 2, 3]), 'changing what was written changes nothing stored');
      read[1] = 9;
      deepEqual(await blobs.read(['given']), new Uint8Array([1, 2, 3]), 'changing what was read changes nothing stored');
      await blobs.write(['view'], new Uint8Array([0, 1, 2, 3, 4]).subarray(1, 3));
      deepEqual(await blobs.read(['view']), new Uint8Array([1, 2]));
    },
  },
  {
    name: 'sweeps away no blob, and leaves a write in flight to finish',
    run: async ({ blobs }) => {
      await blobs.write(['kept'], bytes('kept'));
      const flight = gated('in ', 'flight');
      const writing = blobs.write(['inflight'], flight.source);
      await flight.waiting;
      equal((await blobs.sweep({ minAge: 60_000, dryRun: false })).deleted, 0, 'what a write in flight left is young');
      flight.open();
      equal(await writing, 9);
      deepEqual(await blobs.read(['inflight']), bytes('in flight'));
      equal((await blobs.sweep({ minAge: 0, dryRun: false })).deleted, 0, 'finished writes leave nothing behind');
      deepEqual(await blobs.read(['kept']), bytes('kept'));
    },
  },
];

// =============================================================================
// Locks
// =============================================================================

/**
 * The locks adapter's contract.
 */
export const locksContract: readonly AdapterCase<LocksSetup>[] = [
  {
    name: 'holds a name exclusively against every other request until it is released',
    run: async ({ open }) => {
      const locks = await open();
      const held = await locks.acquire('r', 'exclusive');
      ok(held !== null);
      equal(await locks.acquire('r', 'exclusive'), null, 'a second exclusive request is refused');
      equal(await locks.acquire('r', 'shared'), null, 'a shared request is refused');
      deepEqual(await locks.held('r'), ['exclusive']);
      const other = await locks.acquire('o', 'exclusive');
      ok(other !== null, 'another name is held apart');
      await other.release();
      await held.release();
      deepEqual(await locks.held('r'), []);
      const again = await locks.acquire('r', 'exclusive');
      ok(again !== null, 'a released name is taken again');
      await again.release();
    },
  },
  {
    name: 'lets shared holds share a name, holding it against an exclusive request until the last is released, each once',
    run: async ({ open }) => {
      const locks = await open();
      const first = await locks.acquire('r', 'shared');
      const second = await locks.acquire('r', 'shared');
      ok(first !== null && second !== null);
      deepEqual(await locks.held('r'), ['shared', 'shared']);
      equal(await locks.acquire('r', 'exclusive'), null);
      await first.release();
      await first.release();
      deepEqual(await locks.held('r'), ['shared'], 'a hold released twice releases itself alone');
      equal(await locks.acquire('r', 'exclusive'), null);
      await second.release();
      const exclusive = await locks.acquire('r', 'exclusive');
      ok(exclusive !== null);
      await exclusive.release();
    },
  },
  {
    name: 'grants a waiting request once the name is released, and refuses one whose wait runs out',
    run: async ({ open }) => {
      const locks = await open();
      const held = (await locks.acquire('r', 'exclusive'))!;
      const waiting = locks.acquire('r', 'exclusive', { wait: true });
      equal(await locks.acquire('r', 'exclusive', { wait: true, timeout: 50 }), null, 'its wait ran out');
      await held.release();
      const granted = await waiting;
      ok(granted !== null, 'the waiting request holds the name once it is released');
      deepEqual(await locks.held('r'), ['exclusive']);
      await granted.release();
      deepEqual(await locks.held('r'), [], 'the request whose wait ran out never holds it');
      const free = await locks.acquire('r', 'exclusive', { wait: true, timeout: 0 });
      ok(free !== null, 'a free name is granted whatever the wait');
      await free.release();
    },
  },
  {
    name: 'grants waiting requests in the order they were made, and refuses one that does not wait while one waits',
    run: async ({ open }) => {
      const locks = await open();
      const shared = (await locks.acquire('r', 'shared'))!;
      const granted: string[] = [];
      const exclusive = locks.acquire('r', 'exclusive', { wait: true }).then((hold) => {
        granted.push('exclusive');
        return hold;
      });
      const later = locks.acquire('r', 'shared', { wait: true }).then((hold) => {
        granted.push('shared');
        return hold;
      });
      equal(await locks.acquire('r', 'shared'), null, 'refused while a request waits, though only shared holds hold the name');
      await shared.release();
      const first = (await exclusive)!;
      deepEqual(await locks.held('r'), ['exclusive'], 'the exclusive request, made first, is granted first');
      await first.release();
      const second = (await later)!;
      deepEqual(granted, ['exclusive', 'shared']);
      await second.release();
    },
  },
  {
    name: 'keeps two sessions apart as two tabs, and frees what a closed session held',
    run: async ({ open }) => {
      const [first, second] = [await open(), await open()];
      ok(first.session !== second.session, 'each session has an id of its own');
      equal(await first.isAlive(first.session), true, 'a session is alive to itself');
      equal(await first.isAlive(second.session), true);
      equal(await second.isAlive(first.session), true);
      const held = await first.acquire('ws', 'exclusive');
      ok(held !== null);
      equal(await second.acquire('ws', 'exclusive'), null, 'another session is refused');
      equal(await second.acquire('ws', 'shared'), null);
      deepEqual(await second.held('ws'), ['exclusive'], 'a session sees what another holds');
      const waiting = second.acquire('ws', 'exclusive', { wait: true });
      await first.close();
      equal(await second.isAlive(first.session), false, 'a closed session is not alive');
      const taken = await waiting;
      ok(taken !== null, 'what the closed session held is free to the other');
      await held.release();
      deepEqual(await second.held('ws'), ['exclusive'], 'releasing a hold of a closed session releases nothing more');
      await taken.release();
      deepEqual(await second.held('ws'), []);
    },
  },
  {
    name: 'answers that a session no adapter opened is not alive',
    run: async ({ open }) => {
      const locks = await open();
      equal(await locks.isAlive('00000000-0000-4000-8000-000000000000'), false);
    },
  },
  {
    name: 'refuses the requests a session has waiting when it closes, and every request after',
    run: async ({ open }) => {
      const [first, second] = [await open(), await open()];
      const held = (await first.acquire('r', 'exclusive'))!;
      const waiting = second.acquire('r', 'exclusive', { wait: true });
      await second.close();
      equal(await waiting, null, 'the waiting request is refused');
      await rejects(() => second.acquire('r', 'exclusive'), { name: 'AdapterClosedError' });
      await rejects(() => second.held('r'), { name: 'AdapterClosedError' });
      await rejects(() => second.isAlive(first.session), { name: 'AdapterClosedError' });
      await second.close();
      await held.release();
      deepEqual(await first.held('r'), [], 'the refused request never took the name');
    },
  },
  {
    name: 'refuses a mode that is neither exclusive nor shared, and a wait that is not a whole number of milliseconds',
    run: async ({ open }) => {
      const locks = await open();
      await rejects(() => locks.acquire('r', 'both' as unknown as 'shared'), { name: 'TypeError' });
      for (const timeout of [-1, 1.5, Number.POSITIVE_INFINITY]) {
        await rejects(() => locks.acquire('r', 'exclusive', { wait: true, timeout }), { name: 'RangeError' }, `a wait of ${timeout}`);
      }
      deepEqual(await locks.held('r'), [], 'no refused request took the name');
    },
  },
];

// =============================================================================
// Files
// =============================================================================

/**
 * The files adapter's contract.
 */
export const filesContract: readonly AdapterCase<FilesSetup>[] = [
  {
    name: 'writes a file whole, and reads it back a chunk at a time, with its size',
    run: async ({ files, dir, join }) => {
      const file = join(dir, 'delivery');
      equal(await files.write(file, bytes('a delivery')), 10);
      deepEqual((await readAll(files, file)).data, bytes('a delivery'));
      equal((await files.stat(file))?.size, 10);
      const large = new Uint8Array(300_000).map((_, i) => i % 251);
      equal(await files.write(file, (async function* () {
        for (let offset = 0; offset < large.length; offset += 100_000) yield large.subarray(offset, offset + 100_000);
      })()), 300_000);
      const back = await readAll(files, file);
      deepEqual(back.data, large);
      ok(back.chunks > 1, `a large file is read in chunks, not whole: ${back.chunks}`);
    },
  },
  {
    name: 'answers nothing for a file that is not there, and refuses to read one, or a directory',
    run: async ({ files, dir, join }) => {
      const missing = join(dir, 'missing');
      equal(await files.stat(missing), null);
      await rejects(() => readAll(files, missing), { name: 'FileNotFoundError' });
      equal(await files.remove(missing), false);
      equal(await files.stat(dir), null, 'a directory is no file');
      await rejects(() => readAll(files, dir), { name: 'FileNotFoundError' }, 'nor is it read as one');
    },
  },
  {
    name: 'writes a file only into a directory that is there, and makes directories',
    run: async ({ files, dir, join }) => {
      const nested = join(join(dir, 'a'), 'b');
      const file = join(nested, 'file');
      await rejects(() => files.write(file, bytes('x')), { name: 'FileNotFoundError' });
      await files.mkdir(nested);
      await files.mkdir(nested);
      equal(await files.write(file, bytes('x')), 1);
      deepEqual((await readAll(files, file)).data, bytes('x'));
    },
  },
  {
    name: 'replaces a file whole, and leaves it as it was when a write of it fails',
    run: async ({ files, dir, join }) => {
      const file = join(dir, 'replaced');
      await files.write(file, bytes('a long first file'));
      equal(await files.write(file, chunks('sh', 'ort')), 5);
      deepEqual((await readAll(files, file)).data, bytes('short'));
      await rejects(() => files.write(file, failing('partial')), { message: /the source failed/ });
      deepEqual((await readAll(files, file)).data, bytes('short'));
      const fresh = join(dir, 'fresh');
      await rejects(() => files.write(fresh, failing('partial')), { message: /the source failed/ });
      equal(await files.stat(fresh), null, 'a new file a failed write never finished is not there');
    },
  },
  {
    name: 'removes a file, and says whether there was one',
    run: async ({ files, dir, join }) => {
      const file = join(dir, 'removed');
      await files.write(file, bytes('x'));
      equal(await files.remove(file), true);
      equal(await files.stat(file), null);
      equal(await files.remove(file), false);
      const sub = join(dir, 'sub');
      await files.mkdir(sub);
      equal(await files.remove(sub), false, 'a directory is left');
    },
  },
];
