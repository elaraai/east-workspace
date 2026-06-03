/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `ui()` — first-class UI task for e3.
 *
 * Wraps `e3.task()` with `kind: "ui"` and a manifest auto-derived from the
 * IR by inspecting `Data.bind` calls. Compute-time inputs (passed to the fn
 * by the runner) are also added to the manifest's reads.
 *
 * @packageDocumentation
 */

import { task, type DatasetDef, type Runner, type TaskDef } from '@elaraai/e3';
import { UIComponentType } from '@elaraai/east-ui';
import {
  East,
  type EastType,
  type ExprType,
  type CallableFunctionExpr,
  type CallableAsyncFunctionExpr,
} from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import { encodeManifest } from './manifest.js';
import { deriveManifest } from './derive.js';

// Re-export the JSX component tags (Box, VStack, Text, Button, …) so the
// author-side entry `@elaraai/e3-ui/ui` is a single import for both `ui()`
// and the JSX tags used inside it.
export * from './jsx.js';

/**
 * Create a UI task — an e3 task that produces a UIComponentType value.
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
 * @example
 * ```ts
 * import e3 from '@elaraai/e3';
 * import { ui, Data } from '@elaraai/e3-ui';
 * import { FloatType, East } from '@elaraai/east';
 * import { Reactive, Slider, Stat, Text, UIComponentType } from '@elaraai/east-ui';
 *
 * const threshold = e3.input('threshold', FloatType, 50.0);
 *
 * // No compute-time inputs (fn arg list is []), reactive bindings only:
 * const dashboard = ui('dashboard', [], East.function([], UIComponentType, (_$) =>
 *   Reactive.Root(East.function([], UIComponentType, $ => {
 *     const t = $.let(Data.bind([FloatType], threshold.path));
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
// Closure form — `ui(name, () => <Box…/>)`. The thunk returns a built
// `UIComponentType` value (e.g. east-ui JSX), which is wrapped in a zero-input
// `East.function`. No compute-time inputs; reactive `Data.bind` reads are still
// derived from the IR. Ideal for `.tsx` JSX authoring.
export function ui(
  name: string,
  render: () => ExprType<typeof UIComponentType>,
  options?: {
    runner?: Runner,
  },
): TaskDef;
// Function form — `ui(name, [inputs], East.function([...], UIComponentType, …))`.
export function ui<
  Inputs extends readonly DatasetDef[],
  O extends EastType = typeof UIComponentType,
>(
  name: string,
  inputs: [...Inputs],
  fn: CallableFunctionExpr<any, O> | CallableAsyncFunctionExpr<any, O>,
  options?: {
    runner?: Runner,
  },
): TaskDef;
export function ui(
  name: string,
  arg2: unknown,
  arg3?: unknown,
  arg4?: unknown,
): TaskDef {
  // Discriminate the overloads by `arg2`: the function form always passes an
  // `inputs` array there, so a function means the closure form.
  if (typeof arg2 === 'function') {
    const render = arg2 as () => ExprType<typeof UIComponentType>;
    const fn = East.function([], UIComponentType, () => render());
    return buildUiTask(name, [], fn, arg3 as { runner?: Runner } | undefined);
  }
  return buildUiTask(
    name,
    arg2 as readonly DatasetDef[],
    arg3 as CallableFunctionExpr<any, EastType> | CallableAsyncFunctionExpr<any, EastType>,
    arg4 as { runner?: Runner } | undefined,
  );
}

function buildUiTask(
  name: string,
  inputs: readonly DatasetDef[],
  fn: CallableFunctionExpr<any, EastType> | CallableAsyncFunctionExpr<any, EastType>,
  options?: { runner?: Runner },
): TaskDef {
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
    kind: 'ui',
    metadata: encodeManifest({ paths }),
  });
}

