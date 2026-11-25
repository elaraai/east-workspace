/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What the rack machine protocol says in JSON: everything that grows.
 *
 * @remarks
 * A rack serves sources of several e3 releases at once, so nothing the two
 * exchange may change shape with a release. The protocol's BEAST2 structs
 * (`rack-wire.ts`) are fixed at {@link RACK_PROTOCOL}; what a rack is, what it
 * has free, and why a request was refused are JSON, here, which either side
 * reads for the fields it knows and ignores the rest:
 * - the hello a source answers before any credential is shown ({@link RackHello});
 * - the report a rack sends with every heartbeat ({@link RackReport});
 * - the offer a rack makes with every poll for work ({@link RackOffer});
 * - a refusal's body ({@link RackRefusal}).
 *
 * The lease's event and its result are JSON already (`task-envelope.ts`).
 */

/**
 * The rack machine protocol this build speaks: 3, the first whose replies
 * hold no type of e3's HTTP API. An agent and a source speak the same number,
 * or refuse each other once, by name.
 */
export const RACK_PROTOCOL = 3;

/** The header every request of an agent names {@link RACK_PROTOCOL} in. */
export const RACK_PROTOCOL_HEADER = 'x-e3-rack-protocol';

/**
 * The transfers a source serves one rack at once, unless it says otherwise.
 *
 * @remarks
 * A rack may reach its source over a link of tens of milliseconds and some
 * MB/s (a tunnel to a developer's machine: 35 ms and 12 to 20 MB/s, measured).
 * What one transfer moves in a round trip is one object, a segment of some
 * KiB, so the link holds its rate only with its bytes in flight, its
 * bandwidth-delay product, of half a MB: 8 transfers of 6 KB move 1.4 MB/s,
 * a tenth of it; 32 move four times that, and whole objects past the inline
 * limit ({@link RACK_INLINE_OBJECT_MAX}) fill it. Each transfer is a stream
 * the hub relays with backpressure, some tens of KiB of buffer each.
 */
export const RACK_TRANSFERS_AT_ONCE = 32;

/**
 * How long work that a rack's offer does not hold is passed over, in ms, by
 * smaller work behind it in the queue, before it holds the line at that rack:
 * as long as the local budget lets a unit that does not fit be passed.
 */
export const RACK_PASS_OVER_MS = 10_000;

/**
 * The header of a poll answered with no work (`204`) while work the offer did
 * not hold waits: a {@link RackWaiting}, as JSON.
 */
export const RACK_WAITING_HEADER = 'x-e3-rack-waiting';

/**
 * What the oldest lease a rack's offer did not hold asks of it, and how long
 * it has waited: the rack holds that much back, across its sources, until it
 * can offer it.
 */
export interface RackWaiting extends RackResources {
  /** How long the lease has been queued, in ms */
  readonly ms: number;
}

/**
 * Reads a poll's waiting header.
 *
 * @param json - The header's value, or null when the poll had none
 * @returns What waits, or undefined when nothing does or the header does not
 *   read
 *
 * @example
 * ```ts
 * const waiting = readRackWaiting(response.headers.get(RACK_WAITING_HEADER));
 * if (waiting !== undefined) holdBack(waiting.memoryBytes);
 * ```
 */
export function readRackWaiting(json: string | null): RackWaiting | undefined {
  if (json === null) return undefined;
  try {
    const fields = object(json, 'the waiting header');
    return { ...resources(fields, 'the waiting header'), ms: count(fields.ms, 'the waiting header\'s ms') };
  } catch {
    return undefined;
  }
}

/**
 * How long a source's listener keeps an idle connection open, in ms, which
 * every reply says in its `Keep-Alive`.
 */
export const RACK_LISTENER_IDLE_MS = 75_000;

/**
 * How long an agent keeps a connection it is not using before it closes it,
 * in ms: less than {@link RACK_LISTENER_IDLE_MS} by more than any link's
 * delay, so an agent never sends a request on a connection its source has
 * already closed, which ends as a connection reset.
 */
export const RACK_AGENT_IDLE_MS = 60_000;

