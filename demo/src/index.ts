/**
 * Demo e3 package with diamond dependencies.
 *
 * Structure:
 *   inputs.x (default: 10)
 *   inputs.y (default: 5)
 *        |
 *    +---+---+
 *    |       |
 *   add     mul
 *    |       |
 *    +---+---+
 *        |
 *      combine (add + mul)
 *        |
 *      format (string output)
 *
 * With defaults: add=15, mul=50, combine=65, format="Result: 65"
 */

import { mkdirSync } from 'node:fs';
import { East, IntegerType, StringType } from '@elaraai/east';
import e3 from '@elaraai/e3';

// Inputs
const x = e3.input('x', IntegerType, 10n);
const y = e3.input('y', IntegerType, 5n);

// Left branch: addition
const add = e3.task(
  'add',
  [x, y],
  East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
);

// Right branch: multiplication
const mul = e3.task(
  'mul',
  [x, y],
  East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.multiply(b))
);

// Merge: combine both branches
const combine = e3.task(
  'combine',
  [add.output, mul.output],
  East.function([IntegerType, IntegerType], IntegerType, ($, sum, product) =>
    sum.add(product)
  )
);

// Final: format as string
const format = e3.task(
  'format',
  [combine.output],
  East.function([IntegerType], StringType, ($, result) =>
    East.str`Result: ${result}`
  )
);

// Create package
const pkg = e3.package('demo', '1.0.0', format);

// Export to dist/
mkdirSync('dist', { recursive: true });
await e3.export(pkg, 'dist/demo-1.0.0.zip');
console.log('Package exported to dist/demo-1.0.0.zip');
