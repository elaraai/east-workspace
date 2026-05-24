/**
 * Feedback showcase — every feedback example wrapped as a UI task and bundled
 * into `east-ui-showcase-feedback@<pkg.version>`.
 *
 * Run via `make start-feedback` or `make feedback`.
 */

import * as examples from '@elaraai/east-ui/examples/feedback';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('feedback', pkgInfo.version, examples);
