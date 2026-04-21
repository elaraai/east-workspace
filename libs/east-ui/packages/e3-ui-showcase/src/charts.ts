/**
 * Charts showcase — every chart example wrapped as a UI task and bundled into
 * `east-ui-showcase-charts@<pkg.version>`.
 *
 * Run via `make start-charts` or `make charts`.
 */

import * as examples from '@elaraai/east-ui/examples/charts';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('charts', pkgInfo.version, examples);
