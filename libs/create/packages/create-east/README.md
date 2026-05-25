# @elaraai/create-east

Scaffold a new **East** project — AGPL-3.0, Node-only.

```bash
npm create @elaraai/east my-lib
```

- Pass `.` instead of a name to scaffold into the current directory.
- Add `-- --install` to install dependencies as part of scaffolding.

The generated project is driven by cross-platform npm scripts:

```bash
cd my-lib
npm install
npm run build     # tsc
npm run test      # build and run tests
npm run lint
```

For a durable-execution project with Python (BSL-1.1, Node + Python), use
[`@elaraai/create-e3`](https://www.npmjs.com/package/@elaraai/create-e3).

Part of the [East](https://github.com/elaraai/east-workspace) ecosystem.
