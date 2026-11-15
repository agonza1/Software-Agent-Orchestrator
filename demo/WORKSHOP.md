# Venture135 presenter tools

These tools make the existing full-app demo easier to explain and inspect. They
use the same Gemma engine, Planner/Coder/Tester conversations, browser checks and
human acceptance flow. They do not add a production deployment, payment action,
repository connection or autonomous release permission.

## 1. Suggestions, not restrictions

Three cards offer business-framed starting points: show expense dates, find
missing receipts, or change a receipt requirement. Clicking a card only fills the
editable request and selects optional preservation checks. It never starts a model.
Users can still request any HTML, CSS or JavaScript change, including a different
application. There is no category router or editable-file allowlist.

**Brief & permissions** lists optional versioned checks for the supplied sample:
amounts/paid history, existing approval decisions, and search/paid filtering.
Uncheck a group when intentionally changing that behavior or replacing the app.
The receipt-policy suggestion does not freeze the old approval policy. The app
never silently removes a selected check: it must pass on the baseline before the
plan can be approved. A stale or incompatible suite asks for a new selection.

**Review change** separates requested outcomes, preserved behavior and additional
runtime checks, with before/after results and a source diff. Check results come
from execution, not the model's description. Diffs use escaped text and a bounded
changed region per file. A green result is not proof of every business requirement.

## 2. Presenter checkpoints and repairs

**Presenter checkpoints** retains up to six snapshots: original app, reviewed
plan, candidate, accepted result or blocked run. Reviewed plans and completed runs
are captured automatically; **Save current checkpoint** captures the original app
or an idle stage manually. The viewer shows each candidate's recorded checks,
source changes and activity. Closing it never stops a live model run.

**Run seeded repair rehearsal** executes a deliberately incomplete date change
and a prepared fix through real browser checks. Both sources are explicit fixtures,
not Gemma output. The UI labels this SEEDED and never applies it to the current
app. Live checkpoints are captured only from actual Live controller state; Guided
and imported records retain their distinct labels. A real repair run can be saved
and replayed after it occurs; no fake model recording is bundled.

Export/import packs are JSON, capped at 2.5 MB, with up to four candidate versions
per checkpoint. Source, plan and check hashes are validated. Hashes establish
consistency, not the truth of a model-provenance claim or imported pass flags.
Every imported checkpoint is labeled IMPORTED and read-only, even after re-export.
It cannot replace the active task, accepted app or acceptance evidence. Import
previews are inert source text until the presenter explicitly opens the recorded
code in a separate restricted sandbox. Import failure leaves existing data intact.

Packs contain source, the project brief and recorded results. Review them for
sensitive information before sharing. Workspace exports also retain these optional
presenter records; legacy schema-3 workspaces without them remain supported.
Malformed saved presenter data is preserved for export, not silently discarded.

## 3. Shared brief and human refinement

Edit the project brief (up to 2,000 characters) for the application being built.
Saving changes invalidates any current plan/candidate. The reviewed version is
frozen into the plan hash and appended to every role's prompt. An empty brief is
allowed. This is shared context, not automatic learning from previous runs.

Before approving a Live plan, **Request plan revision** supplies feedback to
Planner. It creates a new reviewed plan, retains the previous summary/hash and
feedback, and never starts Coder. Up to three human revisions are allowed. Every
revision requires explicit plan approval again. Interrupted context preparation,
changed preservation definitions and stale results cannot authorize a build or
acceptance. Original bounded repair limits and exact-candidate verification stay
in the existing controller.

## 4. Permissions and presentation

New workshop tasks default to **Blocked · self-contained workshop**. A separate
preview entry sets CSP before generated code executes: external fetch/XHR and
external script/image/style/font/media loads are blocked; workers and nested
frames are disabled. The same policy applies to baseline checks, candidate checks,
visible previews and acceptance verification. Selected permissions are part of
the reviewed plan. The existing opaque iframe/private-channel isolation remains.

**Allow public HTTPS resources** explicitly selects the previous standard preview
policy for custom requests that need a public library or API. Saving permissions
restarts the visible accepted preview with that policy and requires a new plan.
Old local runs without workshop metadata retain their original standard policy.
Imported and seeded replay previews always use the restricted policy.

The host still needs network access to download Gemma and runtime assets. Restricted
preview mode is not an air gap: the trusted same-site harness must load, and CSP
is not a complete navigation/process-isolation guarantee. Existing navigation
monitoring remains; an infinite JavaScript loop may still freeze a shared browser
renderer. No backend credentials or real accounts are supplied. The Tester uses
the same model in a separate conversation, not an independently trained reviewer.

**Presentation view** increases text size and highlights the current role/action.
It changes neither execution nor permission state. Suggestions disappear while a
task is being reviewed or executed, and reappear after Start over. Detail/replay
modals support Escape and focus return; the two-pane and stacked layouts remain.

## Implementation and validation

- `workshop-contract.mjs`: versioned brief, optional preservation groups, context,
  evidence grouping and source diff.
- `workshop-controller.mjs`: wraps the current controller; adds reviewed context,
  plan revisions and preservation validation without a second engine.
- `workshop-pack.mjs`: bounded source-bound checkpoint data and seeded rehearsal.
- `workshop-ui.mjs` / `workshop.css`: suggestions, review, context, replay and
  presentation controls; optional persistence fields.
- `preview/restricted.html`: restrictive child CSP selected by `page-runtime.mjs`.

```sh
node --test tests/workshop.test.mjs
python3 tests/workshop-browser.py
# Restricted environments only; see the explicit evidence limits below:
python3 tests/workshop-browser.py --in-memory
```

The unit tests use deterministic model/executor fixtures. The default browser
harness serves real files and uses a synthetic model with the production DOM
runtime. Its explicit in-memory mode also adapts module/iframe asset transport,
crypto and storage; it still runs the production controller, DOM assertion harness
and child CSP in Chromium. Neither mode proves Gemma quality or GPU compatibility.

Before release, run the existing full test suite and default browser harness on a
normal desktop. Run one real Gemma task with a revised plan and selected preservation
checks; verify cancellation, reload, free-form changes and pack import. Rehearse a
real captured repair or the clearly labeled seeded example. Repeat the smoke test
at the intended AgilityFeat Pages origin after eventual merge. This change does
not alter the publishing workflow or deploy itself.
