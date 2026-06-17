/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Record showcase — every Record.bind example wrapped as a UI task and bundled
 * into `east-ui-showcase-record@<pkg.version>`.
 *
 * The `@elaraai/e3-ui/examples/bind/record/record` barrel re-exports the
 * `counter` record + its `increment` / `reset` mutations; they are forwarded as
 * `extras` so the deployed workspace has the record (and its write surface)
 * available at render time.
 *
 * Run via `make start-record` or `make record`.
 */

import * as examples from '@elaraai/e3-ui/examples/bind/record/record';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

const { counter, increment, reset } = examples;

export default await buildShowcasePackage('record', pkgInfo.version, examples, {
    extras: [counter, increment, reset],
});
