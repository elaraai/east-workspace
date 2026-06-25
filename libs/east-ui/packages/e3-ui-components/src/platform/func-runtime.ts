/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runtime implementation for the `Func.bind` platform function — calling
 * named package functions (`e3.function`) from East UI code, RPC-style.
 *
 * A tracked call is an un-awaited `FunctionApi.call` promise tagged with
 * the monotonic `launchSeq` it was issued under; whichever response still
 * holds the current seq writes the terminal state (latest-wins). There is
 * no server-side call state on the sync-only function surface — `cancel`
 * is client-side only (it bumps the seq, orphaning the in-flight wait).
 *
 * All handles bound to the same function name in the same workspace share
 * one registry entry, mirroring how `Data.bind` handles share the dataset
 * cache by path. Declared signatures are validated against the deployed
 * package's function list before any call is sent.
 *
 * State (registry, signature cache, tracking context) is encapsulated in
 * the {@link FuncRuntime} class. A process-global {@link defaultFuncRuntime}
 * powers the `FuncPlatform` export; tests construct their own runtime for
 * isolation.
 *
 * @packageDocumentation
 */

import {
    East,
    StructType,
    OptionType,
    BooleanType,
    NullType,
    StringType,
    fromEastTypeValue,
    type EastType,
    type EastTypeValue,
    type ValueTypeOf,
    encodeBeast2For,
    decodeBeast2For,
    equalFor,
    toEastTypeValue,
    variant,
} from "@elaraai/east";
import { type PlatformFunction, EastTypeType } from "@elaraai/east/internal";
import { funcBindPlatformFn, FuncBindPrimitives, FuncStatusType, FuncErrorType } from "@elaraai/e3-ui/internal";
import {
    workspaceFunctionList,
    workspaceFunctionCall,
    type ExecuteResult,
    type FunctionSignature,
} from "@elaraai/e3-api-client";
import {
    registerReactiveTracker,
    registerPlatformImplementation,
} from "@elaraai/east-ui-components/platform";
import { TrackedChannelStore } from "./tracked-channel.js";

// =============================================================================
// API seam — the narrow surface the runtime talks through. Tests stub it;
// the showcase harness swaps in an in-memory implementation.
// =============================================================================

/** Request shape for {@link FunctionApi.call} — beast2-encoded positional
 *  args. Runner/limit overrides are deliberately not exposed (the deployed
 *  function's runner is authoritative). */
export interface FunctionCallArgs {
    args: Uint8Array[];
}

/**
 * Adapter for the workspace function endpoints. The default wraps
 * `@elaraai/e3-api-client`'s `workspaceFunctionList` /
 * `workspaceFunctionCall`.
 */
export interface FunctionApi {
    /** List the workspace's deployed functions with their signatures. */
    list(workspace: string): Promise<FunctionSignature[]>;
    /** Call a function synchronously, returning its terminal ExecuteResult. */
    call(workspace: string, fn: string, req: FunctionCallArgs): Promise<ExecuteResult>;
}

/**
 * Build the default {@link FunctionApi} that talks to a real e3 server via
 * `@elaraai/e3-api-client`.
 */
export function createDefaultFunctionApi(
    apiUrl: string,
    repo: string,
    getToken: () => string | null,
): FunctionApi {
    const opts = (): { token: string | null } => ({ token: getToken() });
    return {
        async list(workspace) {
            return workspaceFunctionList(apiUrl, repo, workspace, opts());
        },
        async call(workspace, fn, req) {
            return workspaceFunctionCall(apiUrl, repo, workspace, fn, {
                args: req.args,
                runner: variant("none", null),
                limits: variant("none", null),
            }, opts());
        },
    };
}

// =============================================================================
// Value-level helpers
// =============================================================================

type FuncError = ValueTypeOf<FuncErrorType>;
type FuncStatusTag = "idle" | "running" | "succeeded" | "failed" | "cancelled";

const eastTypeEqual = equalFor(EastTypeType) as (a: EastTypeValue, b: EastTypeValue) => boolean;

/** A handle's signature, recovered from the instantiated handle type. */
interface FuncHandleSignature {
    readonly inputs: EastTypeValue[];
    readonly output: EastTypeValue;
}

/**
 * Introspect the instantiated handle struct type `H`: the input types come
 * from the `call` field's FunctionType, the output type from the `read`
 * field's `Option(Output)` return. The handle's shape IS the signature —
 * there are no duplicate signature arguments to drift out of sync.
 */
