# Browser demo: agents at work

A small, no-build example of Main → Coder → independent QA → up to two repairs →
human acceptance. A dark workboard sits beside a light expense inbox; switch to
Top / bottom without losing the run. Change the approval threshold, plan, review
the plan, choose **Ready & run**, inspect the candidate/tests, then **Apply tested
change**. Each agent uses a separate conversation on one local Gemma 4 E4B engine.

## Run / publish

```sh
python3 -m http.server 8000 --directory public
# Open http://localhost:8000/demo.html
node --test tests/demo.test.mjs
python3 scripts/check-public.py
```

After merge, choose **Settings → Pages → Source: GitHub Actions**, then manually
run **Publish browser demo** on `main`. It publishes only the demo files and shared
workboard display helpers. It does not deploy the native server, run paid agents,
add CI checks, or publish from a PR. No npm build or API key is required.

Use a desktop browser with WebGPU and enough GPU/RAM and browser storage. **Load
Gemma E4B** explicitly downloads about 3 GB from Hugging Face; weights are cached
in the browser, not GitHub. Cache eviction/quota limits and GPU compatibility can
prevent loading. Reset keeps the model; Stop terminates the worker (reload from
cache afterward). The runtime and model revision are pinned. Network access is
still needed for CDN runtime assets; this is not a guaranteed offline app.

## Scope and trust boundary

Only `evaluateExpense(expense)` is editable. The audience can vary the threshold;
this is not an arbitrary app builder. Integer-cent boundary/paid-state tests and
visible-row checks are host-owned. QA proposes extra inputs, not expected results.
Generated JavaScript executes in QuickJS/WASM with CPU/memory limits and no exposed
host APIs; the main page only renders text/validated results. Approval is bound to
the task revision, plan, threshold and exact source hash. Same-model QA is role
separation, not an independent model or proof of financial correctness.

The demo reuses workboard state names, **not the Rust coordinator**. It mirrors a
bounded subset of its authorization/QA/repair rules, has no native sessions, repo
queues, PRs or merge authority, and cannot connect to a local Codex installation.
The installed Codex path is untouched; a Claude adapter is a separate feature.
Only the latest actual local run is saved for clearly labeled replay; replay cannot
apply changes. Reset restores the seeded app. No fabricated/pre-recorded AI run ships.

## Validation

The Node tests use deterministic role fixtures and execute fixture JavaScript;
they do not establish Gemma quality or hardware compatibility. Before presenting,
run live E4B at two thresholds on the target laptop, check cached reload, Stop,
layout switching, a failing repair, acceptance and replay. Do not label this GPU
validation complete until performed on a compatible device.

References: [LiteRT-LM Web API](https://developers.google.com/edge/litert-lm/js),
[E4B artifact](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm),
[QuickJS](https://github.com/justjake/quickjs-emscripten).
