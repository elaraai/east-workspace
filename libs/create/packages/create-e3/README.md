# @elaraai/create-e3

Scaffold a new **e3** project — BSL-1.1, Node + Python, durable dataflow execution.

```bash
npm create @elaraai/e3 my-solution
```

- Pass `.` instead of a name to scaffold into the current directory.
- Add `-- --install` to install dependencies (npm + `uv`) as part of scaffolding.

The generated project is driven by cross-platform npm scripts:

```bash
cd my-solution
npm run setup     # npm install + uv sync
npm run build     # tsc
npm run test      # build, export IR, run TS + Python tests
npm run start     # deploy from source, then run the dataflow
npm run watch     # auto-deploy + run on every save
```

The package is defined in `src/index.ts` as the default export and deployed
straight from source via `e3 workspace deploy --from-source`.

For an East-only (AGPL-3.0, Node-only) project, use
[`@elaraai/create-east`](https://www.npmjs.com/package/@elaraai/create-east).

Part of the [East](https://github.com/elaraai/east-workspace) ecosystem.
