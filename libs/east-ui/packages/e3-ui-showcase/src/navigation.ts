/**
 * Navigation showcase — every navigation example wrapped as a UI task and
 * bundled into `east-ui-showcase-navigation@<pkg.version>`.
 *
 * Run via `make start-navigation` or `make navigation`.
 */

import * as examples from '@elaraai/east-ui/examples/navigation';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('navigation', pkgInfo.version, examples);
