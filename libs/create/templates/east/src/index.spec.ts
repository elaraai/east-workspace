import { East } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { greet } from "./index.js";

describeEast("__DISPLAY_NAME__", (test) => {
  test("greet returns greeting message", ($) => {
    const result = $.let(greet("World"));
    $(Assert.equal(result, East.value("Hello, World!")));
  });

  test("greet with custom name", ($) => {
    const result = $.let(greet("East"));
    $(Assert.equal(result, East.value("Hello, East!")));
  });
});
