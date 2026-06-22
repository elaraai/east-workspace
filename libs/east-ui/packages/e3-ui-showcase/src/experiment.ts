/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Experiment showcase — every `<Experiment>` example wrapped as a UI task and
 * bundled into `east-ui-showcase-experiment@<pkg.version>`.
 *
 * The `@elaraai/e3-ui/examples/experiment/experiment` barrel re-exports the
 * bound `e3.input` datasets (batches / configs / journal) and the
 * `e3.function('experiment', …)` estimator; they are forwarded as `extras` so
 * the deployed workspace can `Data.bind` / `Func.bind` them at render time. The
 * estimator is a pure-East fixture (no datascience dependency), so it runs on
 * the default runner like every other showcase.
 *
 * Run via `make start-experiment` or `make experiment`.
 */

import * as examples from '@elaraai/e3-ui/examples/experiment/experiment';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

const {
    batchesInput,
    experimentConfigsInput,
    experimentMenuConfigsInput,
    experimentPrecomputedConfigsInput,
    experimentJournalInput,
    experimentFn,
    designFn,
} = examples;

export default await buildShowcasePackage('experiment', pkgInfo.version, examples, {
    extras: [
        batchesInput,
        experimentConfigsInput,
        experimentMenuConfigsInput,
        experimentPrecomputedConfigsInput,
        experimentJournalInput,
        experimentFn,
        designFn,
    ],
});
