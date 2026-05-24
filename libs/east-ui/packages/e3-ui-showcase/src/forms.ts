/**
 * Forms showcase — every forms example wrapped as a UI task and bundled
 * into `east-ui-showcase-forms@<pkg.version>`.
 *
 * Run via `make start-forms` or `make forms`.
 */

import * as examples from '@elaraai/east-ui/examples/forms';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('forms', pkgInfo.version, examples);
