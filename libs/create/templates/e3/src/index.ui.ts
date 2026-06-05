import e3 from "@elaraai/e3";
import { East, IntegerType } from "@elaraai/east";

import { surface } from "./surface.js";

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

export default e3.package("__PROJECT_NAME__", "1.0.0", reorderQty, surface);
