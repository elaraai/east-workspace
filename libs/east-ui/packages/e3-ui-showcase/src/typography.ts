/**
 * Typography showcase — every typography example wrapped as a UI task and
 * bundled into `east-ui-showcase-typography@<pkg.version>`.
 *
 * Run via `make start-typography` or `make typography`.
 */

import * as examples from '@elaraai/east-ui/examples/typography';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('typography', pkgInfo.version, examples);
