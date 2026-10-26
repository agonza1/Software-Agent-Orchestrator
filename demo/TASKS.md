# Local task board

**Tasks** beside the Builder heading opens the official workboard UI as a local,
editable queue. The existing read-only **Developer workboard** link stays unchanged.
This is the useful first slice of superseded PR #5, based on the current full-app
demo rather than its former expense-threshold runtime.

## Workflow

Create tasks with objectives, acceptance criteria, labels, owners, priorities and
prerequisites. Move them between Backlog and Ready, search/filter them, or archive,
restore and reopen completed tasks. Manual tasks are explicitly completed by the
user and never invoke models. App tasks must fit the builder's combined
1,000-character request limit; nothing is silently truncated.

Ready is **not** automatic authorization. Choose **Open in builder**, or **Open
next Ready** to select the highest-priority unblocked app task (FIFO within a
priority, unprioritized last). Only Done prerequisites unblock handoff. The same
existing Planner prepares checks, the user approves its plan, and the existing
Coder/Tester and browser runtime execute the full HTML/CSS/JavaScript change.
Accept the tested candidate in the builder. Only then does its task become Done.
Task counts/stages and the actual run's local hash and check counts are projections,
not an alternative acceptance authority. Logs, model settings, streaming activity,
repair limits and the current sandbox/check implementation are unchanged.

Closing the board does not stop work. Pause handoffs prevents selecting new tasks;
it does not interrupt an active builder run. Stop and Start over remain in the
builder. Start over or editing the builder request detaches the task and returns
it to Backlog at a new revision. An active binding locks its specification and
prerequisites; stale edits and dependency cycles are rejected. No second engine
or execution lane is created.

The task board is included in the existing schema-3 workspace persistence/export.
Older workspaces without it remain valid. Reload never resumes active execution;
an interrupted handoff returns to Backlog. A matching saved plan/review remains
associated with its exact builder identity and scope, subject to the builder's
existing verification/acceptance checks. Malformed board data is preserved for
export rather than silently discarded. Reset demo confirms before clearing the
board, app and saved runs; the downloaded model remains cached. This is local
single-tab organization, not multi-user/cross-tab coordination.

## Deliberately deferred

The official Main/System views explain the current boundary. Multi-task proposal
generation, editable role instructions, automatic queue execution, automatic app
acceptance, QA skipping, research tools, arbitrary repositories and host/GitHub
actions are not enabled. The adapter rejects unsupported routes rather than
simulating a successful connection or merge. Each selected task uses the current
full-app builder's existing planning and human approval flow.

## Packaging and tests

```sh
node scripts/generate-workboard-preview.mjs --check
node scripts/generate-live-workboard.mjs
node scripts/generate-live-workboard.mjs --check
node --test tests/task-queue.test.mjs
python3 tests/task-board-browser.py
```

The live view is derived from the existing generated official preview through
checked transformation anchors. It shares the official stylesheet/model module.
Native `public/`, Rust and the read-only preview are unchanged. Generated live
HTML/JS/manifest are gitignored; the existing Pages workflow adds one generation
step and still publishes only `demo/`, at the same URL. No npm dependencies or
new CI/test workflow are introduced. Run the generator before serving a local
checkout. Regenerate the existing preview first after native UI changes.

`TaskQueue` stores only bounded task metadata and result summaries. The trusted
same-origin official UI frame has a narrow parent bridge, with no HTTP or native
credential fallback. It is not the generated-app security sandbox; that separate
opaque preview and its private runtime channel remain unchanged.

The browser harness uses a synthetic model with the production controller and
UI. Default mode serves the real page/runtime and actual browser checks. Its
explicit `--in-memory` fallback also replaces check/storage/asset transport for
restricted runners; that mode proves UI/queue integration, not deployed CSP,
IndexedDB, actual model inference or security of the existing sandbox.

Before marking the PR ready, run the default browser harness and one real local
Gemma task through Tasks → plan approval → build/QA → acceptance on a desktop.
Check active Stop/Start over, reload and an unmet dependency. Repeat at the Pages
origin after eventual merge. No live GPU or hosted validation is implied by unit
or in-memory test results.