/** The cores, memory and GPUs of a rack, or the part of them that is free. */
export interface RackResources {
  /** Cores: a unit of work takes one */
  readonly cores: number;
  /** Bytes of memory */
  readonly memoryBytes: number;
  /** GPUs: work that asks for one takes it whole */
  readonly gpus: number;
}

/**
 * The hello's feature by which a source says it takes a call's value as an
 * object of its store: a function lease's completion may name its value by
 * hash, the output it commits, in place of carrying it inline.
 */
export const RACK_CALL_VALUE_OBJECTS = 'call-value-objects';

/**
 * The hello's feature by which a source says it reads, in a rack's report,
 * the manifest of each tier the rack boots environments over
 * ({@link RackReport.tiers}): a rack sends a manifest's text only to a source
 * that names it.
 */
export const RACK_TIER_MANIFESTS = 'tier-manifests';

/**
 * The hello's feature by which a source says it serves an object of a
 * storage request inline, in its reply, up to the size the request names in
 * {@link RACK_INLINE_MAX_HEADER} (at most {@link RACK_INLINE_OBJECT_MAX}),
 * within a bound on each reply's inline bytes past which the rest are URLs. So
 * a request for many small objects is answered with their bytes, one round
 * trip, rather than a URL for each to be read in another. A rack sends the
 * header only to a source that names it, and asks such a source for the
 * small objects of a lease's closure as the lease starts.
 */
export const RACK_INLINE_OBJECTS = 'inline-objects';

/**
 * The feature by which a source and a rack say they spread a lease's data URLs
 * over several origins, each its own connection (a tunnel's TCP window bounds
 * every transfer inside it). A source's hello names it, and lists the origins
 * beside its own that reach it ({@link RackHello.dataOrigins}), each serving
 * the certificate its own origin serves; a rack's report names it when the
 * rack fetches a data URL on any origin its source's hello lists, through its
 * source's pinned certificate. A source gives data URLs on those origins only
 * to a rack whose report names it, and every other rack all of them on its own
 * origin, as before it.
 */
export const RACK_DATA_ORIGINS = 'data-origins';

/** The most data origins a hello's list is read for: the rest are passed over. */
export const RACK_DATA_ORIGINS_MAX = 16;

/**
 * The header of a storage request in which a rack names the largest object it
 * takes inline in the reply, in bytes, as a decimal: a source that names
 * {@link RACK_INLINE_OBJECTS} serves an object of at most that size inline, and
 * at most its own {@link RACK_INLINE_OBJECT_MAX}. A request that names none
 * takes {@link RACK_INLINE_OBJECT_DEFAULT}, as every request did before.
 */
export const RACK_INLINE_MAX_HEADER = 'x-e3-rack-inline-max';

/** The largest object a storage request that names no {@link RACK_INLINE_MAX_HEADER} is served inline. */
export const RACK_INLINE_OBJECT_DEFAULT = 4096;

/**
 * The largest object a source serves inline: a segment of a collection is
 * some KiB, so a reply carries one whole in the round trip that asked for it.
 */
export const RACK_INLINE_OBJECT_MAX = 64 * 1024;

/**
 * Reads a storage request's {@link RACK_INLINE_MAX_HEADER}.
 *
 * @param value - The header's value, or null when the request had none
 * @returns The largest object to serve the request inline, in bytes: what it
 *   names, at most {@link RACK_INLINE_OBJECT_MAX}; and
 *   {@link RACK_INLINE_OBJECT_DEFAULT} for a request that names none, or
 *   names what is not a decimal count of bytes
 *
 * @example
 * ```ts
 * const most = readRackInlineMax(c.req.header(RACK_INLINE_MAX_HEADER) ?? null);
 * ```
 */
export function readRackInlineMax(value: string | null): number {
  if (value === null || !/^\d{1,16}$/.test(value.trim())) return RACK_INLINE_OBJECT_DEFAULT;
  const bytes = Number(value.trim());
  return Number.isSafeInteger(bytes) ? Math.min(bytes, RACK_INLINE_OBJECT_MAX) : RACK_INLINE_OBJECT_DEFAULT;
}

