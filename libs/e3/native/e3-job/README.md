# e3-job — the Windows job launcher

`e3-job.exe` is the small native program e3-core runs each task runner through
on Windows, so that stopping a runner stops everything it started.

## Why

On POSIX e3 spawns a runner in a process group of its own and stops the whole
tree by signalling the group. Windows has no process group a signal can
address, and walking parent pids (`taskkill /T`) misses any process whose
parent has already exited — which is every program Git Bash's `exec` runs. The
Windows container for "a process and everything it starts" is the Job Object.
Node cannot create one: libuv places a process's children in a single job of
its own, which lets their children break away. So e3 carries this launcher —
a separate executable rather than a native addon, so there is nothing to
rebuild per Node version.

## What it does

```
e3-job.exe "<application path>" <command line>
```

1. Creates a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (every member
   ends when the job's last handle closes) and
   `JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION` (a crashing member ends with
   its exception code instead of waiting on an error dialog, as in the job Node
   places its own children in), and allows no breakaway.
2. Joins the job itself, before starting anything, so the command is a member
   from its first instruction and ending the launcher at any moment leaves
   nothing running outside the job.
3. Starts the application with the command line after it, unchanged, and with
   the launcher's standard handles, environment and working directory.
4. Waits for it and exits with its exit code. Exiting closes the job's only
   handle, so whatever the command left running ends too.

e3-core (`spawnAndCapture`, `src/execution/processExec.ts`) parses the runner's
command exactly as a direct spawn does (cross-spawn, which runs a `.cmd` shim
through cmd.exe) and hands the launcher the program's path and the command line
Node would have built for it. It stops a runner by ending the launcher. The
launcher is e3's direct child, in the job Node places its children in, so it —
and its job — also ends when e3 dies.

Exit codes of the launcher's own: **125** misuse, or the job cannot be set up;
**126** the command cannot be started; **127** it is not found. Each is
reported on stderr as `e3-job: <what>: <system message>`.

## Building and installing it in a checkout

Windows only, in an MSVC environment (a Developer prompt, or after `vcvars`),
with CMake and Ninja:

```bash
make -C libs/e3 job-launcher   # builds native/e3-job/build/e3-job.exe
make -C libs/e3 install-job    # and installs it where e3-core finds it
```

`install-job` stages the launcher as the package a published install carries,
`node_modules/@elaraai/e3-job-win32-x64`, at the workspace root
(`scripts/stage-e3-job-package.mjs`); re-run it if a `pnpm install` removes it.
Without it e3 on Windows warns `E3_NO_JOB_LAUNCHER`, runs runners directly and
stops them with `taskkill /T`; e3-core's tests fail on Windows until it is
installed. CI's Windows e3 job installs it before the tests.

## Distribution

The launcher ships as the per-platform npm package `@elaraai/e3-job-win32-x64`
(`os: win32`, `cpu: x64`), an optional dependency of `@elaraai/e3-core`, on the
same model as the east-c per-platform packages
([`libs/east-c/docs/npm-runner-distribution.md`](../../../east-c/docs/npm-runner-distribution.md)):

- **Generated at release, never committed.** release.yml's `build-e3-job` job
  builds the binary on Windows, stages the package and packs it;
  `publish-npm` publishes it before e3-core.
- **The dependency is injected at publish time.** e3-core's committed
  `package.json` does not list it — `pnpm install --frozen-lockfile` would
  reject the lockfile whenever the version moves.
  `scripts/inject-e3-job-dep.mjs` adds it, pinned to the release version,
  just before e3-core is published.
- **The release dry-run proves the install.** `scripts/test-release-verdaccio.sh`
  publishes it to a local registry on its Windows leg, installs e3-core in a
  fresh project and checks that a runner e3-core spawns is the launcher's child.
  The other legs prove e3-core installs without it.

### Bootstrap (one time, before the first release that publishes it)

npm trusted publishing needs the package name to exist before a trusted
publisher can be configured for it, so its first version is published by hand:

1. On npmjs.com, generate a granular access token with read+write on the
   `@elaraai` scope and a short TTL.
2. Run a release dry-run so the package is built:
   `gh workflow run release.yml --ref main -f release_type=prerelease -f dry_run=true`
3. Download it: `gh run download <run-id> -D ./bootstrap-artifacts -n e3-job-npm`
4. Publish it: `NPM_TOKEN=npm_xxx node scripts/bootstrap-e3-job-npm.mjs ./bootstrap-artifacts`
5. On npmjs.com, configure trusted publishing for `@elaraai/e3-job-win32-x64`
   (Settings → Publishing access → Trusted publisher → GitHub Actions,
   `elaraai/east-workspace` + `release.yml`), then revoke the token.

Until then a real release's `publish-npm` job fails at the launcher step,
before it publishes any package.