export function signatureOfFuncHandleType(handleType: EastTypeValue): FuncHandleSignature {
    if (handleType.type !== "Struct") {
        throw new Error(`Func.bind: handle type must be a Struct; got ${handleType.type}`);
    }
    const fields = handleType.value as { name: string; type: EastTypeValue }[];
    const call = fields.find(f => f.name === "call")?.type;
    const read = fields.find(f => f.name === "read")?.type;
    if (call?.type !== "Function" || read?.type !== "Function") {
        throw new Error("Func.bind: handle type is missing its call/read closures");
    }
    const inputs = (call.value as { inputs: EastTypeValue[] }).inputs;
    const readOut = (read.value as { output: EastTypeValue }).output;
    if (readOut.type !== "Variant") {
        throw new Error("Func.bind: read() must return Option(Output)");
    }
    const some = (readOut.value as { name: string; type: EastTypeValue }[]).find(a => a.name === "some");
    if (!some) {
        throw new Error("Func.bind: read() must return Option(Output)");
    }
    return { inputs, output: some.type };
}

/** Build a FuncError value from an ExecuteResult's non-success outcome. */
function errorOfExecuteResult(result: ExecuteResult): FuncError {
    const outcome = result.outcome;
    switch (outcome.type) {
        case "failed":
            return {
                kind: variant("failed", { exitCode: outcome.value.exitCode }),
                message: `runner exited with code ${outcome.value.exitCode}`,
                stdout: result.stdout,
                stderr: result.stderr,
            };
        case "invalid": {
            const diagnostics = outcome.value.diagnostics.map(d => {
                const at = d.filename.type === "some"
                    ? ` (${d.filename.value}${d.line.type === "some" ? `:${d.line.value}` : ""})`
                    : "";
                return `${d.message}${at}`;
            });
            return {
                kind: variant("invalid", { diagnostics }),
                message: diagnostics[0] ?? "invalid call",
                stdout: result.stdout,
                stderr: result.stderr,
            };
        }
        case "too_large":
            return {
                kind: variant("too_large", { bytes: outcome.value.bytes, limit: outcome.value.limit }),
                message: `result too large (${outcome.value.bytes} bytes, limit ${outcome.value.limit})`,
                stdout: result.stdout,
                stderr: result.stderr,
            };
        case "timed_out":
            return {
                kind: variant("timed_out", { ms: outcome.value.ms }),
                message: `call timed out after ${outcome.value.ms}ms (server deadline)`,
                stdout: result.stdout,
                stderr: result.stderr,
            };
        default:
            return transportError(`unexpected outcome "${outcome.type}"`);
    }
}

function transportError(message: string): FuncError {
    return {
        kind: variant("transport", { message }),
        message,
        stdout: "",
        stderr: "",
    };
}

// =============================================================================
// Runtime
// =============================================================================

/** One tracked channel per `(workspace, name)`. */
interface FuncEntry {
    status: FuncStatusTag;
    /** Monotonic; a settling call whose seq is no longer current is
     *  discarded (latest-wins, and `cancel` orphans by bumping it). */
    launchSeq: number;
    /** Decoded Output of the last `succeeded` call. */
    result?: unknown;
    /** Detail of the last `failed` call. */
    error?: FuncError;
}

/** Tracked-channel key. */
export function funcChannelKey(workspace: string, name: string): string {
    return `func:${workspace}:${name}`;
}

/**
 * Encapsulates all `Func.bind` runtime state. The module-level
 * {@link defaultFuncRuntime} instance backs the registered platform; tests
 * construct their own for isolation.
 */
export class FuncRuntime extends TrackedChannelStore<FuncEntry> {
    private api: FunctionApi | null = null;
    private workspace: string | null = null;

    // Signature lists are fetched once per workspace and cached.
    private signatureLists = new Map<string, Promise<FunctionSignature[]>>();

    // Compiled-handle cache (issue #106 perf): buildHandle compiles 6 East.functions
    // per bind, and binds re-run every reactive frame. The method IR is a pure
    // function of the function name (which fixes the handle type), and the methods
    // resolve workspace/api LIVE, so a cached handle still re-binds. Cleared on clear().
    private readonly handleCache = new Map<string, Record<string, unknown>>();

    protected createEntry(): FuncEntry {
        return { status: "idle", launchSeq: 0 };
    }

    // ----- wiring ----------------------------------------------------------

    /** Install the API adapter + workspace — called by the React provider
     *  (or a test/showcase harness) before any handle is used. */
    initialize(api: FunctionApi, workspace: string): void {
        this.api = api;
        this.workspace = workspace;
    }