/**
 * The report's feature by which a rack says it composes an environment built
 * over the tier it boots it over: it unpacks the environment's layers over
 * that tier's image, and links the environment to what the image holds
 * (e3-core's `composeEnvironmentOverTier`): a python environment's
 * interpreter to the image's, and each of East's packages a node one left to
 * the tier to the image's copy. It says which image each tier is by its
 * manifest ({@link RackReport.tiers}), and reports only a manifest its e3
 * reads: one of a form it does not read is no image it composes over.
 */
export const RACK_ENVIRONMENTS_OVER_TIER = 'environments-over-tier';

/**
 * The report's feature by which a rack says it keeps what the leases of a
 * scope wrote for its later leases, until its source says the scope ended: a
 * lease is then granted it with its scope (`RackLeaseEvent.scope`), and the
 * heartbeat's answer names the scopes that ended
 * ({@link RACK_SCOPES_ENDED_HEADER}). A scope is a split task's execution,
 * whose units' leases name it. A rack that does not name the feature is
 * granted the same lease without one; one that names
 * {@link RACK_HUB_KEYED_SCOPES} too is granted its source's own scope in its
 * place, where the source keeps one.
 */
export const RACK_SPLIT_SCOPES = 'split-scopes';

/**
 * The report's feature by which a rack says it keeps a hub's objects for the
 * hub's life, encrypted under a key the hub gives it: every task's and unit's
 * lease it is granted names the hub's own scope (`RackLeaseEvent.scope`, its
 * `keyed` true, one id for the hub's process), and every heartbeat's answer
 * gives it the scope's key ({@link RACK_HUB_KEY_HEADER}). What the rack keeps
 * of the scope — what its leases fetched and made — it keeps encrypted under
 * that key alone, and reads only while its source still gives it: a hub that
 * restarts has a new scope and a new key, and the rack deletes what it kept
 * of the old one. A rack that names the feature is still granted a split
 * scope by a source that keeps none of its own; one that does not is granted
 * no hub scope, and never told a key.
 */
export const RACK_HUB_KEYED_SCOPES = 'hub-keyed-scopes';

/**
 * The header of a heartbeat's answer that gives a rack that names
 * {@link RACK_HUB_KEYED_SCOPES} the key of its source's own scope: a JSON
 * object, `{"id": <the scope's id>, "key": <32 bytes, base64>}`. A source
 * sends it with every answer to such a rack, and only over a pinned TLS
 * connection; it is a secret, which neither side logs, journals, stores or
 * puts in anything a lease's guest sees. An answer with none, or with another
 * id, says the rack holds the key of no scope it kept before.
 */
export const RACK_HUB_KEY_HEADER = 'x-e3-rack-hub-key';

/** The bytes of a hub scope's key: an AES-256 key. */
export const RACK_HUB_KEY_BYTES = 32;

/** A hub scope's key, as a heartbeat's answer gives it ({@link RACK_HUB_KEY_HEADER}). */
export interface RackHubKey {
  /** The hub scope's id, as its leases name it: one for the hub's process */
  readonly id: string;
  /** The key, {@link RACK_HUB_KEY_BYTES} bytes */
  readonly key: Uint8Array;
}

/**
 * The value of a heartbeat answer's hub-key header.
 *
 * @param key - The scope's id and key
 * @returns The header's value
 * @throws {Error} When the id is no scope's, or the key is not 32 bytes
 * @example
 * ```ts
 * response.headers.set(RACK_HUB_KEY_HEADER, rackHubKeyHeader({ id: scopeId, key: rackKey }));
 * ```
 */
export function rackHubKeyHeader(key: RackHubKey): string {
  if (!isRackScopeId(key.id) || key.key.byteLength !== RACK_HUB_KEY_BYTES) throw new Error('A hub scope\'s key is 32 bytes, of a scope\'s id');
  return JSON.stringify({ id: key.id, key: Buffer.from(key.key).toString('base64') });
}

/**
 * Reads a heartbeat answer's hub-key header.
 *
 * @param json - The header's value, or null when the answer had none
 * @returns The scope's id and key; undefined when the header is absent, does
 *   not read, names no scope's id, or holds no key of 32 bytes
 * @example
 * ```ts
 * const key = readRackHubKey(response.headers.get(RACK_HUB_KEY_HEADER));
 * ```
 */
