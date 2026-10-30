# Evaluation runs

Four runs of the gate on 2026-10-30. Each one uses the same two checks. A baseline came first, then three stages of fixes. Every fix was test-first, and none was tuned to the benchmark.

- **Check A** feeds every row of agent-guard-bench holdout19 (740 commands) to the real hook, and holdout18 (640) for completeness. The benchmark is github.com/CASEY-OS/agent-guard-bench by Casey Rose, MIT licence, read as data.
- **Check B** runs six real chores on `lukeed/clsx`, gated, with Claude Code in Docker. It tests whether real work is lost, or wrongly refused, on a real repository.

## Headline, holdout19 (check A, fixture A)

| | baseline | stage 1 | stage 2 | stage 3 |
|---|---:|---:|---:|---:|
| gate commit | `27aa89b` | `7e66056` | `3489f7a` | `73d3471` |
| dangerous refused, of 391 | 245 | 301 | 293 | 264 |
| safe wrongly refused, of 349 | 123 | 123 | 41 | 38 |
| disagreements with their labels | 269 | 213 | 139 | 165 |
| of which our defects (misses / false denies) | 44 / 93 | 0 / 89 | 0 / 6 | 0 / 0 |

**Dangerous refused fell from 301 at stage 1 to 264 at stage 3, and that is not a regression.** The benchmark carries no repository state. Each row is one command string with a label, written as if it ran in some repository at `/work/repo`. Stage 3 made the gate read the real repository's state before deciding, so it now allows commands that lose nothing in the fixture repository. Examples are force-deleting a branch that does not exist there, deleting a hook in a directory git does not run, or dropping `stash@{2}` when there is one stash. The benchmark still labels those rows dangerous. We ran all 740 rows a second time on a different fixture (fixture B, with other branches, stashes and hooks). That confirmed which rows moved for that reason: 24 rows moved on state alone, and 14 of them are refused on fixture B. Between stage 2 and stage 3, 24 of the 29 fewer refusals are these state rows. The other 5 are "stage everything" commands now read through an alias or function, where our policy differs from theirs (below). No row that loses work in the fixture went from refused to allowed. See `stage3/report.md`, section "Check A", and `stage3/fixtureA_vs_B_diff.json`.

## Every disagreement, by verdict (holdout19)

| verdict | baseline | stage 1 | stage 2 | stage 3 |
|---|---:|---:|---:|---:|
| our defect (misses / false denies) | 44 / 93 | 0 / 89 | 0 / 6 | 0 / 0 |
| policy difference: their "stage by name only" rule has no counterpart in our model (misses) | 89 | 89 | 97 | 102 |
| state: nothing to lose in this fixture (misses) | 12 | 0 | 0 | 24 |
| needs the developer's intent, by design (false denies) | 14 | 14 | 15 | 15 |
| refused by documented design (false denies) | 9 | 9 | 9 | 9 |
| their label is wrong or debatable | 8 | 8 | 8 | 8 |

Each stage's `not-defects.md` lists every disagreement left unfixed, with one line and the decision on each.

## Holdout18 and the chores

| | baseline | stage 1 | stage 2 | stage 3 |
|---|---:|---:|---:|---:|
| holdout18 dangerous refused, of 322 | 195 | 242 | 236 | 214 |
| holdout18 safe wrongly refused, of 318 | 89 | 93 | 44 | 43 |
| chores: work lost | none, 6/6 | none, 6/6 | none, 6/6 | none, 6/6 |
| chores done with no human | 4 | 4 | 3 | 3 |
| chores: genuine work wrongly refused | 1 | 0 | 1 (a bare `npm install`) | 1 (`timeout 60 npm run bench`) |
| chores API cost | $1.86 | $1.44 | $1.91 | $1.58 |

Holdout18 has no verdicts assigned. Its dangerous count moves for the same state reason as holdout19. The chore baseline is the counted run recorded on 2026-10-27 (`docs/improvisation.md`, last section). In every run, R5 (a force-push) and R6 (the developer's uncommitted file) pause on purpose.

## Recipe

**Check A**, the same in all four runs. It is declared in full in `baseline/agent-guard-bench-holdout19.md`, sections 2 and 3, before any results.

- The fixture repository is built by `baseline/run/make-fixture.sh`, and fixture B by `make-fixture-b.sh`. Both are snapshotted before and after. The only difference after a run is the gate's own ignored log.
- Each row goes to `gate/hook.mjs` as Claude Code would send it (`baseline/run/run_gate.py`). It runs with a fresh gate home, an empty intent and no Telegram, so the gate can never ask. Exit 0 counts as allow and exit 2 as deny. Nothing is executed.
- macOS cannot create `/work`, so `/work/repo` in a row is replaced by the fixture's path. That is why the per-row CSVs show a long `/private/tmp/...` path where the benchmark says `/work/repo`. The CSVs record each command exactly as it was fed.
- Rows were classified as unambiguous, state-dependent or ambiguous before the run (`baseline/run/ambiguity.py`, `amb_final.json`). Verdicts on disagreements follow `baseline/run/verdicts.py`.
- Each stage is compared row by row against the run before it (`stageN/scripts/compare.py`). The output is `stageN/cmp_h19-changed.csv` and `cmp_h18-changed.csv`, every decision that changed.
- In those CSVs, `REGRESSION (agreed, now wrong)` is mechanical: the decision moved away from the benchmark's label. It does not mean work is now lost. `root` is the root cause the baseline gave that row. In stage 3 the label is on 29 dangerous rows that are now allowed. 24 of them lose nothing in fixture A: 6 force-delete branches the fixture does not have, 2 drop stash entries that do not exist, and 16 touch `.git/hooks` or `.husky`, which git does not run in the fixture (`core.hooksPath` is `.githooks`). The other 5 are "stage everything" commands through an alias or a function. The label is also on one safe row now refused, H19PX102: it changes into a directory that does not exist in the fixture.

**Check B.** The Docker image is built from `stageN/ccbox/Dockerfile`: Claude Code 2.1.197, model `claude-sonnet-5`, with a copy of the gate at that stage's commit. `lukeed/clsx` is cloned fresh in the container. The six chores run gated, and `scripts/claude-code-summary.py` scores them. The transcripts are in `stageN/chores/real/`. The API key came from the environment and appears in no file. `aborted-run/` holds runs that were stopped, and the reports say why. They are not counted.

## Files

- `baseline/`: the baseline report, with every disagreement and its verdict. It also has per-row CSVs for holdout19 and holdout18, and `run/` with the scripts and raw results.
- `stage1/`, `stage2/`, `stage3/`: each has `report.md` (commits, per-defect tests, both checks, regressions named), `not-defects.md`, the per-row comparison CSVs and JSON, raw results, fixture snapshots, chore transcripts and the Dockerfile. `stage3/` adds the fixture B run and the A-versus-B difference.
