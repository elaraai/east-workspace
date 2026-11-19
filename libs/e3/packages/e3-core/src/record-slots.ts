/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The reserved slots a composite record's ref keeps for its external sources,
 * in its version vector: which sources its readers wait for a first delivery
 * of, which sources were external at its last deploy, and what each source's
 * last delivery was.
 *
 * Each slot is text. A commit that owns none of them carries them as they are
 * (`nextVersions`, `records.ts`), so only their writers say what they hold: a
 * deploy, which is here, and the commits that take a delivery or undo one.
 *
 * | Slot | Holds |
 * |---|---|
 * | `$pending` | The external sources yet to deliver, sorted, comma-separated |
 * | `$external` | The record's external sources at its last deploy, the same way |
 * | `$load.<source>` | The source's last delivery, by its stored hash |
 * | `$load.<source>.load` | The load object the delivery ran under |
 * | `$load.<source>.commit` | The commit that applied it; empty once a compaction cut it from the chain |
 * | `$load.<source>.execution` | The execution that made its delta |
 * | `$load.<source>.feed` | The version vector of the feed it was made from |
 * | `$load.<source>.asOf` | The latest time any delivery of the source said its data was as of |
 *
 * @packageDocumentation
 */

import { DateTimeType, StringType, compareFor, decodeBeast2ElementsFor, equalFor, isVariant, parseFor } from '@elaraai/east';
import { parseKeypath } from '@elaraai/e3-types';
import { DatasetSegments } from './dataset-open.js';
import type { StorageBackend } from './storage/interfaces.js';

/** How East orders a variant's cases, and so a composite record's sources in
 *  its rows: by their names. */
const byName = compareFor(StringType);

/** Reads an as-of, as East prints a DateTime. */
const parseTime = parseFor(DateTimeType);

/** Whether a keypath's field is the one named. */
const sameField = equalFor(StringType);

/** Whether two sources' names are one. */
const sameSource = equalFor(StringType);

/** Reserved slot naming the external sources a record's readers wait for the
 *  first delivery of, sorted and separated by commas; absent when none waits. */
export const PENDING_SLOT = '$pending';

/** Reserved slot naming a record's external sources at its last deploy, sorted
 *  and separated by commas; absent for a record with none. A deploy reads the
 *  sources of the package it replaces here, never from that package's record
 *  object, which an earlier SDK may have written. */
export const EXTERNAL_SLOT = '$external';

/** What every slot of a source's deliveries starts with. */
const LOAD_SLOTS = '$load.';

/** The slots of one source's last delivery, by what each holds. */
export interface SourceLoadSlots {
  /** The delivery's stored hash. */
  readonly delivery: string;
  /** The load object the delivery ran under. */
  readonly load: string;
  /** The commit that applied it. */
  readonly commit: string;
  /** The execution that made its delta. */
  readonly execution: string;
  /** The version vector of the feed it was made from. */
  readonly feed: string;
  /** The latest as-of any delivery of the source carried. */
  readonly asOf: string;
}

/**
 * The names of the slots a source's last delivery is kept in.
 *
 * @param source - The source's name
 * @returns Each slot's name
 *
 * @example
 * ```ts
 * sourceLoadSlots('erp').commit; // '$load.erp.commit'
 * ```
 */
export function sourceLoadSlots(source: string): SourceLoadSlots {
  const delivery = `${LOAD_SLOTS}${source}`;
  return {
    delivery,
    load: `${delivery}.load`,
    commit: `${delivery}.commit`,
    execution: `${delivery}.execution`,
    feed: `${delivery}.feed`,
    asOf: `${delivery}.asOf`,
  };
}

/**
 * The names a slot lists, separated by commas.
 *
 * @param versions - A record ref's version vector
 * @param slot - The slot
 * @returns The names, in the slot's order; none when the ref holds no such
 *   slot, or holds it empty
 */
export function slotNames(versions: ReadonlyMap<string, string>, slot: string): string[] {
  const held = versions.get(slot);
  return held === undefined || held.length === 0 ? [] : held.split(',');
}

/**
 * A slot listing sources: their names, sorted as East sorts them, separated by
 * commas.
 *
 * @param sources - The sources' names
 * @returns The slot's text, or `undefined` for no source, which drops the slot
 */
export function sourcesSlot(sources: Iterable<string>): string | undefined {
  const names = [...sources].sort(byName);
  return names.length === 0 ? undefined : names.join(',');
}

/**
 * The external sources a record waits for the first delivery of.
 *
 * @param versions - The record ref's version vector
 * @returns Their names, sorted; none for a record that waits for none, and for
 *   one that has no external source
 *
 * @example
 * ```ts
 * const waits = pendingSources(ref.value.versions); // ['erp'] until its first load commits
 * ```
 */