    /** Tear down the adapter and all call state. */
    clear(): void {
        this.api = null;
        this.workspace = null;
        this.clearChannels();
        this.signatureLists.clear();
        this.handleCache.clear();
    }

    /** The deployed signature list for a workspace (fetched once). */
    private signatures(workspace: string): Promise<FunctionSignature[]> {
        let promise = this.signatureLists.get(workspace);
        if (!promise) {
            const api = this.api;
            if (!api) return Promise.reject(new Error("Func.bind: no FunctionApi installed"));
            promise = api.list(workspace).catch(err => {
                // Don't cache failures — the next call retries the list.
                this.signatureLists.delete(workspace);
                throw err;
            });
            this.signatureLists.set(workspace, promise);
        }
        return promise;
    }

    /** Validate a declared signature against the deployed list. Returns a
     *  FuncError when the name is unknown or the signature disagrees. */
    private async validate(workspace: string, name: string, sig: FuncHandleSignature): Promise<FuncError | null> {
        let list: FunctionSignature[];
        try {
            list = await this.signatures(workspace);
        } catch (err) {
            return transportError(`failed to list workspace functions: ${err instanceof Error ? err.message : String(err)}`);
        }
        const deployed = list.find(f => f.name === name);
        if (!deployed) {
            return {
                kind: variant("invalid", { diagnostics: [`no function "${name}" in the deployed package`] }),
                message: `no function "${name}" in the deployed package`,
                stdout: "",
                stderr: "",
            };
        }
        const inputsMatch = deployed.inputTypes.length === sig.inputs.length
            && deployed.inputTypes.every((t, i) => eastTypeEqual(t as EastTypeValue, sig.inputs[i]!));
        const outputMatches = eastTypeEqual(deployed.outputType as EastTypeValue, sig.output);
        if (!inputsMatch || !outputMatches) {
            const message = `signature mismatch for "${name}": bound (${sig.inputs.length} inputs) disagrees with the deployed package`;
            return {
                kind: variant("invalid", { diagnostics: [message] }),
                message,
                stdout: "",
                stderr: "",
            };
        }
        return null;
    }

    // ----- closure semantics -------------------------------------------------

    private launch(workspace: string, name: string, sig: FuncHandleSignature, args: unknown[]): void {
        const key = funcChannelKey(workspace, name);
        const { settle } = this.beginLaunch(key);

        void (async () => {
            const invalid = await this.validate(workspace, name, sig);
            if (invalid) {
                settle(e => { e.status = "failed"; e.error = invalid; });
                return;
            }
            const api = this.api;
            if (!api) {
                settle(e => { e.status = "failed"; e.error = transportError("no FunctionApi installed"); });
                return;
            }
            let result: ExecuteResult;
            try {
                const encoded = args.map((arg, i) => encodeBeast2For(sig.inputs[i]!)(arg));
                result = await api.call(workspace, name, { args: encoded });
            } catch (err) {
                settle(e => {
                    e.status = "failed";
                    e.error = transportError(err instanceof Error ? err.message : String(err));
                });
                return;
            }
            if (result.outcome.type === "success") {
                let decoded: unknown;
                try {
                    decoded = decodeBeast2For(sig.output)(result.outcome.value.value);
                } catch (err) {
                    settle(e => {
                        e.status = "failed";
                        e.error = transportError(`failed to decode result: ${err instanceof Error ? err.message : String(err)}`);
                    });
                    return;
                }
                settle(e => { e.status = "succeeded"; e.result = decoded; delete e.error; });
            } else {
                const error = errorOfExecuteResult(result);
                settle(e => { e.status = "failed"; e.error = error; });
            }
        })();
    }

