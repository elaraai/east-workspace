import { East } from "@elaraai/east";
import { ui } from "@elaraai/e3-ui";
import { Box, Text, UIComponentType } from "@elaraai/east-ui";

// A decision surface for an operator to observe and act on the recommendation.
// east-ui / e3-ui JSX authoring is still being finalised — build this out: bind
// the tasks and inputs with Data.bind, then add the Observe / Decide controls.
// To add another surface, define it beside this file and register it in the
// package (src/index.ts).
export const surface = ui(
  "surface",
  [],
  East.function([], UIComponentType, (_$) => (
    <Box padding="6">
      <Text textStyle="heading-md">__DISPLAY_NAME__</Text>
    </Box>
  )),
);
