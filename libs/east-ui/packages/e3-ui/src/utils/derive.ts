/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Derive what a UI binds, and what it writes and calls, by walking an East
 * function's IR.
 *
 * `deriveManifest` finds every `Data.bind` / `Data.bindPaged` / `Func.bind` /
 * `Record.bind` platform call (the walker recurses into nested `FunctionIR`
 * bodies) and reads back its statically-known arguments: the dataset path +
 * optional patch path for `Data.bind`, the source path for `Data.bindPaged`,
 * the function name for `Func.bind`, the record name for `Record.bind`.
 *
 * Paged sources land in their own `pages` list rather than `paths`: they are
 * declared (so a `ui()` task's reads stay manifest-scoped) but deliberately not
 * preloaded or polled as whole values.
 *
 * `deriveUiAccess` reads what the UI writes and calls: the bound datasets it
 * may write, by what it does with each `Data.bind` handle, and for each record
 * it binds, the mutations it binds and the indexes it reads through. A host
 * checks a UI against a package with it before deploying the UI.
 *
 * Every such argument is required to be a JS-side constant — the public
 * factories enforce this through their TS signatures and `East.value`.
 * `constValueOf` reconstructs the JS value from that constant IR and throws if
 * it is a computed expression rather than a literal.
 *
 * @packageDocumentation
 */

import type { EastTypeValue, IR, OptionType, PlatformIR, StringType as StringTypeOf, ValueTypeOf, VariableIR } from '@elaraai/east';
import {
    ArrayType, EastTypeType, StringType, StructType, constValueOf, equalFor, none, variant, walkIR,
} from '@elaraai/east';
import { TreePathType, type TreePath } from '@elaraai/e3-types';
import type { DataBindModeType } from '../bind/data.js';
import type { DataManifest } from './manifest.js';

/** Platform-fn name we extract paths from. */
const DATA_BIND = "data_bind";

/** Platform-fn names we extract paged-source paths from: `Data.bindPaged`'s
 *  own, and the one a UI exported before pinned reads calls. */
const DATA_BIND_PAGED_PINNED = "data_bind_paged_pinned";
const DATA_BIND_PAGED = "data_bind_paged";

/** Platform-fn name we extract bound function names from. */
const FUNCTION_BIND = "function_bind";

/** Platform-fn name we extract bound record names from. */
const RECORD_BIND = "record_bind";

/** Walk `fn`'s IR and derive its bound-path manifest. */
export function deriveManifest(
    fn: { toIR(): { ir: IR } },
): DataManifest {
    const paths: TreePath[] = [];
    const functions: string[] = [];
    const records: string[] = [];
    const pages: TreePath[] = [];
    walkIR(fn.toIR().ir, (node) => {
        if (node.type !== 'Platform') return;
        const platform = node as PlatformIR;
        switch (platform.value.name) {
            case FUNCTION_BIND:
                functions.push(constValueOf(platform.value.arguments[0] as IR) as string);
                return;
            case RECORD_BIND: {
                // Bind the record's name, and preload its `.records.<name>`
                // path so the record's value is polled like any dataset.
                const name = constValueOf(platform.value.arguments[0] as IR) as string;
                records.push(name);
                paths.push([variant('field', 'records'), variant('field', name)]);
                return;
            }
            case DATA_BIND: {
                // arg[0] source TreePath; arg[1] patch option<TreePath>.
                paths.push(constValueOf(platform.value.arguments[0] as IR) as TreePath);
                const patch = constValueOf(platform.value.arguments[1] as IR) as ValueTypeOf<OptionType<TreePathType>>;
                if (patch.type === 'some') paths.push(patch.value);
                return;
            }
            case DATA_BIND_PAGED_PINNED:
            case DATA_BIND_PAGED: {
                // arg[0] source TreePath. Paged sources are read by window, so
                // they are declared here but never preloaded as whole values.
                pages.push(constValueOf(platform.value.arguments[0] as IR) as TreePath);
                return;
            }
        }
    });
    return {
        paths: dedupePaths(paths),
        functions: [...new Set(functions)],
        records: [...new Set(records)],
        pages: dedupePaths(pages),
    };
}

function dedupePaths(paths: TreePath[]): TreePath[] {
    const seen = new Set<string>();
    const result: TreePath[] = [];
    for (const p of paths) {
        const k = p.map(s => `${s.type}:${s.value}`).join('/');
        if (seen.has(k)) continue;
        seen.add(k);
        result.push(p);
    }
    return result;
}

// ============================================================================
// What a UI writes and calls
// ============================================================================

/** Platform-fn name of `Decision.bind`, which writes through the views it is
 *  given. */
const DECISION_BIND = "decision_bind";

/**
 * What a UI writes and calls, read from its IR before it deploys.
 *
 * @property writes - The bound datasets the UI may write, each once, in the
 *   order its bindings appear in its IR
 * @property records - Each record the UI binds or pages through, in the order
 *   its IR first names it: the mutations its `Record.bind` calls bind, each
 *   with the argument types it takes after the record's state, as a record's
 *   signature names them (`argTypes`), and the indexes its paged reads go
 *   through
 */
export const UiAccessType = StructType({
    writes: ArrayType(TreePathType),
    records: ArrayType(StructType({
        name: StringType,
        mutations: ArrayType(StructType({ name: StringType, argTypes: ArrayType(EastTypeType) })),
        indexes: ArrayType(StringType),
    })),
});
/** Type alias for {@link UiAccessType}. */
export type UiAccessType = typeof UiAccessType;
/** The decoded value of {@link UiAccessType}. */
export type UiAccess = ValueTypeOf<typeof UiAccessType>;

const pathEqual = equalFor(TreePathType);

/** The path every record's dataset lies under. */
const RECORDS: TreePath = [variant('field', 'records')];

/** A `Data.bind` handle's fields that only read: none writes a dataset. */
const HANDLE_READS: ReadonlySet<string> = new Set(["read", "source", "pending", "has", "status", "start"]);

/**
 * How a UI writes through a `Data.bind` handle: by its `write` (or
 * `writeAndStart`), its `commit` or its `discard`, or by handing the handle on
 * — to a component, a function, a value — where anything it allows may
 * follow.
 */
type HandleUse = "write" | "commit" | "discard" | "onward";

/** The handle's fields that write, by the use each makes. */
const HANDLE_WRITES: ReadonlyMap<string, HandleUse> = new Map<string, HandleUse>([
    ["write", "write"], ["writeAndStart", "write"], ["commit", "commit"], ["discard", "discard"],
]);

/** `Record.bind`'s mutate fields that follow its channel rather than name a
 *  mutation. */
const MUTATE_CONTROLS: ReadonlySet<string> = new Set(["pending", "status", "error", "cancel"]);

/** One `Data.bind` in a UI's IR: what it binds, and what the UI does with its
 *  handle. */
interface Binding {
    readonly source: TreePath;
    readonly patch: ValueTypeOf<OptionType<TreePathType>>;
    readonly staged: boolean;
    readonly uses: Set<HandleUse>;
}

/** The variables in scope where the walk is, each with the bindings whose
 *  handle it may hold. */
interface Scope {
    readonly names: Map<string, Set<Binding>>;
    readonly parent: Scope | null;
}

/**
 * Read what a UI writes and calls from its IR: the bound datasets it may
 * write, and for each record it binds, the mutations it binds and the indexes
 * it reads through.
 *
 * @remarks
 * A host runs it on a UI before deploying it, to check the UI against the
 * package: a dataset the UI writes must be writable, and a mutation it binds
 * must exist with its argument types. Nothing is stored for it: it reads the
 * IR as it stands, so a UI built here and one decoded off the wire read alike.
 *
 * A `Data.bind` writes by what the UI does with its handle, and by the
 * binding's mode and patch dataset:
 * - its `write` (or `writeAndStart`) writes a direct binding's source, or its
 *   patch dataset when it has one; a staged binding's only stages;
 * - its `commit` writes a staged binding's source, or its patch dataset when
 *   it has one, and applies a direct binding's patch dataset to its source,
 *   clearing it; its `discard` clears a direct binding's patch dataset;
 * - its `read`, `source`, `pending`, `has`, `status` and `start` write
 *   nothing, and nor does reading a field of its `binding`;
 * - `Decision.bind`, given its `binding`, writes through its `write`, as the
 *   decision handle does;
 * - handed on any other way — to a component, a function or a value, or its
 *   `binding` to a `<Diff>` — it may be used for anything it allows.
 *
 * A handle is followed through the variables that hold it, by name and scope
 * as East resolves them: within a scope chain no two variables share a name.
 * A record's mutations are the ones its `Record.bind` handle binds, whichever
 * the UI calls.
 *
 * @param ir - The UI's IR: its function's, as `fn.toIR().ir` gives it, or as
 *   decoded from a package
 * @returns What the UI writes, and of each record it binds, what it calls
 * @throws {Error} When a binding's path, mode, record name or index name is
 *   not a literal, as {@link deriveManifest} throws
 *
 * @example
 * ```ts
 * const access = deriveUiAccess(dashboard.toIR().ir);
 * for (const path of access.writes) {
 *   // the package must declare the dataset at `path` writable
 * }
 * ```
 */
export function deriveUiAccess(ir: IR): UiAccess {
    const bindings: Binding[] = [];
    const made = new Map<IR, Binding>();
    const records: { name: string; mutations: Map<string, EastTypeValue[]>; indexes: string[] }[] = [];

    const recordNamed = (name: string) => {
        let record = records.find((r) => r.name === name);
        if (record === undefined) {
            record = { name, mutations: new Map(), indexes: [] };
            records.push(record);
        }
        return record;
    };

    /** The binding a `data_bind` call makes, made once per call. */
    const bindingOf = (call: PlatformIR): Binding => {
        let binding = made.get(call);
        if (binding === undefined) {
            const [source, patch, mode] = call.value.arguments as IR[];
            binding = {
                source: constValueOf(source!) as TreePath,
                patch: constValueOf(patch!) as ValueTypeOf<OptionType<TreePathType>>,
                staged: (constValueOf(mode!) as ValueTypeOf<DataBindModeType>).type === "staged",
                uses: new Set(),
            };
            made.set(call, binding);
            bindings.push(binding);
        }
        return binding;
    };

    /** The bindings whose handle an expression's value may be: a `Data.bind`
     *  call, a variable holding one, or either cast; `null` for none. */
    const handlesOf = (node: IR, scope: Scope): Set<Binding> | null => {
        if (node.type === "Platform" && node.value.name === DATA_BIND) return new Set([bindingOf(node)]);
        if (node.type === "As") return handlesOf(node.value.value, scope);
        if (node.type === "Variable") {
            for (let s: Scope | null = scope; s !== null; s = s.parent) {
                const held = s.names.get(node.value.name);
                if (held !== undefined) return held.size === 0 ? null : held;
            }
        }
        return null;
    };

    const use = (held: ReadonlySet<Binding>, how: HandleUse): void => {
        for (const binding of held) binding.uses.add(how);
    };

    /** A scope inside `scope`, declaring `declared`, none holding a handle. */
    const inner = (scope: Scope, ...declared: VariableIR[]): Scope => ({
        names: new Map(declared.map((variable) => [variable.value.name, new Set<Binding>()])),
        parent: scope,
    });

    const walkPlatform = (call: PlatformIR, scope: Scope): void => {
        const args = call.value.arguments as IR[];
        switch (call.value.name) {
            case DATA_BIND:
                // A handle neither held nor read where it is made: handed on.
                use(new Set([bindingOf(call)]), "onward");
                return;
            case RECORD_BIND: {
                const record = recordNamed(constValueOf(args[0]!) as string);
                const handle = call.value.type_parameters[0];
                const mutate = handle?.type === "Struct"
                    ? (handle.value as { name: string; type: EastTypeValue }[]).find((field) => field.name === "mutate")?.type
                    : undefined;
                if (mutate?.type === "Struct") {
                    for (const { name, type } of mutate.value as { name: string; type: EastTypeValue }[]) {
                        if (!MUTATE_CONTROLS.has(name) && type.type === "Function" && !record.mutations.has(name)) {
                            record.mutations.set(name, type.value.inputs as EastTypeValue[]);
                        }
                    }
                }
                return;
            }
            case DATA_BIND_PAGED:
            case DATA_BIND_PAGED_PINNED: {
                const source = constValueOf(args[0]!) as TreePath;
                if (source.length === 2 && pathEqual(source.slice(0, 1), RECORDS)) {
                    const record = recordNamed(source[1]!.value);
                    const index = call.value.name === DATA_BIND_PAGED_PINNED
                        ? constValueOf(args[1]!) as ValueTypeOf<OptionType<StringTypeOf>>
                        : none;
                    if (index.type === "some" && !record.indexes.includes(index.value)) record.indexes.push(index.value);
                }
                return;
            }
            case DECISION_BIND: {
                // The decision handle writes each view, and the judgements,
                // through the view's own `write` (`DecisionBindPlatform`).
                const [views, judgements] = args;
                const through = (argument: IR): void => {
                    const held = argument.type === "GetField" && argument.value.field === "binding"
                        ? handlesOf(argument.value.struct, scope)
                        : null;
                    if (held !== null) use(held, "write");
                    else walk(argument, scope);
                };
                if (views!.type === "NewArray") {
                    for (const view of views!.value.values as IR[]) through(view);
                } else {
                    walk(views!, scope);
                }
                through(judgements!);
                return;
            }
            default:
                for (const argument of args) walk(argument, scope);
                return;
        }
    };

    const walk = (node: IR, scope: Scope): void => {
        switch (node.type) {
            case "Value":
            case "Continue":
            case "Break":
                return;
            case "Variable":
            case "As": {
                const held = handlesOf(node, scope);
                if (held !== null) use(held, "onward");
                else if (node.type === "As") walk(node.value.value, scope);
                return;
            }
            case "GetField": {
                const struct = node.value.struct as IR;
                const held = handlesOf(struct, scope);
                if (held !== null) {
                    if (!HANDLE_READS.has(node.value.field)) use(held, HANDLE_WRITES.get(node.value.field) ?? "onward");
                    return;
                }
                // A field of a handle's `binding`, read: the descriptor itself is
                // not handed on.
                if (struct.type === "GetField" && struct.value.field === "binding" && handlesOf(struct.value.struct, scope) !== null) return;
                walk(struct, scope);
                return;
            }
            case "Let": {
                const held = handlesOf(node.value.value, scope);
                if (held === null) walk(node.value.value, scope);
                scope.names.set(node.value.variable.value.name, new Set(held ?? []));
                return;
            }
            case "Assign": {
                const held = handlesOf(node.value.value, scope);
                if (held === null) {
                    walk(node.value.value, scope);
                    return;
                }
                // What the variable is used for afterwards is not traced back to
                // a handle assigned over another, so it may be used for anything.
                use(held, "onward");
                for (let s: Scope | null = scope; s !== null; s = s.parent) {
                    const holds = s.names.get(node.value.variable.value.name);
                    if (holds !== undefined) {
                        for (const binding of held) holds.add(binding);
                        break;
                    }
                }
                return;
            }
            case "Function":
            case "AsyncFunction":
                walk(node.value.body, inner(scope, ...node.value.parameters));
                return;
            case "Block": {
                const block = inner(scope);
                for (const statement of node.value.statements as IR[]) walk(statement, block);
                return;
            }
            case "IfElse":
                for (const branch of node.value.ifs) {
                    walk(branch.predicate, scope);
                    walk(branch.body, inner(scope));
                }
                walk(node.value.else_body, inner(scope));
                return;
            case "Match":
                walk(node.value.variant, scope);
                for (const arm of node.value.cases) walk(arm.body, inner(scope, arm.variable));
                return;
            case "While":
                walk(node.value.predicate, scope);
                walk(node.value.body, inner(scope));
                return;
            case "ForArray":
                walk(node.value.array, scope);
                walk(node.value.body, inner(scope, node.value.key, node.value.value));
                return;
            case "ForSet":
                walk(node.value.set, scope);
                walk(node.value.body, inner(scope, node.value.key));
                return;
            case "ForDict":
                walk(node.value.dict, scope);
                walk(node.value.body, inner(scope, node.value.key, node.value.value));
                return;
            case "TryCatch":
                walk(node.value.try_body, inner(scope));
                walk(node.value.catch_body, inner(scope, node.value.message, node.value.stack));
                walk(node.value.finally_body, inner(scope));
                return;
            case "Platform":
                walkPlatform(node, scope);
                return;
            case "Call":
            case "CallAsync":
                walk(node.value.function, scope);
                for (const argument of node.value.arguments as IR[]) walk(argument, scope);
                return;
            case "NewArray":
            case "NewSet":
            case "NewVector":
            case "NewMatrix":
                for (const value of node.value.values as IR[]) walk(value, scope);
                return;
            case "NewDict":
                for (const entry of node.value.values as { key: IR; value: IR }[]) {
                    walk(entry.key, scope);
                    walk(entry.value, scope);
                }
                return;
            case "Struct":
                for (const field of node.value.fields as { name: string; value: IR }[]) walk(field.value, scope);
                return;
            case "Builtin":
                for (const argument of node.value.arguments as IR[]) walk(argument, scope);
                return;
            case "Error":
                walk(node.value.message, scope);
                return;
            case "Variant":
            case "NewRef":
            case "UnwrapRecursive":
            case "WrapRecursive":
            case "Return":
                walk(node.value.value, scope);
                return;
            default:
                // Every kind of node is walked above: a new one fails the build
                // here rather than hide the writes beneath it.
                node satisfies never;
        }
    };

    walk(ir, { names: new Map(), parent: null });

    const writes: TreePath[] = [];
    const wrote = (path: TreePath): void => {
        if (!writes.some((written) => pathEqual(written, path))) writes.push(path);
    };
    for (const { source, patch, staged, uses } of bindings) {
        const any = (...hows: HandleUse[]): boolean => hows.some((how) => uses.has(how));
        if (patch.type === "none") {
            if (any(staged ? "commit" : "write", "onward")) wrote(source);
        } else if (staged) {
            if (any("commit", "onward")) wrote(patch.value);
        } else {
            if (any("write", "commit", "discard", "onward")) wrote(patch.value);
            if (any("commit", "onward")) wrote(source);
        }
    }
    return {
        writes,
        records: records.map(({ name, mutations, indexes }) => ({
            name,
            mutations: [...mutations].map(([mutation, argTypes]) => ({ name: mutation, argTypes })),
            indexes,
        })),
    };
}
