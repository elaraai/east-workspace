/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plan showcase — every `<Plan>` example wrapped as a UI task and bundled
 * into `east-ui-showcase-plan@<pkg.version>`. The Plan is e3-ui's (#1177), so
 * its examples come from `@elaraai/e3-ui`, not the east-ui collections barrel.
 *
 * Every example binds its data from e3 (#1178): the barrel's inputs, its
 * records with their patch doors, and the tasks that generate the horizons
 * and the fill canvas's units are forwarded as `extras`, so the deployed
 * workspace has them at render time.
 *
 * Run via `make start-plan` or `make plan`.
 */

import * as examples from '@elaraai/e3-ui/examples/plan/plan';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage, definitionsOf } from './utils.js';

export default await buildShowcasePackage('plan', pkgInfo.version, examples, {
    extras: definitionsOf(examples),
});