export function pendingSources(versions: ReadonlyMap<string, string>): string[] {
  return slotNames(versions, PENDING_SLOT);
}

/**
 * What a composite record's readers wait for, in words: what a run's `[WAIT]`
 * line and a workspace's status say of a task whose input is the record, or
 * an index of it, while the record has yet to hear from external sources.
 *
 * @param record - The record's keypath, as a task's input names it
 * @param sources - The external sources yet to deliver, by name
 * @returns The words, naming the record as it was declared
 *
 * @example
 * ```ts
 * pendingWaitWords('.records.orders', ['erp', 'wms']);
 * // "record 'orders' waits for the first delivery of erp, wms"
 * ```
 */
export function pendingWaitWords(record: string, sources: readonly string[]): string {
  const path = parseKeypath(record);
  const name = path.length === 2 && sameField(path[0]!.value, 'records') ? path[1]!.value : record;
  return `record '${name}' waits for the first delivery of ${sources.join(', ')}`;
}

/** A source's last delivery, as its record's ref names it. */
export interface SourceDelivery {
  /** The delivery's stored hash. */
  readonly delivery: string;
  /** The commit that applied it; absent once a compaction has cut it from the
   *  chain. */
  readonly commit?: string;
  /** The latest time any delivery of the source said its data was as of;
   *  absent when none said. */
  readonly asOf?: Date;
}

/**
 * The last delivery a record's ref names for a source.
 *
 * @param versions - The record ref's version vector
 * @param source - The source's name
 * @returns The delivery, or `null` for a source the ref names none for: one
 *   yet to deliver, one whose delivery a migration, a reset or a deploy made
 *   the record forget, and a source the record's mutations write
 *
 * @example
 * ```ts
 * const last = sourceLastDelivery(ref.value.versions, 'erp');
 * if (last !== null) console.log(last.delivery, last.commit ?? '(compacted)');
 * ```
 */
export function sourceLastDelivery(versions: ReadonlyMap<string, string>, source: string): SourceDelivery | null {
  const slots = sourceLoadSlots(source);
  const delivery = versions.get(slots.delivery);
  if (delivery === undefined) return null;
  const commit = versions.get(slots.commit);
  const said = versions.get(slots.asOf);
  const asOf = said === undefined ? undefined : parseTime(said);
  return {
    delivery,
    ...(commit !== undefined && commit.length > 0 && { commit }),
    ...(asOf?.success === true && { asOf: asOf.value }),
  };
}

/** The case of a composite record's key: the source its entry is of. */
function caseOf(key: unknown): string {
  if (!isVariant(key)) throw new Error('a record with sources is keyed by a variant of them, and this state\'s keys are none');
  return key.type;
}

/**
 * Whether a state of a composite record holds any entry of a source.
 *
 * @remarks
 * A record's rows are in key order, and a variant key orders by its case's
 * name first, so a source's entries are one run of them. The run is looked for
 * among the fences the state's manifest holds, which costs no read: a segment
 * whose first key is of the source says yes. When no segment starts inside the
 * run, it lies, if anywhere, within the one segment before it, which is read
 * and scanned up to the run.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param state - The state's hash: a record state, or its rows' manifest
 * @param source - The source's name: a case of the record's key
 * @returns Whether the state holds an entry of the source
 * @throws {Error} When the state's keys are not a variant's, or the state is
 *   stored as one blob
 */
export async function sourceHoldsEntries(storage: StorageBackend, repo: string, state: string, source: string): Promise<boolean> {
  const segments = await DatasetSegments.open(storage, repo, state);
  const count = segments.segmentCount;
  const caseAt = async (i: number): Promise<string> => caseOf(await segments.fence(i));
  // The first segment whose first key is of the source, or of one after it
  let before = -1;
  let from = count;
  while (from - before > 1) {
    const mid = (before + from) >> 1;
    if (byName(await caseAt(mid), source) < 0) before = mid;
    else from = mid;
  }
  if (from < count && byName(await caseAt(from), source) === 0) return true;
  // No segment starts inside the run, so it lies within the one before, if anywhere
  if (before < 0) return false;
  const keyed = segments.typeValue.type === 'Dict';
  for await (const element of decodeBeast2ElementsFor(segments.typeValue)([await segments.segment(before)])) {
    const order = byName(caseOf(keyed ? (element as [unknown, unknown])[0] : element), source);
    if (order === 0) return true;
    if (order > 0) return false;
  }
  return false;
}

