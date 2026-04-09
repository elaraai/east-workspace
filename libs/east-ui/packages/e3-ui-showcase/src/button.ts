/**
 * Button showcase tasks — wraps east-ui button examples as e3 tasks.
 */

import type { FunctionExpr } from '@elaraai/east';
import type { UIComponentType } from '@elaraai/east-ui';
import e3 from '@elaraai/e3';
import {
    buttonBasic,
    buttonSolidVariant,
    buttonDangerOutline,
    buttonReactiveCounter,
} from '@elaraai/east-ui/examples/buttons';

const c_runner = ['east-c', 'run', '-p', 'east-c-std'];
const node_runner = ['east-node', 'run', '-p', 'east-node-std'];

// Cast needed: example .fn types are built in a separate tsc invocation,
// so the private brand fields aren't structurally identical to e3.task's overloads.
type Fn = FunctionExpr<[], typeof UIComponentType>;

export const basic = e3.task('button_basic', [], buttonBasic.fn as Fn, { runner: c_runner });
export const solidVariant = e3.task('button_solid_variant', [], buttonSolidVariant.fn as Fn, { runner: c_runner });
export const dangerOutline = e3.task('button_danger_outline', [], buttonDangerOutline.fn as Fn, { runner: c_runner });
export const reactiveCounter = e3.task('button_reactive_counter', [], buttonReactiveCounter.fn as Fn, { runner: c_runner });

// Same reactive counter via node runner — to compare beast2 output
export const reactiveCounterNode = e3.task('button_reactive_counter_node', [], buttonReactiveCounter.fn as Fn, { runner: node_runner });
