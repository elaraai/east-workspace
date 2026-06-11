import { East } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { reorderFn } from "./index.js";

describeEast("__DISPLAY_NAME__", (test) => {
  test("reorders up to the target when below it", ($) => {
    const qty = $.let(reorderFn(12n, 50n));
    $(Assert.equal(qty, East.value(38n)));
  });

  test("never recommends a negative reorder", ($) => {
    const qty = $.let(reorderFn(80n, 50n));
    $(Assert.equal(qty, East.value(0n)));
  });
}, { exportOnly: true });
