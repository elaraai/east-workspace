/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, FloatType, IntegerType, NullType, StringType, variant, example } from "@elaraai/east";
import { Reactive, Slider, Stack, Stat, Text, Input, Button, UIComponentType } from "@elaraai/east-ui";
import { Data } from "@elaraai/e3-ui";
import * as e3 from "@elaraai/e3";

export const thresholdInput = e3.input('threshold', FloatType, 50.0);
export const countInput     = e3.input('count', IntegerType, 0n);
export const nameInput      = e3.input('name', StringType, '');

export const dataBindFloat = example({
    keywords: ["Data", "bind", "Reactive", "Float", "dataset", "read"],
    description: "Bind to a Float dataset and display its current value",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const thresh = $.let(Data.bind([FloatType], thresholdInput.path));
            const value = $.let(thresh.read());
            return Stat.Root("Threshold", Text.Root(East.print(value)));
        }));
    }),
    inputs: [],
});

export const dataBindSliderWriteback = example({
    keywords: ["Data", "bind", "Reactive", "Slider", "onChange", "write", "interactive"],
    description: "Slider whose value is bound to a dataset — onChange writes back",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const thresh = $.let(Data.bind([FloatType], thresholdInput.path));
            const value = $.let(thresh.read());
            return Slider.Root(value, { 
                min: 0, 
                max: 100, 
                onChangeEnd: thresh.writeAndStart, 
                disabled: thresh.status().hasTag('stale') 
            });

        }));
    }),
    inputs: [],
});

export const dataBindInteger = example({
    keywords: ["Data", "bind", "Integer", "Input", "write", "interactive"],
    description: "Integer dataset bound to a number input with writeback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const count = $.let(Data.bind([IntegerType], countInput.path));
            const value = $.let(count.read());
            return Input.Integer(value, { onChange: count.write });
        }));
    }),
    inputs: [],
});

export const dataBindStringReset = example({
    keywords: ["Data", "bind", "String", "callback", "Button", "reset", "write"],
    description: "String dataset with a reset button that writes an empty string",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const name = $.let(Data.bind([StringType], nameInput.path));
            const value = $.let(name.read());
            const reset = $.const(East.function([], NullType, $ => {
                $(name.write(""));
            }));
            return Stack.VStack([
                Stat.Root("Name", Text.Root(value)),
                Button.Root("Reset", { variant: "outline", onClick: reset }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const dataBindHasGuard = example({
    keywords: ["Data", "bind", "has", "guard", "conditional", "Reactive"],
    description: "Use has() to gate UI on whether a dataset has been written",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const thresh = $.let(Data.bind([FloatType], thresholdInput.path));
            const ready = $.let(thresh.has());
            const message = $.let("(no data)");
            $.if(ready, $ => {
                $.assign(message, East.print(thresh.read()));
            });
            return Text.Root(message);
        }));
    }),
    inputs: [],
});
