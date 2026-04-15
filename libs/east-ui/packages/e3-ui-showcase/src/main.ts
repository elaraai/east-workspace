import e3 from "@elaraai/e3";
import * as button from "./button.js";

const pkg = e3.package('e3-ui-showcase', '1.0.0', 
    button.basic,
    button.solidVariant,
    button.dangerOutline,
    button.reactiveCounter,
    button.reactiveCounterNode,
) as any;
void e3.export(pkg, '/tmp/pkg.zip');
export default pkg;
