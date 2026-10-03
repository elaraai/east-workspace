/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Query showcase — every `<Query.Builder>` and `<Query.Library>` example
 * wrapped as a UI task and bundled into `east-ui-showcase-query@<pkg.version>`.
 *
 * The `@elaraai/e3-ui/examples/query/query` barrel re-exports #875's shared
 * fixture as `e3.input` datasets (orders, customers, forecast, model, bom),
 * the saved queries record seeded with the mock's seven, an empty one, and
 * each record's patch mutation; they are forwarded as `extras` so the deployed
 * workspace can bind them at render time, and a run reaches them through e3's
 * one-shot call.
 *
 * Run via `make start-query` or `make query`.
 */

import * as examples from '@elaraai/e3-ui/examples/query/query';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

const { orders, customers, forecast, model, bom, queries, queriesPatch, queriesEmpty, queriesEmptyPatch } = examples;

export default await buildShowcasePackage('query', pkgInfo.version, examples, {
    extras: [orders, customers, forecast, model, bom, queries, queriesPatch, queriesEmpty, queriesEmptyPatch],
});
