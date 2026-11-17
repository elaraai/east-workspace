# A project and its tier resolve the same torch (#1662)

Status: **approved 17 Nov 2026, and built** in this change. Section 7 lists
what building it changed. It follows
[`e3-environment-over-tier.md`](e3-environment-over-tier.md) (#1655), and is
what makes that change pay off for a project that uses torch.

## 1. The problem, measured

An environment built over its tier leaves a distribution to the tier only
when the tier holds **that exact build**: the same name, version and installed
files. Nothing made a project and a tier resolve the same builds, and they
did not.

Resolved on 17 Nov 2026 for Python 3.11 on Linux x86_64, at release 1.0.108,
before this change:

| Who resolved | torch | Its NVIDIA libraries |
|---|---|---|
| The workspace's lock (`libs/east-py/uv.lock`), which the package's own tests ran against | 2.10.0 | `nvidia-*-cu12`, CUDA 12.8 |
| A `py-datascience` image built that day, unlocked: `uv pip install "elaraai-east-py-datascience[all]==1.0.108"` | 2.15.0 | CUDA 13 |
| A project that asked for the `torch` extra that day (`torch>=2.4.0`) | 2.15.0 | CUDA 13 |

The last two agreed only because both were resolved on the same day. An image
is resolved when its release is built, and a project when it locks.

Three faults followed, and the first is the one the issue names.

1. **A project's torch was not its tier's.** Against a tier that held the
   workspace's lock, a project that asked for torch and pytorch-lightning
   resolved 46 distributions, of which 11 were the tier's build and **none of
   the 20 that make up torch, its NVIDIA libraries and triton**. Those 20 are
   nearly all of an environment's size: 3.08 GB of layers in #1655's
   measurement.
2. **The image was not what was tested.** Of the 116 distributions the lock
   and that day's image both held, **70 were at another version**.
3. **The image missed the workspace's override.** The workspace sets
   `override-dependencies = ["shap>=0.51.0"]`, because econml pins `shap<0.49`
   and, as its comment says, shap before 0.51 cannot read current xgboost
   models. An override belongs to the workspace and is not part of what a
   package publishes, so the image resolved **shap 0.48.0** beside xgboost
   3.2.0, where the lock holds 0.51.0.

## 2. What a user sees

A member that uses torch asks for it through the package's extras, and names
no torch of its own:

```toml
# packages/python/trainer/pyproject.toml
[project]
name = "trainer"
dependencies = [
  "elaraai-east-py-datascience[torch,lightning]",   # not "torch", "pytorch-lightning"
]
```

Its lock then holds the torch its release was tested with, which is the torch
of that release's `py-datascience` image. On a rack that boots such an image,
the member's environment leaves torch to the tier, and its `[ENV]` line says
how much it left:

```
before     [ENV] 3f9a2b1c0d4e built in …: … layers, … (… new), 11 distributions from the tier
pinned     [ENV] 3f9a2b1c0d4e built in …: … layers, … (… new), 31 distributions from the tier
```

The counts are resolved the same way as section 1; the sizes wait on a build.
With the extras pinned a torch member resolves 46 distributions, **31 of them
the tier's build, and 19 of the 20 in torch's family**. What still ships is
the 15 that nothing pins, numpy the largest: aiohttp and four it needs,
filelock, fsspec, idna, markupsafe, numpy, packaging, setuptools, tqdm,
typing-extensions and cuda-pathfinder.

So the pin leaves torch, its NVIDIA libraries and triton to the tier, and what
still ships is small beside them. The release's constraints (3.6) take it to
the project's own code.

**A member that also uses xgboost, on Python 3.11, is helped by one line.**
xgboost 3.2.0 asks for `nvidia-nccl-cu12`, which the tier leaves out (3.2). It
installs into `nvidia/nccl`, as torch's `nvidia-nccl-cu13` does, so the two
ship together, about 0.7 GB installed; the other 14 NVIDIA libraries stay in
the tier ([`e3-environment-over-tier.md`](e3-environment-over-tier.md),
section 7). The exclude of section 3.6 keeps those two there as well, and is
what makes the project's own torch safe to import.

| The project | The rack's tier image | What its environment ships |
|---|---|---|
| Asks for `[torch,lightning]`; the image is of a release with the same pin | Holds that torch | Its own code, and what nothing pins (numpy and the like) |
| The same, and adds the release's constraints (3.6) | Holds every pin | Its own code |
| Asks for `[torch,xgboost]` on Python 3.11, with no exclude | Holds that torch | torch and 14 of its NVIDIA libraries stay in the tier; the two that share `nvidia/nccl` ship |
| The same, with the release's exclude (3.6) | Holds that torch | Its own code, and what nothing pins |
| Lists `torch` itself, any version | Any | Its own torch, whole, as before |
| Asks for the extras; the image is of a release with another pin | Holds another torch | Its own torch, whole: right, and no saving |
| Needs another torch than the release pins | Any | It drops the extras and lists torch: the row above the last |
| Uses no torch | Any | Nothing of torch: #1654 already left it out |

## 3. Design

### 3.1 The extras pin torch and pytorch-lightning exactly

`libs/east-py/packages/east-py-datascience/pyproject.toml`:

```diff
 torch = [
-    "torch>=2.4.0",
+    "torch==2.15.0",
     "cloudpickle>=3.0.0",
 ]
 lightning = [
-    "torch>=2.4.0",
-    "pytorch-lightning>=2.2.0",
+    "torch==2.15.0",
+    "pytorch-lightning==2.6.6",
     "cloudpickle>=3.0.0",
 ]
```

and the same two lines in `all`. torch pins its NVIDIA libraries and triton
exactly, so the one pin fixes all of them.

- **The first pin is the newest**: torch 2.15.0 and pytorch-lightning 2.6.6,
  which is what a project on the extras resolved already. The lock moved to
  them with `uv lock --upgrade-package torch --upgrade-package
  pytorch-lightning`, and nothing else in it moved but what torch brings:
  triton 3.6.0 to 3.9.0, and the NVIDIA libraries from CUDA 12.8 to CUDA 13.
  torch's macOS wheels are now for macOS 14 and later.
- **The pin and the lock are held together** by `scripts/check-version-drift.mjs`,
  which runs on every pull request: the three extras pin both exactly, the
  same in each, at the one version the lock holds.
- **Moving the pin is one pull request**: the pin, and `uv lock`. The
  package's suites then run against the new torch before any release ships
  it.

What it costs, said plainly:

- A project that asks for the extras **and** names another torch no longer
  resolves. It drops the extras and lists torch itself.
- A project on the extras no longer gets a newer torch by locking again: it
  gets one when a release moves the pin.
- A Python the pinned torch has no wheel for cannot install the extras until
  the pin moves.

### 3.2 torch and xgboost share one NCCL library

Moving to torch 2.15.0 opened a fault that the lock had not had.

torch 2.11 and later bring their NCCL library as `nvidia-nccl-cu13`, pinned
exactly. xgboost 3.2.0, the newest that runs on Python 3.11, asks for
`nvidia-nccl-cu12`; xgboost 3.4 asks for `nvidia-nccl-cu13`, and needs Python
3.12. The two distributions install **the same file**,
`nvidia/nccl/lib/libnccl.so.2`. Whichever is installed last wins, and with
xgboost's older one on top, torch does not import:

```
libtorch_cuda.so: undefined symbol: ncclCommResume
```

It failed one run of the package's suites and passed the run before it, on
the same commit.

The workspace leaves xgboost's out (`[tool.uv] exclude-dependencies =
["nvidia-nccl-cu12"]`), so one NCCL library is installed: the one torch pins.
Read from the libraries themselves, this is sound and not only convenient:

| Read from | Found |
|---|---|
| xgboost's `libxgboost.so`, 3.2.0 and 3.4.1 | No `NEEDED` entry for NCCL, and no undefined `nccl*` symbol: it opens `libnccl.so.2` by name when its collective code first needs it (`nccl_stub.cc`), which is training across several GPUs, and asks for NCCL 2.23.4 or later |
| torch's `libnccl.so.2` (cu13, 2.30.7) against xgboost's (cu12, 2.27.5) | Exports 83 functions against 37, every one of the 37 among them |
| Each `libnccl.so.2` | Needs no CUDA library to load |

So importing xgboost, and training on a CPU or on one GPU, never touch NCCL,
and the package's suites run xgboost as before. **Not proved here:** xgboost
training across several GPUs on torch's library. Nothing in this repository
runs it, and no test machine has a GPU; the functions it would call are all
there, at a later version than it asks for.

A project that asks for torch and xgboost on Python 3.11 is in the same
place, and section 3.6 gives it the same line.

### 3.3 Three pin files, exported from the lock

The release's pins are **the workspace's lock, exported**, with the two
settings it was resolved under:

```sh
uv export --frozen --all-packages --all-extras --no-default-groups \
          --no-emit-workspace --no-emit-local --no-header
```

- `east-py-constraints.txt`: every third-party pin of the lock, with hashes
  and platform markers: 205 pins. It covers both python tiers, and anything
  built from a part of them.
- `east-py-overrides.txt`: the workspace's `override-dependencies`.
  `shap>=0.51.0` today.
- `east-py-excludes.txt`: the workspace's `exclude-dependencies`.
  `nvidia-nccl-cu12` today.

`scripts/east-py-constraints.py <workspace> <out>` writes the three, from the
workspace root's `pyproject.toml` and `uv.lock` alone: a frozen export reads
no member's manifest. Each names the release it is of in its first line, and
with `--release <version>` the script refuses a lock that is another
release's.

They are **kept in `@elaraai/e3-core`**, in `tier/`, beside `tier-manifest.py`,
and are committed: nobody edits them, the release's version bump writes them
again of the lock it makes (`scripts/set-python-version.mjs`), and a test
holds them to the lock on every pull request.

This departs from the issue, which proposed `uv pip compile --universal
--generate-hashes` of the released package:

- **A compile at release time is a new resolution that nothing tested.** The
  lock is what the suites ran against.
- **A compile cannot reproduce the lock.** Under the lock's pins alone,
  `elaraai-east-py-datascience[all]` does not resolve: econml 0.16.0 depends
  on `shap>=0.38.1,<0.49.0`. With the override it resolves to the lock
  exactly; and without the exclude it installs both NCCL libraries, 136
  distributions where the lock holds 135 of them.
- It needs no network, and no package to be published first.

The files are named for what they hold, the east-py packages' pins, where the
issue named one for one tier.

### 3.4 The images install under them

`Dockerfile.east-py`, `Dockerfile.east-py-datascience` and `Dockerfile.e3`
copy the three files to `/opt/e3/`, where they stay, and
`install-packages.sh` passes them to each `uv pip install` it runs.

```dockerfile
COPY libs/e3/packages/e3-core/tier/east-py-constraints.txt \
     libs/e3/packages/e3-core/tier/east-py-overrides.txt \
     libs/e3/packages/e3-core/tier/east-py-excludes.txt /opt/e3/
RUN EAST_PY_PINS_DIR=/opt/e3 /tmp/install-packages.sh --py-only
```

So an image holds the lock's build of everything, shap 0.51.0 and one NCCL
library included, and its tier manifest says so. The install script ends by
importing torch and xgboost in one process, so an image in which they do not
load together is not built.

| The build | Installs |
|---|---|
| A version is named (`EAST_PY_VERSION=1.0.110`): a release's images | Under the pins of the checkout it is built from |
| Those pins name another release | Refused, by name: a release's images are built from its own tag |
| `latest`, a local convenience | Unconstrained, as before, and keeps no pins |

### 3.5 The release ships them in a package

The three files and `tier-manifest.py` are files of the release's
`@elaraai/e3-core` (`tier/`), found by the package's name:

```
node_modules/@elaraai/e3-core/tier/tier-manifest.py
node_modules/@elaraai/e3-core/tier/east-py-constraints.txt
node_modules/@elaraai/e3-core/tier/east-py-overrides.txt
node_modules/@elaraai/e3-core/tier/east-py-excludes.txt
```

**An image built elsewhere for a tier**, a GPU guest image say, takes them
from there: its lockfile pins the package, where a release's assets can be
replaced and nothing pins them. It installs with uv under the three, then
writes its manifest:

```sh
uv pip install --constraint east-py-constraints.txt --override east-py-overrides.txt \
               --excludes east-py-excludes.txt "elaraai-east-py-datascience[all]==<release>"
python tier-manifest.py /opt/e3/tier-manifest.json
```

pip takes constraints, and neither overrides nor excludes, so it cannot
install under these.

### 3.6 A project that wants every pin

The extras' pin leaves torch to the tier, which is nearly all of the size.
For the rest, a project puts the release's settings in its workspace root:

```toml
[tool.uv]
exclude-dependencies = ["nvidia-nccl-cu12"]   # with torch and xgboost on Python 3.11: the release's east-py-excludes.txt
override-dependencies = ["shap>=0.51.0"]      # with the causal and shap extras: the release's east-py-overrides.txt
constraint-dependencies = [
  "numpy==2.4.4",
  # … the lines of the release's east-py-constraints.txt it wants held
]
```

The first line is worth having on its own for a project that uses torch and
xgboost on Python 3.11: without it both NCCL libraries are installed, and
which one torch finds depends on the order they were installed in. The second
gives a project that uses the `causal` and `shap` extras together a shap that
reads current xgboost models: without it, it resolves shap 0.48.0.

### 3.7 What says it

- `east-py-datascience`'s README and skill: ask for the extras, not for torch.
- The rack docs' section on environments over a tier: how a project gets the
  saving.
- [`e3-environment-over-tier.md`](e3-environment-over-tier.md) points here.


## 4. What this does not do

- **Pin anything else.** xgboost, pymc and the rest float in a project's
  lock, and ship when they differ from the tier's. Section 3.6 holds them.
- **Write a project's settings for it.** Section 3.6 is by hand. A command
  that writes them from a release could follow, if the by-hand step is used.
- **Change the project template.** It lists the package with no extras, and a
  member that wants torch asks for the extras itself.
- **Fix the override or the exclude for a project's own installs.** Neither
  is published with a package. Section 3.6 documents the lines.
- **Move xgboost.** xgboost 3.4 asks for torch's own NCCL library, and needs
  Python 3.12, which the python images do not have. The exclude does the
  same for the xgboost the images run.

## 5. Decisions (approved 17 Nov 2026)

1. The first pin is the newest torch, 2.15.0, with pytorch-lightning 2.6.6:
   the lock is upgraded to them, and the package's suites prove them (3.1).
2. torch stays at 2.15.0 where it met xgboost's NCCL library: xgboost's is
   left out (3.2).
3. The pins are the lock's export, not a compile at release time, with the
   overrides and the excludes beside them (3.3).
4. One constraints file for both python tiers, named
   `east-py-constraints.txt` (3.3).
5. A named version is built under them; `latest` is not (3.4).
6. They ship in `@elaraai/e3-core`, and not as assets of the release (3.5).
7. The extras' pin is checked against the lock in the version drift check
   (3.1).

## 6. Tests

- The drift check (`scripts/test/extras-pins.test.mjs`): an extra that pins
  another torch than the lock, a range, a wildcard, a marker, two extras that
  disagree, a missing extra, and a lock that holds two versions, each refused
  by name; and this repository's own package and lock pass.
- The script (`scripts/test/east-py-constraints.test.mjs`): the lock's pins
  with their hashes; the workspace's overrides and excludes; the same bytes
  twice, and from the root's manifest and lock alone; a release named as its
  tag names it; another release's refused, and nothing written.
- The files `@elaraai/e3-core` ships are the lock's, now: the two settings to
  the byte, the pins by what they pin, so a later uv that writes them
  otherwise does not fail it.
- The lock holds one NCCL library.
- The image install script, with a `uv` that only says what it was asked: a
  named release is installed under the three files; pins that name another
  release are refused and nothing is installed; `latest` is installed under
  none and keeps none.
- All of these run in `make check-version`, which the version drift workflow
  runs on every pull request. The drift check itself holds each pin file to
  the release it names.
- The release dry-run installs the published `@elaraai/e3-core` and finds the
  four files in it, by the package's name.
- The image test (`docker/tests/check-tier-pins.py`), for a named version:
  every distribution the image's manifest holds that the release pins is at
  a version it pins, it holds one NCCL library, and the datascience image's
  torch is the one its package's extras pin. For every image with the
  datascience package: torch and xgboost import in one process. It runs
  where the image test runs: on a release's tag, or a dispatch of the image
  workflow.
- The package's own suites run against the new torch in the python workflow.

## 7. What building it changed

- **torch 2.15.0 met xgboost's NCCL library** (3.2). The package's suites
  found it, on their second run. It is why there is a third pin file.
- **The pin files are committed, in `@elaraai/e3-core`**, and not written as
  an image is built or a release is made. One copy is what the images
  install under, what the package ships and what a pull request shows: a
  pin that moves is in the diff. The version bump writes them, so a release
  that could not is stopped before anything is published.
- **They ship in a package, not as release assets**: a consumer's lockfile
  pins a package, and nothing pins an asset.
- **The files name their release**, in their first line, and uv's own header
  is left out: it names the directory the export ran in, which would make
  the same lock write different bytes.
- **The members' `dev` extras are in the constraints**, with pytest and the
  like: they hold every extra's pins. A constraint binds only what is
  installed.
- **One loose library kept a whole family**, as environments over a tier
  were first built: xgboost's `nvidia-nccl-cu12` kept all 16 NVIDIA
  distributions, about 3.6 GB. It was found by measuring for this change,
  and is fixed beneath it: the parts of a namespace package are now left to
  the tier singly ([`e3-environment-over-tier.md`](e3-environment-over-tier.md),
  section 7). What is left of it is section 2's xgboost row.