export function readRackHubKey(json: string | null): RackHubKey | undefined {
  if (json === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { id, key } = value as Record<string, unknown>;
  if (!isRackScopeId(id) || typeof key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(key)) return undefined;
  const bytes = Buffer.from(key, 'base64');
  return bytes.byteLength === RACK_HUB_KEY_BYTES ? { id, key: new Uint8Array(bytes) } : undefined;
}

/**
 * The header of a heartbeat's answer that names the scopes that ended
 * of those the rack was granted a lease of: a JSON array of their ids. Each is
 * named once, to a rack whose report names {@link RACK_SPLIT_SCOPES}; an
 * answer lost on its way is not sent again, so a rack bounds what it keeps of
 * a scope by its own time too.
 */
export const RACK_SCOPES_ENDED_HEADER = 'x-e3-rack-scopes-ended';

/**
 * Whether a text is a scope's id, as a lease or a heartbeat's answer
 * names one: a word of at most 64 letters, digits and hyphens.
 *
 * @param value - The text
 * @returns Whether it is one
 * @example
 * ```ts
 * isRackScopeId('0193b1c2-7f00-7abc-8def-0123456789ab'); // true
 * ```
 */
export function isRackScopeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(value);
}

/** The most scopes one heartbeat's answer names as ended, as a reader takes
 *  them; a source names no more than fit {@link RACK_SCOPES_ENDED_BYTES}
 *  ({@link rackScopesEndedFitting}), and those past them with the next. */
export const RACK_SCOPES_ENDED_MAX = 1024;

/**
 * The most bytes of the ended-scopes header's value one answer carries: well
 * within the 16 KiB of headers an HTTP client of Node's takes of a response
 * in all, which refuses the whole answer past it. About 300 scopes of a UUID
 * each.
 */
export const RACK_SCOPES_ENDED_BYTES = 12 * 1024;

/**
 * The ended scopes one heartbeat's answer names, of those given in order: as
 * many as the header's JSON holds within {@link RACK_SCOPES_ENDED_BYTES}, and
 * at most {@link RACK_SCOPES_ENDED_MAX}. A source answers these, and keeps the
 * rest for the next heartbeat.
 *
 * @param ids - The ended scopes' ids, oldest first, each a scope's id
 *   ({@link isRackScopeId}): a word, a byte a character
 * @returns The first of them that one answer carries
 * @example
 * ```ts
 * const told = rackScopesEndedFitting(ended);
 * if (told.length > 0) response.headers.set(RACK_SCOPES_ENDED_HEADER, JSON.stringify(told));
 * ```
 */
export function rackScopesEndedFitting(ids: readonly string[]): string[] {
  const told: string[] = [];
  // The array's brackets, then each id quoted, after a comma but the first
  let bytes = 2;
  for (const id of ids) {
    const more = id.length + 2 + (told.length > 0 ? 1 : 0);
    if (told.length >= RACK_SCOPES_ENDED_MAX || bytes + more > RACK_SCOPES_ENDED_BYTES) break;
    told.push(id);
    bytes += more;
  }
  return told;
}

/**
 * Reads a heartbeat answer's ended-scopes header.
 *
 * @param json - The header's value, or null when the answer had none
 * @returns The ids of the scopes that ended, at most
 *   {@link RACK_SCOPES_ENDED_MAX}; none when the header is absent or does not
 *   read, and none of an entry that is no scope's id
 *
 * @example
 * ```ts
 * for (const scope of readRackScopesEnded(response.headers.get(RACK_SCOPES_ENDED_HEADER))) forget(scope);
 * ```
 */
