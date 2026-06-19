import e3 from "@elaraai/e3";
import { East, ArrayType, FloatType, IntegerType } from "@elaraai/east";

import { surface } from "./surface.js";
import { forecastDemand } from "./platform_module.js";
import { applySafetyBuffer } from "./platform.js";

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

// A project-owned PYTHON platform function: forecast demand as the mean of
// recent history. The impl lives in platform_module/__init__.py and runs on the
// east-py runtime — `{ custom: "platform_module" }` loads the project's own
// package, resolved from <project>/.venv after `uv sync`.
export const historyInput = e3.input("demand_history", ArrayType(FloatType), [12.0, 14.0, 13.0, 18.0, 20.0]);

export const forecastFn = East.function(
  [ArrayType(FloatType)],
  FloatType,
  ($, history) => {
    $.return(forecastDemand(history));
  },
);

export const forecast = e3.task("forecast", [historyInput], forecastFn, {
  runner: { runtime: "east-py", platforms: [{ custom: "platform_module" }, "east-py-std"] },
});

// A project-owned TS-EAST platform function: buffer the reorder by a safety
// factor and round up to a whole unit. The impl lives in src/platform.ts and
// runs on the east-node runtime — `{ custom: "@elaraai/__PROJECT_NAME__" }` loads this
// package's own `./platform` export.
export const bufferInput = e3.input("safety_factor", FloatType, 1.15);

export const bufferedFn = East.function(
  [IntegerType, FloatType],
  IntegerType,
  ($, quantity, factor) => {
    $.return(applySafetyBuffer(quantity, factor));
  },
);

export const bufferedReorder = e3.task("buffered_reorder", [reorderQty.output, bufferInput], bufferedFn, {
  runner: { runtime: "east-node", platforms: [{ custom: "@elaraai/__PROJECT_NAME__" }] },
});

export default e3.package("__PROJECT_NAME__", "1.0.0", reorderQty, forecast, bufferedReorder, surface);
