/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Record showcase — every Record.bind example wrapped as a UI task and bundled
 * into `east-ui-showcase-record@<pkg.version>`.
 *
 * The `@elaraai/e3-ui/examples/bind/record/record` barrel re-exports the
 * `counter` record with its `increment` / `reset` mutations and the `jobs`
 * record the Sheet example pages, with its patch door; every one is forwarded
 * as `extras`, so the deployed workspace has the records (and their write
 * surfaces) available at render time.
 *
 * Run via `make start-record` or `make record`.
 */

import * as examples from '@elaraai/e3-ui/examples/bind/record/record';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage, definitionsOf } from './utils.js';

export default await buildShowcasePackage('record', pkgInfo.version, examples, {
    extras: definitionsOf(examples),
});
