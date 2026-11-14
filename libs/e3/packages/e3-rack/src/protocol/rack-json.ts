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
 * What a source answers `GET /api/rack/hello` with, to anyone who can reach
 * it: the protocol it speaks, its e3 release, and its limits.
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
}

/**
 * What a rack is and has, sent with every heartbeat.
 */
export interface RackReport {
  /**
   * What the rack does beyond running a stock tier's work: `resources` (it
   * admits work by its cores and memory, and caps each piece of work at what
   * its lease says), `environments` (it composes a lease's environment from
   * layers).
   */
  readonly features: readonly string[];
  /** The platform environments are installed for, as e3-core names one
   *  (`x86_64-manylinux_2_28`): a rack that composes environments says it */
  readonly target?: string;
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
 * @returns The report, with the fields this build knows
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
  const features = fields.features ?? [];
  if (!Array.isArray(features) || features.some((feature) => typeof feature !== 'string')) throw new Error('the report\'s features are not strings');
  if (fields.target !== undefined && (typeof fields.target !== 'string' || fields.target === '')) throw new Error('the report\'s target is not a platform\'s name');
  return {
    features: features as string[],
    ...(fields.target !== undefined && { target: fields.target }),
    ...(fields.resources !== undefined && { resources: resources(fields.resources, 'the report\'s resources') }),
    ...(fields.free !== undefined && { free: resources(fields.free, 'the report\'s free resources') }),
  };
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
 *   {@link RACK_TRANSFERS_AT_ONCE} transfers at once
 * @throws {Error} When it is not a JSON object that names a protocol and an e3
 *   release
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
  return { protocol: count(fields.protocol, 'the hello\'s protocol'), e3: fields.e3, limits: { transfersAtOnce: transfers } };
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
