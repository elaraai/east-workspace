/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `ui()` — first-class UI task for e3.
 *
 * Wraps `e3.task()` in the `ui` role, whose data manifest is auto-derived
 * from the IR by inspecting `Data.bind` calls. Compute-time inputs (passed to
 * the fn by the runner) are also added to the manifest's reads.
 *
 * @packageDocumentation
 */

// `task` (a value) comes from the browser-safe `@elaraai/e3/browser` entry, not
// the main `@elaraai/e3` barrel — the latter re-exports Node-only file/zip IO
// (`sha256`/`export` → node:fs), which would otherwise leak into browser bundles
// that reach `ui()` via this package's main barrel (issue #99).
import { task, type DatasetDef, type Runner, type TaskDef } from '@elaraai/e3/browser';
import { UIComponentType } from '@elaraai/east-ui';
import {
  Expr,
  isSubtype,
  printTypeSummary,
  type EastType,
  type CallableFunctionExpr,
  type CallableAsyncFunctionExpr,
  variant,
} from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import { deriveManifest } from './utils/derive.js';

/**
 * Create a UI task — an e3 task that produces a UIComponentType value.
 *
 * Its function returns a UI component: `UIComponentType`, or a subtype of it,
 * which is what the task's preview renders. Any other output is refused here,
 * so no package deploys one.
 *
 * The task's manifest combines:
 * - **Compute-time reads** — every dataset in `inputs` (the runner passes
 *   their values to `fn` as positional args).
 * - **Reactive reads** — every `Data.bind(path).read()` / `.has()` call in
 *   the IR (paths derived by static analysis).
 * - **Reactive writes** — every `Data.bind(path).write()` call in the IR.
 *
 * Paths used in `Data.bind` must be JS-side constants captured at IR-build
 * time (typically `e3.input(name, T).path`). Dynamic paths throw.
 *
 * @param name - The task's name
 * @param inputs - The datasets the runner passes `fn`, in order
 * @param fn - Builds the UI component: returns `UIComponentType`, or a subtype
 *   of it
 * @param options - `runner`, which defaults to east-c with no platforms
 * @returns The task, whose output is the UI component
 * @throws {Error} When `fn` returns a type that is not `UIComponentType` or a
 *   subtype of it, naming the task and the type.
 *
 * @example
 * ```ts
 * import e3 from '@elaraai/e3';
 * import { ui, Data } from '@elaraai/e3-ui';
 * import { FloatType, East, variant } from '@elaraai/east';
 * import { Reactive, Slider, Stat, Text, UIComponentType } from '@elaraai/east-ui';
 *
 * const threshold = e3.input('threshold', FloatType, variant('value', 50.0));
 *
 * // No compute-time inputs (fn arg list is []), reactive bindings only:
 * const dashboard = ui('dashboard', [], East.function([], UIComponentType, (_$) =>
 *   Reactive.Root(East.function([], UIComponentType, $ => {
 *     const t = $.let(Data.bind(threshold));
 *     return Slider.Root($.let(t.read()), { onChange: t.write });
 *   }))
 * ));
 * // Manifest derived: { reads: [threshold.path], writes: [threshold.path] }
 *
 * // With a compute-time input that fn receives at start:
 * const greeting = ui('greeting', [name], East.function([StringType], UIComponentType,
 *   ($, n) => Text.Root(East.str`Hello, ${n}!`)));
 * // Manifest: { reads: [name.path], writes: [] }
 * ```
 */
export function ui<
  Name extends string,
  Inputs extends readonly DatasetDef[],
  O extends EastType = typeof UIComponentType,
>(
  name: Name,
  inputs: [...Inputs],
  fn: CallableFunctionExpr<any, O> | CallableAsyncFunctionExpr<any, O>,
  options?: {
    runner?: Runner,
  },
): TaskDef<O, [variant<'field', 'tasks'>, variant<'field', Name>, variant<'field', 'output'>]> {
  return buildUiTask(name, inputs, fn, options) as TaskDef<
    O,
    [variant<'field', 'tasks'>, variant<'field', Name>, variant<'field', 'output'>]
  >;
}

function buildUiTask(
  name: string,
  inputs: readonly DatasetDef[],
  fn: CallableFunctionExpr<any, EastType> | CallableAsyncFunctionExpr<any, EastType>,
  options?: { runner?: Runner },
): TaskDef {
  // The output is what the task's preview renders: a UI component (#1118).
  const output = Expr.type(fn as unknown as Expr<any>).output as EastType;
  if (!isSubtype(output, UIComponentType)) {
    throw new Error(
      `ui '${name}': its function returns ${printTypeSummary(output)}, not a UI component — ` +
      `a ui() task's function returns UIComponentType, or a subtype of it`
    );
  }
  const derived = deriveManifest(fn);
  const inputPaths: TreePath[] = inputs.map(i => i.path);
  const seen = new Set<string>();
  const paths: TreePath[] = [];
  for (const p of [...inputPaths, ...derived.paths]) {
    const k = p.map(s => `${s.type}:${s.value}`).join('/');
    if (seen.has(k)) continue;
    seen.add(k);
    paths.push(p);
  }
  // UI tasks default to east-c with no platforms — east-c can produce the
  // UIComponentType value without any platform-function imports; bound
  // Data/State reads resolve at render time, not in the runner.
  return task(name, inputs as any, fn as any, {
    runner: options?.runner ?? { runtime: 'east-c' } as Runner,
    role: variant('ui', {
      paths,
      functions: derived.functions,
      records: derived.records,
      pages: derived.pages,
    }),
  });
}

