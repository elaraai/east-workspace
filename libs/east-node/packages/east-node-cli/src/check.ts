/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { East, locationsFromStack, normalizeFramePath, type Location } from '@elaraai/east';

/**
 * `east-node check` (#686): the BUILD's own errors, at edit time — the
 * TypeScript twin of `east-py check`.
 *
 * `tsc` type-checks the TypeScript around an East program; it does not build
 * the program. East's own refusals — a body whose expression type differs from
 * the declared output, a capture the builder rejects, an IR the analyzer
 * rejects — happen when `East.function` runs at module load, and nothing
 * surfaces them until something imports the module. This does.
 *
 * The builders are WRAPPED for the duration rather than changed: `East` is a
 * plain object, so a checker can decorate `East.function` / `East.asyncFunction`
 * around one import and put them back afterwards. That keeps a development
 * tool out of the language runtime — no collect-mode in the core builder, and
 * nothing for a normal build to pay or trip over.
 *
 * The `East` that gets wrapped is the one the CHECKED MODULE resolves, not this
 * CLI's: a globally installed `east-node`, or any layout where the peer is not
 * linked, gives the module its own copy of `@elaraai/east`, and decorating the
 * checker's copy would leave every build in the module unwrapped — the first
 * failure escaping as one `import` finding instead of every `build` finding.
 */

