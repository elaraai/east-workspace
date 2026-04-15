import { East } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { greetFn } from "./index.js";

describeEast("E3 Ui Showcase", (test) => {
    test("greet returns greeting message", $ => {
        const result = $.let(greetFn("World"));
        $(Assert.equal(result, East.value("Hello, World!")));
    });

    test("greet with custom name", $ => {
        const result = $.let(greetFn("East"));
        $(Assert.equal(result, East.value("Hello, East!")));
    });
}, { exportOnly: true });
