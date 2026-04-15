/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `ui()` — first-class UI task for e3.
 *
 * Wraps `e3.task()` with `kind: "ui"` and encodes a binding manifest.
 *
 * @packageDocumentation
 */

import { task, type DatasetDef, type TaskDef } from '@elaraai/e3';
import type { UIComponentType } from '@elaraai/east-ui';
import type { EastType, FunctionExpr, AsyncFunctionExpr } from '@elaraai/east';
import { encodeManifest } from './manifest.js';

/**
 * Create a UI task — an e3 task that produces a UIComponentType value.
 *
 * Sets `kind: "ui"` and encodes a binding manifest declaring which datasets
 * the UI reads and which inputs it can write to.
 *
 * @param name - Task name
 * @param inputs - Input datasets
 * @param fn - East function producing UIComponentType
 * @param options - Optional: writable inputs, custom runner
 * @returns A TaskDef with kind "ui"
 *
 * @example
 * ```ts
 * import e3 from '@elaraai/e3';
 * import { ui, Data } from '@elaraai/e3-ui';
 * import { Reactive, Stack, Slider, Stat } from '@elaraai/east-ui';
 *
 * const threshold = e3.input('threshold', FloatType, 100.0);
 * const summary = e3.task('summarize', [sales, threshold], summarizeFn);
 *
 * const dashboard = ui('dashboard', [sales], ($, data) => {
 *     return Stack.Root([
 *         Reactive.Root($ => {
 *             const thresh = $(Data.bind([FloatType], threshold.path));
 *             const value = $(thresh.read());
 *             return Slider.Root(value, { onChange: thresh.write });
 *         }),
 *     ]);
 * }, { writes: [threshold] });
 * ```
 */
export function ui<Inputs extends readonly DatasetDef[]>(
  name: string,
  inputs: [...Inputs],
  fn: FunctionExpr<any, typeof UIComponentType> | AsyncFunctionExpr<any, typeof UIComponentType>,
  options?: {
    writes?: DatasetDef[],
    runner?: string[],
  },
): TaskDef {
  return task(name, inputs as any, fn as any, {
    runner: options?.runner ?? ['east-c', 'run'],
    kind: 'ui',
    metadata: encodeManifest({
      reads: inputs.map(i => i.path),
      writes: (options?.writes ?? []).map(w => w.path),
    }),
  });
}
