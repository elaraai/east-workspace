/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * IR-level renderability detection (#225): decide what an export IS from its
 * East IR, never by duck-typed try-render-and-see.
 *
 * A render candidate is a **zero-input** East function whose declared output
 * type is a subtype of `UIComponentType`, established with east's own type
 * machinery (`isSubtypeValue` / `toEastTypeValue`). The function body is then
 * walked (`walkIR`) for platform calls: workspace-backed calls (`data_*`,
 * `func_*`, `record_*` — reads that need a deployed e3 workspace) make the
 * export NOT standalone-renderable, while browser-local platforms (`state_*`,
 * nav, overlays, …) render at initial state.
 *
 * Both `@elaraai/east` and `@elaraai/east-ui` are resolved **from the target
 * project** (the swept source file), not from this CLI: the loaded module
 * already runs against the project's own east instance (see
 * `load-source.ts`'s externalize plugin), so the IR, the type values, and the
 * comparison machinery all share one origin. Structural type comparison makes
 * this safe even across duplicated east installs.
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import { shapeOfExport, type EastFunctionLike, type ExportShape } from './load-source.js';

/** Why an export is not standalone-renderable. Every skip carries its typed
 *  reason so a sweep is an audit, not a best-effort scrape. */
export type SkipReason =
    | { kind: 'not-a-component'; detail: string }
    | { kind: 'has-inputs'; count: number }
    | { kind: 'wrong-output'; output: string }
    | { kind: 'parameterized-ui-task' }
    | { kind: 'workspace-bound'; platforms: string[] }
    | { kind: 'ir-error'; detail: string };

/** One export's verdict. `renderable` exports carry their East function. */
export interface ExportClassification {
    name: string;
    shape: ExportShape | null;
    renderable: boolean;
    skip?: SkipReason;
    fn?: EastFunctionLike;
}

/** Render a {@link SkipReason} as one human line (shared by sweep + shot). */
export function describeSkip(skip: SkipReason): string {
    switch (skip.kind) {
        case 'not-a-component': return skip.detail;
        case 'has-inputs': return `takes ${skip.count} input(s) — only zero-input functions render standalone`;
        case 'wrong-output': return `output type is ${skip.output}, not UIComponentType`;
        case 'parameterized-ui-task': return 'a ui() task with compute-time inputs — render it from a deployed workspace: e3-ui shot --from-task <ws.task> --repo <path>';
        case 'workspace-bound': return `reads e3 workspace data (${skip.platforms.join(', ')}) — use --from-task against a deployed repo`;
        case 'ir-error': return `could not analyze IR: ${skip.detail}`;
    }
}

/** e3-ui platform-name prefixes that require a live e3 workspace. Everything
 *  else (`state_*`, `nav_*`, overlay/slice/clipboard/…) is browser-local and
 *  renders standalone at initial state. */
const WORKSPACE_PLATFORM_PREFIXES = ['data_', 'func_', 'record_'];

/** The subset of the project's east API the detector uses. */
interface EastModule {
    walkIR(ir: unknown, visit: (node: unknown, ctx: unknown) => void): void;
    isSubtypeValue(t1: unknown, t2: unknown): boolean;
    toEastTypeValue(type: unknown): unknown;
}

/** The project-resolved detection context: east's machinery + the project's
 *  `UIComponentType` (as an `EastTypeValue`). `uiComponentTypeValue` is null
 *  when the project does not depend on `@elaraai/east-ui` — then nothing can
 *  be a UI component by construction. */
export interface DetectContext {
    east: EastModule;
    uiComponentTypeValue: unknown | null;
}

/** Import a package **from the target project's resolution scope** (the same
 *  single-instance trick `load-source.ts` plays for the loaded module). */
async function importFromProject(sourceFile: string, spec: string): Promise<Record<string, unknown> | null> {
    try {
        const req = createRequire(path.resolve(sourceFile));
        const resolved = req.resolve(spec);
        return await import(pathToFileURL(resolved).href) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * Build the detection context for a source file, resolving `@elaraai/east` and
 * `@elaraai/east-ui` from the project.
 *
 * @param sourceFile - A file inside the target project (resolution anchor)
 * @returns The context, or null when the project has no resolvable `@elaraai/east`
 */
export async function detectContextFor(sourceFile: string): Promise<DetectContext | null> {
    const east = await importFromProject(sourceFile, '@elaraai/east');
    if (east === null) return null;
    const eastUi = await importFromProject(sourceFile, '@elaraai/east-ui');
    const uiComponentType = eastUi?.['UIComponentType'];
    const eastModule = east as unknown as EastModule;
    return {
        east: eastModule,
        uiComponentTypeValue: uiComponentType === undefined ? null : eastModule.toEastTypeValue(uiComponentType),
    };
}

/** The `Function` IR node's payload, extracted defensively (IR nodes are East
 *  variant containers: `{ type: tag, value }`). */
function functionIrPayload(ir: unknown): { parameters: unknown[]; typeValue: unknown } | null {
    if (typeof ir !== 'object' || ir === null) return null;
    const node = ir as { type?: unknown; value?: unknown };
    if (node.type !== 'Function') return null;
    const value = node.value as { parameters?: unknown; type?: unknown } | undefined;
    if (value === undefined || !Array.isArray(value.parameters)) return null;
    return { parameters: value.parameters, typeValue: value.type };
}

/** The declared output `EastTypeValue` of a `Function` IR's `FunctionType`. */
function outputTypeValue(fnTypeValue: unknown): unknown {
    if (typeof fnTypeValue !== 'object' || fnTypeValue === null) return undefined;
    const t = fnTypeValue as { type?: unknown; value?: unknown };
    if (t.type !== 'Function') return undefined;
    return (t.value as { output?: unknown } | undefined)?.output;
}

/** A short printable name for an `EastTypeValue` (its variant tag). */
function typeTag(typeValue: unknown): string {
    if (typeof typeValue === 'string') return typeValue;
    if (typeof typeValue === 'object' && typeValue !== null) {
        const tag = (typeValue as { type?: unknown }).type;
        if (typeof tag === 'string') return tag;
    }
    return 'unknown';
}

/** Collect the platform-call names in a function IR via the project's `walkIR`. */
function platformCallNames(east: EastModule, ir: unknown): string[] {
    const names = new Set<string>();
    east.walkIR(ir, (node) => {
        const n = node as { type?: unknown; value?: unknown };
        if (n.type === 'Platform') {
            const name = (n.value as { name?: unknown } | undefined)?.name;
            if (typeof name === 'string') names.add(name);
        }
    });
    return [...names].sort();
}

/**
 * Classify ONE export value: shape, renderability, and (when renderable) its
 * East function.
 *
 * @param name - The export name (for reporting)
 * @param value - The exported value
 * @param ctx - The project-resolved detection context
 * @returns The classification (never throws — IR problems become `ir-error` skips)
 */
export function classifyExport(name: string, value: unknown, ctx: DetectContext): ExportClassification {
    const shaped = shapeOfExport(value);
    if (shaped === null) {
        return { name, shape: null, renderable: false, skip: { kind: 'not-a-component', detail: 'not an East function, example(), or ui() task' } };
    }
    if (shaped.fn === null) {
        return { name, shape: shaped.shape, renderable: false, skip: { kind: 'parameterized-ui-task' } };
    }

    let ir: unknown;
    try {
        const bundle = shaped.fn.toIR() as { ir?: unknown };
        // `toIR()` yields an `EastIR` wrapper (its `.ir` is the Function node) —
        // except the ui() task unwrap, whose stored bundle IS the wrapper too.
        ir = typeof bundle === 'object' && bundle !== null && 'ir' in bundle ? bundle.ir : bundle;
    } catch (err) {
        return { name, shape: shaped.shape, renderable: false, skip: { kind: 'ir-error', detail: err instanceof Error ? err.message : String(err) } };
    }

    const fnIr = functionIrPayload(ir);
    if (fnIr === null) {
        return { name, shape: shaped.shape, renderable: false, skip: { kind: 'ir-error', detail: 'toIR() did not yield a (sync) Function IR' } };
    }
    if (fnIr.parameters.length > 0) {
        return { name, shape: shaped.shape, renderable: false, skip: { kind: 'has-inputs', count: fnIr.parameters.length } };
    }

    const output = outputTypeValue(fnIr.typeValue);
    if (ctx.uiComponentTypeValue === null) {
        return { name, shape: shaped.shape, renderable: false, skip: { kind: 'wrong-output', output: `${typeTag(output)} (and the project does not depend on @elaraai/east-ui)` } };
    }
    let isUi: boolean;
    try {
        isUi = output !== undefined && ctx.east.isSubtypeValue(output, ctx.uiComponentTypeValue);
    } catch (err) {
        return { name, shape: shaped.shape, renderable: false, skip: { kind: 'ir-error', detail: err instanceof Error ? err.message : String(err) } };
    }
    if (!isUi) {
        return { name, shape: shaped.shape, renderable: false, skip: { kind: 'wrong-output', output: typeTag(output) } };
    }

    const workspaceBound = platformCallNames(ctx.east, ir)
        .filter(n => WORKSPACE_PLATFORM_PREFIXES.some(p => n.startsWith(p)));
    if (workspaceBound.length > 0) {
        return { name, shape: shaped.shape, renderable: false, skip: { kind: 'workspace-bound', platforms: workspaceBound } };
    }

    return { name, shape: shaped.shape, renderable: true, fn: shaped.fn };
}

/**
 * Classify every export of a loaded module.
 *
 * @param moduleExports - The module's exports (from `loadSourceExports`)
 * @param ctx - The project-resolved detection context
 * @returns One classification per export, in export order
 */
export function classifyExports(moduleExports: Record<string, unknown>, ctx: DetectContext): ExportClassification[] {
    return Object.entries(moduleExports).map(([name, value]) => classifyExport(name, value, ctx));
}