/**
 * The slots a deploy writes on a record it mints, or resets to the package's
 * initial value: no delivery is remembered, and an external source waits for
 * its first delivery unless the state committed holds an entry of it.
 *
 * @remarks
 * A package's initial value may hold an external source's entries: a
 * workspace exported as a package carries the rows its sources had delivered.
 * Such a source counts as delivered ({@link sourceHoldsEntries}), as one new
 * to the external set does at a keep or a migrate ({@link deploySourceSlots}),
 * and its readers run on the rows.
 *
 * Every `$load.` slot the ref held is named, each to be dropped, since a
 * commit drops only the slots it names.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param prior - The version vector of the ref being replaced; `undefined`
 *   for a record the workspace does not hold
 * @param external - The record's external sources, as the package being
 *   deployed declares them
 * @param state - The state the deploy commits
 * @returns The slots to write: a value writes one, `undefined` drops it
 *
 * @example
 * ```ts
 * // A mint of `orders` from a state that holds erp's rows and none of wms's
 * await genesisSourceSlots(storage, repo, undefined, ['erp', 'wms'], state);
 * // { $pending: 'wms', $external: 'erp,wms' }
 * ```
 */
export async function genesisSourceSlots(
  storage: StorageBackend,
  repo: string,
  prior: ReadonlyMap<string, string> | undefined,
  external: readonly string[],
  state: string,
): Promise<Record<string, string | undefined>> {
  const owned: Record<string, string | undefined> = {};
  for (const slot of prior?.keys() ?? []) {
    if (slot.startsWith(LOAD_SLOTS)) owned[slot] = undefined;
  }
  const pending: string[] = [];
  for (const source of external) {
    if (!(await sourceHoldsEntries(storage, repo, state, source))) pending.push(source);
  }
  owned[PENDING_SLOT] = sourcesSlot(pending);
  owned[EXTERNAL_SLOT] = sourcesSlot(external);
  return owned;
}

/**
 * The slots a deploy writes on a record it keeps under a changed package, or
 * migrates.
 *
 * @remarks
 * - A source that was external and waited, and is external still, waits.
 * - A source new to the external set — added, or changed from one the
 *   record's mutations write — waits only when the state the deploy commits
 *   holds no entry of it ({@link sourceHoldsEntries}): rows a migration put
 *   under it, or people entered before it was handed to its load, count as
 *   delivered, and its readers run on them.
 * - A source that was external and is no longer has its delivery forgotten,
 *   and waits for nothing.
 * - A migration rewrites the entries, so the record no longer holds what each
 *   source's last delivery said: each external source's delivery slots are
 *   dropped but its as-of, which still dates what the source sent.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param prior - The version vector of the ref being replaced
 * @param external - The record's external sources, as the package being
 *   deployed declares them
 * @param state - The state the deploy commits
 * @param migrated - Whether the deploy migrates the record
 * @returns The slots to write: a value writes one, `undefined` drops it
 */
export async function deploySourceSlots(
  storage: StorageBackend,
  repo: string,
  prior: ReadonlyMap<string, string>,
  external: readonly string[],
  state: string,
  migrated: boolean,
): Promise<Record<string, string | undefined>> {
  const waited = pendingSources(prior);
  const was = slotNames(prior, EXTERNAL_SLOT);
  const owned: Record<string, string | undefined> = {};
  for (const source of was) {
    if (external.some((each) => sameSource(each, source))) continue;
    for (const slot of Object.values(sourceLoadSlots(source))) owned[slot] = undefined;
  }
  const pending: string[] = [];
  for (const source of external) {
    const named = (names: readonly string[]): boolean => names.some((each) => sameSource(each, source));
    if (named(waited) || (!named(was) && !(await sourceHoldsEntries(storage, repo, state, source)))) pending.push(source);
    if (!migrated) continue;
    const { delivery, load, commit, execution, feed } = sourceLoadSlots(source);
    for (const slot of [delivery, load, commit, execution, feed]) owned[slot] = undefined;
  }
  owned[PENDING_SLOT] = sourcesSlot(pending);
  owned[EXTERNAL_SLOT] = sourcesSlot(external);
  return owned;
}

/**
 * The slots a compaction rewrites: each source's delivery commit, emptied,
 * since the chain no longer holds it.
 *
 * @param versions - The record ref's version vector
 * @returns The slots to write; none for a record that remembers no delivery
 */
export function compactedSourceSlots(versions: ReadonlyMap<string, string>): Record<string, string> {
  const owned: Record<string, string> = {};
  for (const source of slotNames(versions, EXTERNAL_SLOT)) {
    const { commit } = sourceLoadSlots(source);
    if (versions.has(commit)) owned[commit] = '';
  }
  return owned;
}
