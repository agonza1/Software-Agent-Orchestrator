import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { BASE, expenses, thresholdCents, cases, check, review, fingerprint, canAccept, runTask } from '../public/demo-core.mjs';
const task = { id: 'synthetic-task', threshold: 50000, plan: 'Implement the rule and verify boundaries.', base: BASE };
const good = `function evaluateExpense(e) { return { status: e.status === 'paid' ? 'paid' : e.amountCents > 50000 ? 'review' : 'eligible', reason: 'Approval policy' }; }`;
const bad = good.replace('> 50000', '>= 50000');
const qa = JSON.stringify({ approved: true, findings: [], cases: [{ amountCents: 0, status: 'submitted' }] });
// Deterministic agent fixtures, not model quality tests. Generated fixture code really executes.
const evaluate = async (source, inputs) => inputs.map(input => {
  try { return { value: JSON.parse(runInNewContext(`JSON.stringify((${source})(${JSON.stringify(input)}))`, {}, { timeout: 100 })) }; }
  catch (error) { return { error: error.message }; }
});
const run = (ask, emit = () => {}, signal) => runTask(task, ask, evaluate, emit, signal);

test('threshold parsing is exact in cents and rejects unsupported requests', () => {
  for (const [input, expected] of [['500', 50000], ['500.01', 50001], ['0.01', 1], ['100000', 10000000]]) assert.equal(thresholdCents(input), expected);
  for (const input of ['', '0', '-1', '1e3', '0.001', '100000.01', 'NaN', '500;alert(1)']) assert.throws(() => thresholdCents(input));
});
test('protected cases cover exact boundary, paid status and every visible expense', () => {
  const required = cases(task.threshold);
  assert.deepEqual(required.slice(0, 3).map(c => c.input.amountCents), [49999, 50000, 50001]);
  assert.equal(required[4].expected, 'paid');
  assert.equal(required.length, 5 + expenses.length);
  assert.equal(cases(1)[0].input.amountCents, 0);
});
test('first-time success still executes Coder and independent QA', async () => {
  const roles = [], events = [];
  const receipt = await run(async role => { roles.push(role); return role === 'Coder' ? good : qa; }, e => events.push(e));
  assert.deepEqual(roles, ['Coder', 'QA']);
  assert.equal(receipt.attempt, 0); assert.equal(receipt.tests.length, 11);
  assert.equal(await canAccept(task, receipt), true);
  assert.equal(receipt.rows[0].value.status, 'review');
  assert.equal(receipt.rows[4].value.status, 'paid');
  assert.equal(events.at(-1).receipt.hash, await fingerprint(task, good));
});
test('false model approval cannot override a failed boundary check; repairs get real evidence', async () => {
  let calls = 0;
  const receipt = await run(async (role, prompt) => {
    if (role === 'QA') return qa;
    calls++;
    if (calls > 1) assert.match(prompt, /"actual":"review"/);
    return calls === 1 ? bad : good;
  });
  assert.equal(calls, 2); assert.equal(receipt.attempt, 1);
});
test('repair budget is initial attempt plus at most two repairs', async () => {
  let calls = 0;
  await assert.rejects(run(async role => role === 'Coder' ? (++calls, bad) : qa), /Two repairs used/);
  assert.equal(calls, 3);
});
test('malformed QA fails closed and remains bounded', async () => {
  let calls = 0;
  await assert.rejects(run(async role => role === 'Coder' ? (++calls, good) : 'LGTM'), /Two repairs used/);
  assert.equal(calls, 3);
});
test('QA cannot supply expected outcomes or change protected tests', () => {
  assert.throws(() => review('{"approved":"yes","findings":[],"cases":[]}'));
  assert.throws(() => review('{"approved":true,"findings":[],"cases":[{"amountCents":-1,"status":"paid"}]}'));
  const extra = review('{"approved":true,"findings":[],"cases":[{"amountCents":90000,"status":"submitted","expected":"eligible"}]}');
  assert.equal(cases(50000, extra.cases).at(-1).expected, 'review');
});
test('missing output or review reason cannot pass', () => {
  const c = cases(task.threshold);
  assert.equal(check(c, []).some(t => t.pass), false);
  const result = check([c[2]], [{ value: { status: 'review', reason: '' } }]);
  assert.equal(result[0].pass, false);
});
test('source, task revision or acceptance-criteria changes invalidate approval', async () => {
  const receipt = await run(async role => role === 'Coder' ? good : qa);
  assert.equal(await canAccept(task, { ...receipt, source: bad }), false);
  assert.equal(await canAccept({ ...task, id: 'new-revision' }, receipt), false);
  assert.equal(await canAccept({ ...task, threshold: 100000 }, receipt), false);
  assert.equal(await canAccept({ ...task, plan: 'Changed scope' }, receipt), false);
  assert.equal(await canAccept(task, { ...receipt, tests: [] }), false);
});
test('cancellation after a model response does not produce test evidence or approval', async () => {
  const controller = new AbortController(), events = [];
  await assert.rejects(run(async () => { controller.abort(Error('Stopped')); return good; }, e => events.push(e), controller.signal), /Stopped/);
  assert.equal(events.length, 1); assert.equal(events.some(e => e.receipt), false);
});
test('generated code stays out of the UI realm; the official workboard is imported', async () => {
  const ui = await readFile(new URL('../public/demo.mjs', import.meta.url), 'utf8');
  const bridge = await readFile(new URL('../public/demo-board.mjs', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../public/demo-worker.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(ui + bridge, /new Function|\beval\(|innerHTML/);
  assert.match(bridge, /await import\('\.\/workboard.js'\)/);
  assert.match(worker, /gemma-4-E4B-it-web\.litertlm/);
  assert.match(worker, /memoryLimitBytes/); assert.match(worker, /shouldInterrupt/);
});
