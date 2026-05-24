/**
 * Buttons showcase — every button example wrapped as a UI task and bundled
 * into `east-ui-showcase-buttons@<pkg.version>`.
 *
 * Run via `make start-buttons` or `make buttons`.
 */

import * as examples from '@elaraai/east-ui/examples/buttons';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('buttons', pkgInfo.version, examples);