// This module's own normalized path. `locationsFromStack` drops East's frames,
// node internals and installed packages, but the CHECKER's own wrapper is none
// of those — without this the reported line is the wrapper's, not the author's.
// BOTH spellings are needed: under `--enable-source-maps` (which this package's
// own test script uses, and which anyone debugging will) `Error.stack` carries the
// TypeScript path a compiled frame maps back to, not the `dist` path this module
// was loaded from. Matching only the loaded path silently let the wrapper's own
// frame through, and every finding was reported against `check.ts`.
const SELF_PATHS: readonly string[] = (() => {
    const loaded = normalizeFramePath(fileURLToPath(import.meta.url));
    const source = loaded.replace(/(^|\/)dist\//, '$1src/').replace(/\.js$/, '.ts');
    return source === loaded ? [loaded] : [loaded, source];
})();

// A strictly increasing cache-buster. `Date.now()` alone has millisecond
// resolution, so two checks inside the same millisecond resolve to the SAME
// specifier and the second gets the module ESM already has — no rebuild, no
// findings, silently. That is wrong in a test and worse in a warm language
// server, where re-checks are exactly what happens fast.
let checkCounter = 0;

/** The author's frames, with the checker's own wrapper removed. */
function authorLocations(stack: string | undefined): Location[] {
    return locationsFromStack(stack).filter((l) => !SELF_PATHS.includes(String(l.filename)));
}

/** The shape of the `East` namespace a check decorates. */
interface EastNamespace {
    function: (...args: any[]) => any;
    asyncFunction: (...args: any[]) => any;
}

// The builders as they were BEFORE anything decorated them, captured the first
// time each `East` instance is seen. Restoring to these — rather than to
// whatever was installed when a check started — is what makes an accidental
// overlap recoverable.
const PRISTINE = new WeakMap<EastNamespace, { function: EastNamespace['function']; asyncFunction: EastNamespace['asyncFunction'] }>();
/** Whether a check currently has the builders decorated. */
let patching = false;

/**
 * The `East` namespace `modulePath` builds with: its own resolution of
 * `@elaraai/east`, or this CLI's when it has none (a module that does not
 * import East has nothing to check, and the import will say so).
 */
async function eastFor(modulePath: string): Promise<EastNamespace> {
    try {
        const resolved = createRequire(modulePath).resolve('@elaraai/east');
        const loaded = (await import(pathToFileURL(resolved).href)) as { East?: EastNamespace };
        if (loaded.East !== undefined) return loaded.East;
    } catch {
        /* not resolvable from there */
    }
    return East as unknown as EastNamespace;
}

/** The environment variable a module can read to skip its import-time work. */
export const GUARD = 'EAST_CHECK';

/**
 * One build failure — the record `east-py check --format json` emits, key for
 * key (hence the snake_case), so a consumer merges the two without a mapping.
 */
export interface BuildFinding {
    path: string;
    line: number;
    column: number;
    end_line: number;
    end_column: number;
    rule: string;
    code: string;
    category: 'error' | 'warning' | 'suggestion';
    message: string;
}

interface Collected {
    name: string;
    kind: string;
    message: string;
    locations: readonly Location[];
}

/** A stand-in for a function whose build failed, so the rest of the module loads. */
function placeholder(name: string, message: string): unknown {
    const fail = (): never => {
        throw new Error(`${name} failed to build: ${message}`);
    };
    return new Proxy(fail, {
        get: (target, key) => (key === 'name' ? name : Reflect.get(target, key)),
    });
}

/**
 * Import `modulePath` with the builders collecting, and report what failed.
 *
 * @param modulePath - The module to check (a path; built JavaScript, as the
 *                     other CLI commands take)
 * @returns The findings, in source order. A module that will not import at all
 *          yields one finding saying so — it cannot be checked until it does.
 */
export async function checkModule(modulePath: string): Promise<BuildFinding[]> {
    const absolute = resolve(modulePath);
    const collected: Collected[] = [];
    let depth = 0;

    if (patching) {
        throw new Error(
            'east-node check is already running in this process. It decorates the global ' +
            '`East.function` builders around one import, so a second overlapping call would ' +
            "restore the first call's wrappers permanently — after which every later build " +
            'would push into a dead collector instead of throwing. Run checks one at a time.',
        );
    }
    const east = await eastFor(absolute);
    let original = PRISTINE.get(east);
    if (original === undefined) {
        original = { function: east.function, asyncFunction: east.asyncFunction };
        PRISTINE.set(east, original);
    }
    patching = true;
    const wrap = (build: (...args: any[]) => any, entry: string) => (...args: any[]): any => {
        const top = depth++ === 0;
        try {
            return build(...args);
        } catch (error) {
            // A NESTED build's failure belongs to the enclosing build, which is
            // the expression the author can act on; recording both would report
            // one mistake twice.
            if (!top) throw error;
            const e = error as { message?: string; stack?: string; constructor?: { name?: string } };
            const name = (typeof args[2] === 'function' && args[2].name) || entry;
            collected.push({
                name,
                kind: e?.constructor?.name ?? 'Error',
                message: e?.message ?? String(error),
                locations: authorLocations(e?.stack),
            });
            return placeholder(name, e?.message ?? String(error));
        } finally {
            depth = Math.max(0, depth - 1);
        }
    };

    const previousGuard = process.env[GUARD];
    process.env[GUARD] = '1';
    east.function = wrap(original.function, 'East.function');
    east.asyncFunction = wrap(original.asyncFunction, 'East.asyncFunction');

    const findings: BuildFinding[] = [];
    try {
        // A cache-busting query keeps a re-check of the same module in a warm
        // process from returning the already-loaded copy without rebuilding
        // (see `checkCounter` — Date.now() alone is not unique enough).
        await import(`${pathToFileURL(absolute).href}?east-check=${Date.now()}-${checkCounter++}`);
    } catch (error) {
        findings.push(importFailure(error, absolute));
    } finally {
        // Restore the PRISTINE builders captured at module load, never whatever
        // happened to be installed on entry: restoring a wrapper is how a
        // second overlapping call would leave one installed for good.
        east.function = original.function;
        east.asyncFunction = original.asyncFunction;
        patching = false;
        if (previousGuard === undefined) delete process.env[GUARD];
        else process.env[GUARD] = previousGuard;
    }

    for (const error of collected) {
        const at = error.locations[0];
        findings.push({
            path: at ? String(at.filename) : absolute,
            line: at ? Number(at.line) : 1,
            column: at ? Math.max(Number(at.column), 1) : 1,
            end_line: at ? Number(at.line) : 1,
            end_column: (at ? Math.max(Number(at.column), 1) : 1) + 1,
            rule: 'build',
            code: 'EAS900',
            category: 'error',
            message: `${error.name}: ${error.message}`,
        });
    }
    findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
    return findings;
}

function importFailure(error: unknown, fallback: string): BuildFinding {
    const e = error as { message?: string; stack?: string; constructor?: { name?: string } };
    const at = authorLocations(e?.stack)[0];
    const line = at ? Number(at.line) : 1;
    const column = at ? Math.max(Number(at.column), 1) : 1;
    return {
        path: at ? String(at.filename) : fallback,
        line,
        column,
        end_line: line,
        end_column: column + 1,
        rule: 'import',
        code: 'EAS901',
        category: 'error',
        message: `${e?.constructor?.name ?? 'Error'}: ${e?.message ?? String(error)} — the module must ` +
            `import before its East functions can be checked (set ${GUARD} to skip import-time work)`,
    };
}

/** `file:line:col: category [rule] message` — the east-py check spelling. */
export function formatFinding(finding: BuildFinding): string {
    return `${finding.path}:${finding.line}:${finding.column}: ${finding.category} [${finding.rule}] ${finding.message}`;
}
