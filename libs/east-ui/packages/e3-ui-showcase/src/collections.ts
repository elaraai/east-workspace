/**
 * Collections showcase — every collections (DataList, Gantt, Planner, Table,
 * TreeView) example wrapped as a UI task and bundled into
 * `east-ui-showcase-collections@<pkg.version>`.
 *
 * Run via `make start-collections` or `make collections`.
 */

import * as examples from '@elaraai/east-ui/examples/collections';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('collections', pkgInfo.version, examples);
