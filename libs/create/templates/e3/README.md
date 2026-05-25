# __DISPLAY_NAME__

e3 project (BSL-1.1) — Node + Python, durable dataflow execution.

## Setup

```bash
npm run setup     # npm install + uv sync (Node and Python deps)
```

## Commands

```bash
npm run build     # compile TypeScript
npm run test      # build, export IR, run TS + Python tests
npm run test:ts   # TypeScript tests only
npm run test:py   # Python tests only (needs IR exported first)
npm run deploy    # create repo (if needed) + deploy from ./src/index.ts
npm run start     # deploy, then run the dataflow once
npm run watch     # auto-deploy + run on every save
npm run lint      # lint sources
npm run clean     # remove build output, venv, repo, dependencies
```

The package is defined in `src/index.ts` as the default export; `npm run
deploy`/`start`/`watch` deploy it straight from source via the e3 CLI.
