/**
 * Container showcase — every container example wrapped as a UI task and
 * bundled into `east-ui-showcase-container@<pkg.version>`.
 *
 * Run via `make start-container` or `make container`.
 */

import * as examples from '@elaraai/east-ui/examples/container';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('container', pkgInfo.version, examples);
