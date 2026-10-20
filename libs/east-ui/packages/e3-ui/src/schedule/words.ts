/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The words the schedule builders' pure functions write (`Allocation Spec.md`
 * §12, §13): a number as the Allocation's and the Roster's fits, checks and
 * lines print it, one printer for both, so their words agree.
 *
 * @packageDocumentation
 */

import { East, FloatType, StringType } from "@elaraai/east";

/**
 * A number as a schedule's words write it: a whole number without a decimal
 * point, any other as East prints it.
 *
 * @param value - The number
 * @returns `21`, `12.5`
 * @internal
 */
export const scheduleNumberText = East.function([FloatType], StringType, ($, value) => {
    const whole = $.const(East.Float.roundHalf(value));
    return East.equal(whole.toFloat(), value).ifElse(() => East.print(whole), () => East.print(value));
});
