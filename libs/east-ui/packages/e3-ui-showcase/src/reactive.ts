/**
 * Reactive showcase — every reactive example wrapped as a UI task and bundled
 * into `east-ui-showcase-reactive@<pkg.version>`.
 *
 * Run via `make start-reactive` or `make reactive`.
 */

import * as examples from '@elaraai/east-ui/examples/reactive';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('reactive', pkgInfo.version, examples);