export function readRackScopesEnded(json: string | null): string[] {
  if (json === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.slice(0, RACK_SCOPES_ENDED_MAX).filter(isRackScopeId);
}

/**
 * What a rack that keeps its source's own scope (`hub-keyed-scopes`) says of
 * what it keeps of it, with each heartbeat.
 */
export interface RackReportedHubScope {
  /** An id the rack changes whenever it deletes what it keeps of the scope as
   *  a whole — its agent started, its key changed or was lost, the scope went
   *  idle: a source that sees another forgets what it knew the rack to hold.
   *  A scope's id in form ({@link isRackScopeId}). */
  readonly store: string;
  /** How long the rack keeps the scope unused, in ms: a source takes what it
   *  knew it to hold as gone once it has not used the rack's scope so long. */
  readonly idleMs: number;
}

/** What a rack says of a tier it boots environments over. */
export interface RackReportedTier {
  /** The digest of the tier image's manifest: `sha256:<hex>` of its bytes */
  readonly digest: string;
  /**
   * The manifest's text, as its image holds it, for a source that reads it
   * ({@link RACK_TIER_MANIFESTS}): with the rack's first heartbeat to the
   * source, and then with the heartbeat after an answer that asks for it
   * ({@link RACK_MANIFESTS_WANTED_HEADER}). Otherwise the digest goes alone,
   * by which a source that holds the text keeps it.
   */
  readonly manifest?: string;
}

/**
 * The header of a heartbeat's answer that names, by their digests, the tier
 * manifests the rack reports whose text the source holds none of: a JSON
 * array. The rack sends each one's text with its next heartbeat. A source
 * that started again holds none, and asks; one that refused a manifest's text
 * does not ask for it again.
 */
export const RACK_MANIFESTS_WANTED_HEADER = 'x-e3-rack-tier-manifests-wanted';

/**
 * Reads a heartbeat answer's wanted-manifests header.
 *
 * @param json - The header's value, or null when the answer had none
 * @returns The digests of the manifests whose text the source asks for; none
 *   when the header is absent or does not read, and none of an entry that is
 *   not a manifest's digest
 *
 * @example
 * ```ts
 * const wanted = readRackManifestsWanted(response.headers.get(RACK_MANIFESTS_WANTED_HEADER));
 * // the next heartbeat's report carries the text of each tier whose digest is wanted
 * ```
 */
export function readRackManifestsWanted(json: string | null): string[] {
  if (json === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter((digest: unknown): digest is string => typeof digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(digest));
}

/**
 * What a source answers `GET /api/rack/hello` with, to anyone who can reach
 * it: the protocol it speaks, its e3 release, its limits, and what it takes
 * beyond the protocol.
 */
export interface RackHello {
  /** The rack protocol the source speaks */
  readonly protocol: number;
  /** The source's e3 release */
  readonly e3: string;
  /** What the source holds an agent to */
  readonly limits: {
    /** The object and layer transfers it serves one rack at once */
    readonly transfersAtOnce: number;
  };
  /**
   * What the source takes beyond the protocol: {@link RACK_CALL_VALUE_OBJECTS},
   * {@link RACK_TIER_MANIFESTS}, {@link RACK_INLINE_OBJECTS},
   * {@link RACK_DATA_ORIGINS}. An agent uses a feature only with a source
   * that names it; a source that names none takes none.
   */
  readonly features: readonly string[];
  /**
   * The origins beside its own that the source may build a data URL on, of a
   * source that names {@link RACK_DATA_ORIGINS}: each an `http(s)://host:port`
   * origin that reaches the source, serving the certificate its own origin
   * serves. Absent of a source that lists none, as one that names no
   * {@link RACK_DATA_ORIGINS} does.
   */
  readonly dataOrigins?: readonly string[];
}

/**
 * What a rack is and has, sent with every heartbeat.
 */
export interface RackReport {
  /**
   * What the rack does beyond running a stock tier's work: `resources` (it
   * admits work by its cores and memory, books what each lease reserves, lets
   * the work grow to the cap its lease names and stops it there, and stops
   * the newest unit it holds when its host runs short), `environments` (it
   * composes a lease's environment from layers),
   * {@link RACK_ENVIRONMENTS_OVER_TIER} (it composes one built over a tier),
   * {@link RACK_SPLIT_SCOPES} (it keeps a scope's outputs for its later
   * leases), {@link RACK_HUB_KEYED_SCOPES} (it keeps a hub's objects for the
   * hub's life, encrypted under the hub's key), {@link RACK_DATA_ORIGINS} (it fetches a data URL on any origin its
   * source's hello lists).
   */
  readonly features: readonly string[];
  /** The platform environments are installed for, as e3-core names one
   *  (`x86_64-manylinux_2_28`): a rack that composes environments says it */
  readonly target?: string;
  /** The tiers the rack boots environments over, by tier: each image's
   *  manifest, by its digest, and its text for a source that reads it */
  readonly tiers?: Readonly<Record<string, RackReportedTier>>;
  /** All the rack has */
  readonly resources?: RackResources;
  /**
   * What the rack keeps of its source's own scope, beside
   * {@link RACK_HUB_KEYED_SCOPES} ({@link RackReportedHubScope}): absent from
   * a rack that names no such feature, or reports none.
   */
  readonly hubScope?: RackReportedHubScope;
  /** What of it is not booked now */
  readonly free?: RackResources;
}

/**
 * What a poll for work may be answered with: the rack holds this much back
 * until the poll answers, so the polls it makes of several sources at once
 * never promise the same memory.
 */
export type RackOffer = RackResources;

/** A refusal's body: why, in a word and in words, and when to ask again. */
export interface RackRefusal {
  /** Why, as a word a program reads: `invalid-request`, `busy`, … */
  readonly code: string;
  /** The same in words */
  readonly message: string;
  /** How long to wait before the same request is sent again, in ms */
  readonly retryAfterMs?: number;
}

/** A JSON value's field as a whole number that is not negative. */
function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${what} is not a whole number`);
  }
  return value;
}

/**
 * A JSON value's features: the words its list holds. An entry of another kind
 * is a later release's way of naming a feature, which this build does not
 * take, and is passed over, so the list can grow.
 */
function features(value: unknown, what: string): string[] {
  const listed = value ?? [];
  if (!Array.isArray(listed)) throw new Error(`${what} are not a list`);
  return listed.filter((feature): feature is string => typeof feature === 'string');
}

/** A JSON text as an object. */
function object(json: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`${what} is not JSON`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} is not a JSON object`);
  return value as Record<string, unknown>;
}

