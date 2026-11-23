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

/** The transfers a source serves one rack at once, unless it says otherwise. */
export const RACK_TRANSFERS_AT_ONCE = 8;

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
 * split task's execution wrote for its later leases, until its source says
 * the execution ended: a lease of a unit is then granted it with its scope
 * (`RackLeaseEvent.scope`), and the heartbeat's answer names the scopes that
 * ended ({@link RACK_SCOPES_ENDED_HEADER}). A rack that does not name it is
 * granted the same lease without one.
 */
export const RACK_SPLIT_SCOPES = 'split-scopes';

/**
 * The header of a heartbeat's answer that names the split scopes that ended
 * of those the rack was granted a lease of: a JSON array of their ids. Each is
 * named once, to a rack whose report names {@link RACK_SPLIT_SCOPES}; an
 * answer lost on its way is not sent again, so a rack bounds what it keeps of
 * a scope by its own time too.
 */
export const RACK_SCOPES_ENDED_HEADER = 'x-e3-rack-scopes-ended';

/**
 * Whether a text is a split scope's id, as a lease or a heartbeat's answer
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

/** The most scopes one heartbeat's answer names as ended; those past it go
 *  with the next. */
export const RACK_SCOPES_ENDED_MAX = 1024;

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
   * {@link RACK_TIER_MANIFESTS}. An agent uses a feature only with a source
   * that names it; a source that names none takes none.
   */
  readonly features: readonly string[];
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
   * {@link RACK_SPLIT_SCOPES} (it keeps a split task's outputs for its later
   * leases).
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
  };
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
 *   passed over
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
  return { protocol: count(fields.protocol, 'the hello\'s protocol'), e3: fields.e3, limits: { transfersAtOnce: transfers }, features: features(fields.features, 'the hello\'s features') };
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