    /**
     * The 6 low-level primitives backing handle methods, bound to THIS runtime.
     * Registered globally (extension registry) and included by the scoped
     * platform (e3 `ui()` tasks) so a decoded handle re-binds to whatever runtime
     * resolves the primitives on the decode side. The host effects (launch /
     * channel reads + reactive tracking) live here, keyed only on the plain-data
     * function name; the output type rides as a type-arg.
     */
    buildPrimitives(): PlatformFunction[] {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const runtime = this;
        const resolveWorkspace = (): string => {
            if (!runtime.workspace) {
                throw new Error("Func.bind: no workspace configured — mount a provider (or call initializeFunctionApi) first");
            }
            return runtime.workspace;
        };
        const channel = (name: string): { key: string; entry: FuncEntry } => {
            const key = funcChannelKey(resolveWorkspace(), name);
            return { key, entry: runtime.entry(key) };
        };
        return [
            // call: recover per-arg input types from the ArgsStruct type-arg + the
            // values from the passed struct (field order), and the output type from O.
            FuncBindPrimitives.call.implement((argsStructType: EastTypeValue, outputType: EastTypeValue) =>
                (nameArg: unknown, argsStruct: unknown) => {
                    const fields = (argsStructType as { value: { name: string; type: EastTypeValue }[] }).value;
                    const obj = argsStruct as Record<string, unknown>;
                    const inputs = fields.map(f => f.type);
                    const args = fields.map(f => obj[f.name]);
                    runtime.launch(resolveWorkspace(), nameArg as string, { inputs, output: outputType }, args);
                    return null;
                }),
            FuncBindPrimitives.read.implement((_outputType: EastTypeValue) => (nameArg: unknown) => {
                const { key, entry } = channel(nameArg as string);
                runtime.track(key);
                return entry.result !== undefined ? variant("some", entry.result) : variant("none", null);
            }),
            FuncBindPrimitives.status.implement((nameArg: unknown) => {
                const { key, entry } = channel(nameArg as string);
                runtime.track(key);
                return variant(entry.status, null);
            }),
            FuncBindPrimitives.error.implement((nameArg: unknown) => {
                const { key, entry } = channel(nameArg as string);
                runtime.track(key);
                return entry.status === "failed" && entry.error !== undefined
                    ? variant("some", entry.error)
                    : variant("none", null);
            }),
            FuncBindPrimitives.pending.implement((nameArg: unknown) => {
                const { key, entry } = channel(nameArg as string);
                runtime.track(key);
                return entry.status === "running";
            }),
            FuncBindPrimitives.cancel.implement((nameArg: unknown) => {
                const { key } = channel(nameArg as string);
                runtime.cancelChannel(key);
                return null;
            }),
        ];
    }

    /**
     * Build the handle value for one `Func.bind` evaluation. The methods are
     * thin IR-bearing `East.function`s over {@link buildPrimitives}, capturing
     * only the function name (and the signature types via type-args) — so the
     * handle is ordinary serializable East data (issue #106).
     */
    buildHandle(handleType: EastTypeValue, name: string): Record<string, unknown> {
        // Compiled-handle cache (issue #106 perf): the name fixes the signature, so
        // the 6 method IRs are identical across renders; methods resolve api/ws live.
        const cached = this.handleCache.get(name);
        if (cached) return cached;

        const sig = signatureOfFuncHandleType(handleType);
        const inputsEast = sig.inputs.map(t => fromEastTypeValue(t));
        const outputEast = fromEastTypeValue(sig.output);
        // Bundle the N positional call-args into one struct so a single
        // fixed-arity primitive can carry them (call is otherwise variadic).
        const ArgsStruct = StructType(Object.fromEntries(inputsEast.map((t, i) => [`arg${i}`, t])));
        const nameExpr = East.value(name, StringType);
        const platform = this.buildPrimitives();
        const { call, read, status, error, pending, cancel } = FuncBindPrimitives;

        const handle: Record<string, unknown> = {
            call: East.compile(East.function(inputsEast, NullType, ($, ...args) => {
                const obj: Record<string, unknown> = {};
                args.forEach((a, i) => { obj[`arg${i}`] = a; });
                $.return(call([ArgsStruct, outputEast], nameExpr, East.value(obj as never, ArgsStruct)));
            }), platform),
            read: East.compile(East.function([], OptionType(outputEast), ($) => {
                $.return(read([outputEast], nameExpr));
            }), platform),
            status: East.compile(East.function([], FuncStatusType, ($) => {
                $.return(status(nameExpr));
            }), platform),
            error: East.compile(East.function([], OptionType(FuncErrorType), ($) => {
                $.return(error(nameExpr));
            }), platform),
            pending: East.compile(East.function([], BooleanType, ($) => {
                $.return(pending(nameExpr));
            }), platform),
            cancel: East.compile(East.function([], NullType, ($) => {
                $.return(cancel(nameExpr));
            }), platform),
            binding: { name },
        };
        this.handleCache.set(name, handle);
        return handle;
    }

    // ----- platform building -------------------------------------------------

