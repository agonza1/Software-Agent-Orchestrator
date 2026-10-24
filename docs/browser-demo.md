# Browser demo: the real workboard UI, local Gemma execution

The demo packages the **same `index.html`, `styles.css`, `workboard.js` and
`workboard-model.js` used by the self-hosted app**. A small frame-local transport
adapts its API to a browser workspace. Native UI/Rust files are unchanged; there
is no second simplified board to maintain. The dark official workboard and light
expense application remain visually separate. Both layouts are resizable.

## What works

- **Work:** full task editor, labels/types/owners/priorities, dependencies,
  search/filters, drag Backlog ↔ Ready, details/history, archive/restore/reopen,
  and manual task acceptance.
- **Main:** Gemma generates editable proposals; accept selected proposals with
  dependencies into Backlog. Planning never starts engineering work.
- **System:** add/edit/disable agents, role instructions, default/assigned agents,
  and activity. All agents share Gemma 4 E4B; settings are pinned per run.
- **Execution:** Ready pickup, priority ordering, dependency gates, queue/global
  pause, real Coder/QA calls, protected executed tests, two-repair limit, Stop,
  exact-candidate acceptance, and explicit QA-skip policy (checks still execute).
- **Attention:** blockers and review decisions. Delivery choices mean apply
  locally after checks or wait for human acceptance, never a fabricated PR/merge.
- Candidate/accepted expense previews, before/after source, test evidence,
  workspace export and clearly labeled read-only replay of an actual local run.

This is **UI/workflow parity for the browser-supported subset**, not the Rust
coordinator or a native host in the browser. Only `demo/expense-inbox` and the
`evaluateExpense(expense)` threshold contract execute. Other tasks can be organized
or tracked manually, but arbitrary repositories/web research need self-hosting.
Repository checkout/preparation, GitHub publication, credentials, Codex/Claude
execution and multi-repository parallel workers are not simulated as successes.
Host-only operations are disabled or return an explicit explanation.

## Run / publish

```sh
python3 scripts/build-demo.py /tmp/sao-browser-demo
python3 -m http.server 8000 --directory /tmp/sao-browser-demo
# Open http://localhost:8000
node --test tests/demo*.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_demo_package.py'
python3 scripts/check-public.py
```

After merge, choose **Settings → Pages → Source: GitHub Actions**, then manually
run **Publish browser demo** on `main`. Packaging copies existing UI assets and
changes only the staged entry's loader/relative URLs. No npm build, new dependency,
CI, PR deployment or backend is introduced.

Load Gemma, inspect the seeded Backlog task, then **Mark ready**. It waits in
Review for **Apply tested change locally**. Alternatively choose a threshold and
**Plan this example** to prefill the real Main form. Context contains the explicit
`demo.thresholdCents=<integer>` test contract; keep it aligned with the task's
objective/criteria. Unrelated requests must not be represented as verified by
these expense tests. Choose Manual for non-executable workshop tasks.

## Persistence and trust

The workspace survives reload in **this tab's session storage**, not a shared host
database. Export before closing the tab. Separate tabs do not overwrite each
other. Reload fences interrupted runs; no invisible retry occurs. Reset restores
the seed workspace but retains the model download. Stop unloads the worker;
reloading uses cached weights when available. Pausing only stops new launches.

Generated code stays inside bounded QuickJS/WASM with no exposed host APIs.
Expected results are computed outside it; QA can propose inputs, not edit the
oracle. Same-model QA is role separation, not independent training or proof of
financial correctness. Acceptance is bound to the specification revision, exact
source, and accepted-app version; stale results require a new run. API interception
is scoped to the demo frame, never the installed application's real session.

## Validation still required

Use a WebGPU-capable desktop with sufficient GPU/RAM/storage for the roughly 3 GB
E4B download. Node tests use deterministic role fixtures and execute fixture code;
they do not establish model quality or real GPU/CDN/QuickJS integration. The Python
checks verify packaging contracts using fixture assets, not rendered UI parity.
Before presenting, test the actual shared UI and a live E4B plan/code/QA loop on
the target laptop, including reload, Stop, repair, acceptance and replay.
