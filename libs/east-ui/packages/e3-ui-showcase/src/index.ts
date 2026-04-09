/**
 * e3 UI Showcase — East UI examples as e3 tasks using the east-c runner.
 *
 * Build and deploy:
 *   make start
 */

import e3 from '@elaraai/e3';
import { basic, solidVariant, dangerOutline, reactiveCounter, reactiveCounterNode } from './button.js';

const tasks = [basic, solidVariant, dangerOutline, reactiveCounter, reactiveCounterNode] as any;
const pkg = e3.package('e3-ui-showcase', '0.0.1',
    ...tasks
);

await e3.export(pkg, '/tmp/e3-ui-showcase.zip');

export default pkg;