    /** Build a `Func.bind` PlatformFunction bound to this runtime. Pass
     *  `allowed=null` for an unscoped impl; pass a Set of function names
     *  for manifest scoping. */
    buildPlatform(allowed: ReadonlySet<string> | null): PlatformFunction {
        return funcBindPlatformFn.implement((handleType: EastTypeValue) =>
            (nameArg: unknown) => {
                const name = nameArg as string;
                if (allowed && !allowed.has(name)) {
                    throw new Error(
                        `Func.bind: function "${name}" is not in this UI task's manifest — ` +
                        `bind it in the task body so derivation records it`,
                    );
                }
                return this.buildHandle(handleType, name);
            },
        );
    }
}

// =============================================================================
// Default process-global runtime + free-function exports.
// =============================================================================

/** Process-global runtime backing the `FuncPlatform` export. */
export const defaultFuncRuntime = new FuncRuntime();

/** Install the function API adapter + workspace — called by the React
 *  provider on mount (or by a test/showcase harness). */
export function initializeFunctionApi(api: FunctionApi, workspace: string): void {
    defaultFuncRuntime.initialize(api, workspace);
}

/** Tear down the function API adapter and all call state. */
export function clearFunctionApi(): void {
    defaultFuncRuntime.clear();
}

/** Global, manifest-unscoped `Func.bind` impl + its backing primitives.
 *  Registered on module load (powers the extension registry decode path). */
export const FuncPlatform: PlatformFunction[] = [
    defaultFuncRuntime.buildPlatform(null),
    ...defaultFuncRuntime.buildPrimitives(),
];

/** Build a manifest-scoped `Func.bind` implementation + its backing primitives.
 *
 *  The `function_*` primitives MUST ship with the scoped platform: e3 `ui()`
 *  tasks render through `createScoped*()` arrays (UITaskPreview), NOT the global
 *  registry, so a serialized handle's methods would otherwise decode to
 *  "Platform function 'function_call' is not available". */
export function createScopedFuncPlatform(functions: readonly string[]): PlatformFunction[] {
    return [
        defaultFuncRuntime.buildPlatform(new Set(functions)),
        ...defaultFuncRuntime.buildPrimitives(),
    ];
}

// =============================================================================
// In-memory FunctionApi — offline harnesses (showcase, snapshots, tests)
// register deterministic implementations keyed by name; `call` round-trips
// arguments and results through the same beast2 codecs a real server uses.
// =============================================================================

/** One offline function implementation for {@link createInMemoryFunctionApi}. */
export interface InMemoryFunctionDef {
    /** Function name (what `Func.bind` is bound to). */
    name: string;
    /** Positional parameter types. */
    inputTypes: (EastType | EastTypeValue)[];
    /** Return type. */
    outputType: EastType | EastTypeValue;
    /** The implementation — receives decoded args, returns the result
     *  value (or a promise of it). */
    fn: (...args: unknown[]) => unknown;
}

/**
 * Build an offline {@link FunctionApi} from local implementations — the
 * showcase/snapshot harnesses' stand-in for a deployed package.
 */
export function createInMemoryFunctionApi(functions: InMemoryFunctionDef[]): FunctionApi {
    const defs = functions.map(def => ({
        name: def.name,
        inputTypes: def.inputTypes.map(t => toEastTypeValue(t as EastType)),
        outputType: toEastTypeValue(def.outputType as EastType),
        fn: def.fn,
    }));
    return {
        async list() {
            return defs.map(def => ({
                name: def.name,
                inputTypes: def.inputTypes,
                outputType: def.outputType,
                runner: variant("east_node", { platforms: [] }),
            })) as unknown as FunctionSignature[];
        },
        async call(_workspace, fnName, req) {
            const def = defs.find(d => d.name === fnName);
            if (!def) throw new Error(`no in-memory function "${fnName}"`);
            const args = req.args.map((bytes, i) => decodeBeast2For(def.inputTypes[i]!)(bytes));
            const value = await def.fn(...args);
            return {
                outcome: variant("success", { value: encodeBeast2For(def.outputType)(value) }),
                stdout: "",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
            } as ExecuteResult;
        },
    };
}

// =============================================================================
// Module-load registrations — wire the default runtime into east-ui hooks.
// Tests with their own `FuncRuntime` don't use these.
// =============================================================================

registerReactiveTracker({
    id: "func-bind",
    enableTracking: () => defaultFuncRuntime.enableTracking(),
    disableTracking: () => defaultFuncRuntime.disableTracking(),
    getStore: () => ({
        subscribe: (key, cb) => defaultFuncRuntime.subscribe(key, cb),
        getKeyVersion: (key) => defaultFuncRuntime.getKeyVersion(key),
    }),
});

registerPlatformImplementation(FuncPlatform);
