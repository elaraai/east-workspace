/**
 * Integration showcase — end-to-end examples that combine filters, charts,
 * and rich tables driven by generated data. Bundled into
 * `east-ui-showcase-integration@<pkg.version>`.
 *
 * Run via `make start-integration` (build → emit → import → deploy → start)
 * or `make integration` (emit zip only).
 */

import * as examples from '@elaraai/east-ui/examples/integration';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

export default await buildShowcasePackage('integration', pkgInfo.version, examples);
