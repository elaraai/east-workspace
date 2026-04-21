/**
 * Layout showcase — every layout example wrapped as a UI task and bundled
 * into `east-ui-showcase-layout@<pkg.version>`.
 *
 * Run via `make start-layout` or `make layout`.
 */

import * as examples from '@elaraai/east-ui/examples/layout';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('layout', pkgInfo.version, examples);