/** A JSON value as resources. */
function resources(value: unknown, what: string): RackResources {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} is not a JSON object`);
  const fields = value as Record<string, unknown>;
  return {
    cores: count(fields.cores, `${what}.cores`),
    memoryBytes: count(fields.memoryBytes, `${what}.memoryBytes`),
    gpus: count(fields.gpus, `${what}.gpus`),
  };
}

/**
 * Reads a heartbeat's report.
 *
 * @param json - The report, as the heartbeat carries it
 * @returns The report, with the fields this build knows, and the features
 *   that are words
 * @throws {Error} When it is not a JSON object, or a field this build reads is
 *   of the wrong kind
 *
 * @example
 * ```ts
 * const report = readRackReport('{"features":["resources"],"resources":{"cores":8,"memoryBytes":17179869184,"gpus":0}}');
 * ```
 */
export function readRackReport(json: string): RackReport {
  const fields = object(json, 'the report');
  if (fields.target !== undefined && (typeof fields.target !== 'string' || fields.target === '')) throw new Error('the report\'s target is not a platform\'s name');
  return {
    features: features(fields.features, 'the report\'s features'),
    ...(fields.target !== undefined && { target: fields.target }),
    ...(fields.tiers !== undefined && { tiers: tiers(fields.tiers) }),
    ...(fields.resources !== undefined && { resources: resources(fields.resources, 'the report\'s resources') }),
    ...(fields.free !== undefined && { free: resources(fields.free, 'the report\'s free resources') }),
    ...hubScopeOf(fields.hubScope),
  };
}

/** A report's `hubScope`, read leniently: what is beside the work, so one of
 *  another form is none, and the heartbeat is never refused for it. */
function hubScopeOf(value: unknown): { hubScope?: RackReportedHubScope } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const { store, idleMs } = value as Record<string, unknown>;
  if (!isRackScopeId(store) || typeof idleMs !== 'number' || !Number.isSafeInteger(idleMs) || idleMs <= 0) return {};
  return { hubScope: { store, idleMs } };
}

/** A JSON value as a report's tiers. */
function tiers(value: unknown): Record<string, RackReportedTier> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('the report\'s tiers are not a JSON object');
  const read: Record<string, RackReportedTier> = {};
  for (const [tier, said] of Object.entries(value as Record<string, unknown>)) {
    const { digest, manifest } = (typeof said === 'object' && said !== null ? said : {}) as Record<string, unknown>;
    if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`the report's tier '${tier}' names no manifest digest`);
    if (manifest !== undefined && typeof manifest !== 'string') throw new Error(`the report's tier '${tier}' gives a manifest that is not text`);
    read[tier] = { digest, ...(manifest !== undefined && { manifest }) };
  }
  return read;
}

