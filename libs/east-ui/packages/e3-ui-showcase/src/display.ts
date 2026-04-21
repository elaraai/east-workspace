/**
 * Display showcase — every display example wrapped as a UI task and bundled
 * into `east-ui-showcase-display@<pkg.version>`.
 *
 * Run via `make start-display` or `make display`.
 */

import * as examples from '@elaraai/east-ui/examples/display';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('display', pkgInfo.version, examples);
