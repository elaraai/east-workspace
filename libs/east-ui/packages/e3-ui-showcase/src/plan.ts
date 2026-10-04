/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plan showcase — every `<Plan.View>` example wrapped as a UI task and bundled
 * into `east-ui-showcase-plan@<pkg.version>`. The Plan is e3-ui's (#1177), so
 * its examples come from `@elaraai/e3-ui`, not the east-ui collections barrel.
 *
 * Run via `make start-plan` or `make plan`.
 */

import * as examples from '@elaraai/e3-ui/examples/plan/plan';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('plan', pkgInfo.version, examples);
