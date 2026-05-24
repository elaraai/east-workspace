/**
 * Overlays showcase — every overlays example wrapped as a UI task and bundled
 * into `east-ui-showcase-overlays@<pkg.version>`.
 *
 * Run via `make start-overlays` or `make overlays`.
 */

import * as examples from '@elaraai/east-ui/examples/overlays';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('overlays', pkgInfo.version, examples);
