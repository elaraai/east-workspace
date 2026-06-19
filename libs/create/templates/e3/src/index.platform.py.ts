import e3 from "@elaraai/e3";
import { East, ArrayType, FloatType, IntegerType } from "@elaraai/east";

import { examplePython } from "./platform_module.js";
import { exampleNode } from "./platform/index.js";

// In East a decision is a typed task over inputs. This one recommends how many
// units to reorder to bring stock up to its target level — never negative.
export const onHandInput = e3.input("on_hand", IntegerType, 12n);
export const targetInput = e3.input("reorder_to", IntegerType, 50n);

export const reorderFn = East.function(
  [IntegerType, IntegerType],
  IntegerType,
  ($, onHand, target) => {
    const gap = $.let(target.subtract(onHand));
    $.return(East.greater(gap, 0n).ifElse(() => gap, () => 0n));
  },
);

export const reorderQty = e3.task("reorder_qty", [onHandInput, targetInput], reorderFn);

// An example project-owned PYTHON platform function on the east-py runtime.
// `{ custom: "platform_module" }` loads the project's own package, resolved from
// <project>/.venv after `uv sync`. Replace `example_python`
// (platform_module/example.py) with your own.
export const exampleValuesInput = e3.input("example_values", ArrayType(FloatType), [1.0, 2.0, 3.0, 4.0, 5.0]);

export const examplePythonFn = East.function(
  [ArrayType(FloatType)],
  FloatType,
  ($, values) => {
    $.return(examplePython(values));
  },
);

export const examplePythonTask = e3.task("example_python", [exampleValuesInput], examplePythonFn, {
  runner: { runtime: "east-py", platforms: [{ custom: "platform_module" }, "east-py-std"] },
});

// An example project-owned TS-East platform function on the east-node runtime.
// `{ custom: "@elaraai/__PROJECT_NAME__" }` loads this package's own `./platform`
// export. Replace `exampleNode` (src/platform/example.ts) with your own.
export const exampleFactorInput = e3.input("example_factor", FloatType, 1.5);

export const exampleNodeFn = East.function(
  [IntegerType, FloatType],
  IntegerType,
  ($, value, factor) => {
    $.return(exampleNode(value, factor));
  },
);

export const exampleNodeTask = e3.task("example_node", [reorderQty.output, exampleFactorInput], exampleNodeFn, {
  runner: { runtime: "east-node", platforms: [{ custom: "@elaraai/__PROJECT_NAME__" }] },
});

export default e3.package("__PROJECT_NAME__", "1.0.0", reorderQty, examplePythonTask, exampleNodeTask);
