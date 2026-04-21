/**
 * Disclosure showcase — every disclosure example wrapped as a UI task and
 * bundled into `east-ui-showcase-disclosure@<pkg.version>`.
 *
 * Run via `make start-disclosure` or `make disclosure`.
 */

import * as examples from '@elaraai/east-ui/examples/disclosure';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('disclosure', pkgInfo.version, examples);