/**
 * Reads a poll's offer.
 *
 * @param json - The offer, as the poll carries it
 * @returns The offer
 * @throws {Error} When it is not a JSON object of cores, memory and GPUs
 *
 * @example
 * ```ts
 * const offer = readRackOffer('{"cores":1,"memoryBytes":4294967296,"gpus":0}');
 * ```
 */
export function readRackOffer(json: string): RackOffer {
  return resources(object(json, 'the offer'), 'the offer');
}

/**
 * Reads a source's hello.
 *
 * @param json - The hello's body
 * @returns The hello; a source that states no limit serves
 *   {@link RACK_TRANSFERS_AT_ONCE} transfers at once, one that names no
 *   feature takes none, and an entry of its features that is no word is
 *   passed over; of its data origins, the first
 *   {@link RACK_DATA_ORIGINS_MAX} that are HTTP(S) origins, each as its
 *   origin, and none unless it names {@link RACK_DATA_ORIGINS}: a hello that
 *   lists none has no `dataOrigins`
 * @throws {Error} When it is not a JSON object that names a protocol and an e3
 *   release, or its features are not a list
 *
 * @example
 * ```ts
 * const hello = readRackHello(await (await fetch(`${origin}/api/rack/hello`)).text());
 * if (hello.protocol !== RACK_PROTOCOL) throw new Error(`the source speaks rack protocol ${hello.protocol}`);
 * ```
 */
export function readRackHello(json: string): RackHello {
  const fields = object(json, 'the hello');
  if (typeof fields.e3 !== 'string' || fields.e3 === '') throw new Error('the hello names no e3 release');
  const limits = typeof fields.limits === 'object' && fields.limits !== null ? fields.limits as Record<string, unknown> : {};
  const transfers = limits.transfersAtOnce === undefined ? RACK_TRANSFERS_AT_ONCE : count(limits.transfersAtOnce, 'the hello\'s transfersAtOnce');
  if (transfers < 1) throw new Error('the hello\'s transfersAtOnce is not at least one');
  const named = features(fields.features, 'the hello\'s features');
  const dataOrigins = named.includes(RACK_DATA_ORIGINS) ? origins(fields.dataOrigins) : [];
  return { protocol: count(fields.protocol, 'the hello\'s protocol'), e3: fields.e3, limits: { transfersAtOnce: transfers }, features: named,
    ...(dataOrigins.length > 0 && { dataOrigins }) };
}

/**
 * A JSON value's origins: the first {@link RACK_DATA_ORIGINS_MAX} of its
 * entries that are HTTP(S) origins with no credentials, path or query, each as
 * its origin; an entry of another kind is passed over, as a feature is.
 */
function origins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const read: string[] = [];
  for (const entry of value) {
    if (read.length >= RACK_DATA_ORIGINS_MAX) break;
    if (typeof entry !== 'string') continue;
    let url: URL;
    try { url = new URL(entry); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') continue;
    if (!read.includes(url.origin)) read.push(url.origin);
  }
  return read;
}

/**
 * Reads a refusal's body, as far as it can be read: a source's reverse proxy
 * may answer in its own words.
 *
 * @param text - The body
 * @returns The refusal, or null when the body is not one
 *
 * @example
 * ```ts
 * const refusal = readRackRefusal(await response.text());
 * if (refusal?.code === 'busy') await delay(refusal.retryAfterMs ?? 1000);
 * ```
 */
export function readRackRefusal(text: string): RackRefusal | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const error = typeof value === 'object' && value !== null ? (value as { error?: unknown }).error : undefined;
  if (typeof error !== 'object' || error === null) return null;
  const { code, message, retryAfterMs } = error as Record<string, unknown>;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return {
    code, message,
    ...(typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0 && { retryAfterMs }),
  };
}
