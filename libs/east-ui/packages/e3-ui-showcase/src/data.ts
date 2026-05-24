/**
 * Data showcase — every Data.bind example wrapped as a UI task and bundled
 * into `east-ui-showcase-data@<pkg.version>`.
 *
 * The `@elaraai/e3-ui/examples/data` barrel re-exports both `e3.input(...)`
 * datasets and example-task tuples; inputs are forwarded as `extras` so the
 * deployed workspace has them at render time.
 *
 * Run via `make start-data` or `make data`.
 */

import * as examples from '@elaraai/e3-ui/examples/data';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

const { thresholdInput, countInput, nameInput } = examples;

export default await buildShowcasePackage('data', pkgInfo.version, examples, {
    extras: [thresholdInput, countInput, nameInput],
});
