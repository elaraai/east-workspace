# @elaraai/e3-ui

e3 + UI bridge — Data bindings, `ui()` task, manifest.

Provides three things to East UI code that needs to read and write workspace
data via the e3 dataflow engine:

- **`Data.bind([T], path)`** — workspace-scoped dataset binding inside
  `Reactive.Root`. Returns `{ read, write, has }` closures. Resolves the
  workspace from the `DataProvider` context at runtime.
- **`ui(name, inputs, fn, options?)`** — first-class UI task built on top of
  `e3.task()`. Sets `kind: "ui"` and encodes a binding manifest that declares
  which datasets the UI reads and which inputs it can write to.
- **`DataManifestType`** + **`encodeManifest`** / **`decodeManifest`** —
  beast2-encoded manifest stored in the task's `metadata` blob, used by the
  browser for preloading and visual editing tooling.

## Install

```bash
npm install @elaraai/e3-ui
```

## Example

```ts
import e3 from '@elaraai/e3';
import { East, FloatType, NullType } from '@elaraai/east';
import { Reactive, Slider, Stat, Stack } from '@elaraai/east-ui';
import { ui, Data } from '@elaraai/e3-ui';

const threshold = e3.input('threshold', FloatType, 100.0);

const dashboard = ui('dashboard', [threshold], East.function([FloatType], UIComponentType, ($, _t) => {
    return Reactive.Root(East.function([], UIComponentType, $ => {
        const thresh = $.let(Data.bind([FloatType], threshold.path));
        const value = $.let(thresh.read());
        return Stack.VStack([
            Stat.Root('Threshold', value),
            Slider.Root(value, { min: 0, max: 200, onChange: thresh.write }),
        ]);
    }));
}), { writes: [threshold] });
```

## License

Dual-licensed under AGPL-3.0 and a commercial license. See [LICENSE.md](./LICENSE.md).

Contributions require a signed CLA — see [CLA.md](./CLA.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).
