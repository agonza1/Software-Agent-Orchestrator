import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { DemoStore, example, KEY } from '../public/demo-store.mjs';
const good = `function evaluateExpense(e){return {status:e.status==='paid'?'paid':e.amountCents>50000?'review':'eligible',reason:'Approval policy'}}`;
const qa = '{"approved":true,"findings":[],"cases":[]}';
const evaluate = async (source, inputs) => inputs.map(input => ({ value: JSON.parse(runInNewContext(`JSON.stringify((${source})(${JSON.stringify(input)}))`, {}, { timeout: 100 })) }));
const memory = () => { const map = new Map(); return { getItem: k => map.get(k), setItem: (k,v) => map.set(k,v) }; };
function fixture(options = {}) { return new DemoStore({ storage: memory(), ask: async role => role === 'Coder' ? good : qa, evaluate, ...options }); }
const tick = () => new Promise(resolve => setImmediate(resolve));
async function idle(store) { await tick(); for (let i = 0; i < 100 && store.busy; i++) await tick(); assert.equal(store.busy, null); }
async function ready(store, task = store.state.tasks[0], changes = {}) {
  await store.request(`/tasks/${task.id}`, 'PATCH', { expected_revision: task.revision, status: 'ready', automation_policy: 'ready_to_done', ...changes });
  store.setReady(true); await idle(store); return task;
}
async function accept(store, task) { return store.request(`/tasks/${task.id}/accept`, 'POST', { expected_revision: task.revision }); }

test('official session/snapshot contract exposes all board views without model or credentials', async () => {
  const store = fixture(), session = await store.request('/session'), snap = await store.request('/snapshot');
  assert.equal(session.authenticated, true); assert.equal(session.login_method, 'browser-demo');
  assert.equal(snap.capabilities.write, true); assert.equal(snap.capabilities.run, false); assert.equal(snap.capabilities.planning, false);
  assert.equal(snap.system.agents.length, 3); assert.equal(snap.projects.length, 1); assert.equal(snap.runs.length, 0);
  assert.equal(snap.tasks[0].status, 'backlog');
});
test('real task editing accepts labels, owner, priority and workflow metadata; revisions conflict', async () => {
  const s = fixture(), t = s.state.tasks[0];
  await s.request(`/tasks/${t.id}`, 'PATCH', { expected_revision: 1, title: 'New title', labels: ['finance'], owner: 'Main', priority: 1 });
  assert.equal(t.revision, 2); assert.deepEqual(t.labels, ['finance']); assert.equal(t.priority, 1);
  await assert.rejects(s.request(`/tasks/${t.id}`, 'PATCH', { expected_revision: 1, title: 'Lost edit' }), { code: 'revision_conflict' });
});
test('manual completion, archive/restore, reopen and task history persist across reload', async () => {
  const storage = memory(), s = fixture({ storage });
  const { task } = await s.request('/tasks', 'POST', { ...example(), workflow: 'manual', automation_policy: 'manual' });
  await accept(s, task);
  await s.request(`/tasks/${task.id}/archive`, 'POST', { expected_revision: 1 });
  assert.ok(s.task(task.id).archived_at);
  const restored = fixture({ storage }); assert.ok(restored.task(task.id).archived_at);
  await restored.request(`/tasks/${task.id}/restore`, 'POST', { expected_revision: 1 });
  await restored.request(`/tasks/${task.id}/reopen`, 'POST', { expected_revision: 1 });
  assert.equal(restored.task(task.id).status, 'backlog'); assert.equal(restored.task(task.id).revision, 2);
  assert.equal(restored.task(task.id).automation_revision, null);
  const detail = await restored.request(`/tasks/${task.id}`); assert.ok(detail.events.some(e => e.type === 'task.archive'));
});
test('idempotency returns the original create receipt without duplicating tasks; key reuse is rejected', async () => {
  const s = fixture(), body = { ...example(), title: 'Repeated task' };
  const a = await s.request('/tasks', 'POST', body, 'same'), b = await s.request('/tasks', 'POST', body, 'same');
  assert.equal(a.task.id, b.task.id); assert.equal(s.state.tasks.length, 2);
  await assert.rejects(s.request('/tasks', 'POST', { ...body, title: 'Different' }, 'same'), { code: 'revision_conflict' });
});
test('dependency cycles are rejected atomically', async () => {
  const s = fixture(), a = s.state.tasks[0];
  const { task: b } = await s.request('/tasks', 'POST', { ...example(), dependencies: [a.id] });
  await assert.rejects(s.request(`/tasks/${a.id}`, 'PATCH', { expected_revision: 1, dependencies: [b.id] }), { code: 'dependency_cycle' });
  assert.deepEqual(a.dependencies, []); assert.equal(a.revision, 1);
});
test('Ready auto-pickup waits for Done dependencies; only one model task runs at a time', async () => {
  const s = fixture(), t = s.state.tasks[0];
  const { task: dep } = await s.request('/tasks', 'POST', { ...example(), workflow: 'manual', automation_policy: 'manual' });
  await ready(s, t, { dependencies: [dep.id] }); assert.equal(s.state.runs.length, 0);
  assert.equal(s.snapshot().tasks[0].dependency_blockers[0].id, dep.id);
  await accept(s, dep); await idle(s); assert.equal(t.status, 'review'); assert.equal(s.state.runs.length, 1);
});
test('priority orders eligible tickets; global and repository pause prevent launches', async () => {
  const order = [], s = fixture({ ask: async (role,prompt) => { if (role === 'Coder') order.push(prompt.includes('urgent-ticket') ? 'urgent' : 'normal'); return role === 'Coder' ? good : qa; } });
  await s.request('/execution/pause', 'POST', { paused: true });
  await ready(s); await s.request('/tasks', 'POST', { ...example(), title: 'urgent-ticket', priority: 1, status: 'ready' });
  assert.equal(s.state.runs.length, 0);
  await s.request('/projects/browser', 'PATCH', { expected_revision: 1, paused: true });
  await s.request('/execution/pause', 'POST', { paused: false }); await tick(); assert.equal(s.state.runs.length, 0);
  await s.request('/projects/browser', 'PATCH', { expected_revision: 2, paused: false }); await idle(s);
  assert.deepEqual(order, ['urgent', 'normal']);
});
test('manual delivery requires exact tested candidate; auto delivery applies locally', async () => {
  const s = fixture(), t = await ready(s);
  assert.equal(t.status, 'review'); assert.equal(s.state.accepted.version, 0);
  assert.equal(s.state.runs[0].receipt.tests.every(t => t.pass), true);
  await accept(s, t); assert.equal(t.status, 'done'); assert.equal(s.state.accepted.version, 1);
  await s.request('/tasks', 'POST', { ...example(), merge_policy: 'auto', status: 'ready' }); await idle(s);
  assert.equal(s.state.accepted.version, 2); assert.equal(s.state.tasks.at(-1).status, 'done');
  assert.equal(s.state.runs.some(r => r.head_sha || r.github_url), false);
});
test('a second accepted version invalidates an older unaccepted result', async () => {
  const s = fixture(), first = await ready(s);
  const { task: second } = await s.request('/tasks', 'POST', { ...example(), status: 'ready' }); await idle(s);
  await accept(s, second);
  await assert.rejects(accept(s, first), { code: 'stale_revision' }); assert.equal(first.status, 'review');
});
test('editing any specification field invalidates prior acceptance', async () => {
  const s = fixture(), t = await ready(s);
  await s.request(`/tasks/${t.id}`, 'PATCH', { expected_revision: t.revision, objective: 'A changed requirement' });
  await assert.rejects(accept(s, t), { code: 'stale_revision' });
});
test('explicit QA skip omits the QA call but never skips protected executed tests', async () => {
  const roles = [], s = fixture({ ask: async role => { roles.push(role); return good; } });
  const t = await ready(s, undefined, { qa_policy: 'skip' });
  assert.deepEqual(roles, ['Coder']); assert.equal(s.state.runs[0].receipt.qa_status, 'skipped');
  assert.equal(s.state.runs[0].receipt.tests.length, 10); assert.equal(t.status, 'review');
});
test('agent settings/defaults are editable, validated and pinned to each run', async () => {
  let release; const gate = new Promise(r => release = r), prompts = [];
  const s = fixture({ ask: async (role, prompt) => { prompts.push(prompt); if (role === 'Coder') await gate; return role === 'Coder' ? good : qa; } });
  const agents = structuredClone(s.state.system.agents); agents[1].instructions = 'Pinned instructions';
  await s.request('/system/agents', 'PUT', { expected_revision: 1, agents, defaults: s.state.system.defaults });
  const t = s.state.tasks[0]; s.setReady(true); await s.request(`/tasks/${t.id}`, 'PATCH', { expected_revision: 1, status: 'ready', automation_policy: 'ready_to_done' });
  const updated = structuredClone(agents); updated[1].instructions = 'New future instructions';
  await s.request('/system/agents', 'PUT', { expected_revision: 2, agents: updated, defaults: s.state.system.defaults });
  assert.equal(s.state.runs[0].agents.coder.instructions, 'Pinned instructions');
  await assert.rejects(s.request(`/tasks/${t.id}`, 'PATCH', { expected_revision: t.revision, title: 'Unsafe edit' }), { code: 'task_has_active_run' });
  release(); await idle(s); assert.match(prompts[0], /Pinned instructions/);
});
test('unsupported model/provider and missing default agents are rejected', async () => {
  const s = fixture(), agents = structuredClone(s.state.system.agents); agents[0].model = 'Other provider';
  await assert.rejects(s.request('/system/agents', 'PUT', { expected_revision: 1, agents, defaults: s.state.system.defaults }), { code: 'invalid_agents' });
  assert.equal(s.state.system.revision, 1);
});
test('unsupported repository scope is visible as a blocker, never a simulated success', async () => {
  const s = fixture(); const t = await ready(s, undefined, { repository: 'sample/other' });
  assert.equal(s.state.runs.length, 0); assert.match(t.blocked_reason, /self-hosted/);
  await assert.rejects(s.request('/projects/browser', 'PATCH', { expected_revision: 1, reconnect: true }), { code: 'demo_host_only' });
});
test('stop confirms worker termination, ignores late model output, and does not auto-retry', async () => {
  let release, stops = 0; const gate = new Promise(r => release = r);
  const s = fixture({ ask: async () => gate, stop: () => stops++ });
  s.setReady(true); const t = s.state.tasks[0];
  await s.request(`/tasks/${t.id}`, 'PATCH', { expected_revision: 1, status: 'ready', automation_policy: 'ready_to_done' });
  assert.ok(s.busy); await s.request(`/runs/${s.state.runs[0].id}/cancel`, 'POST');
  release(good); await tick();
  assert.equal(stops, 1); assert.equal(s.state.runs[0].status, 'cancelled'); assert.equal(s.state.accepted.version, 0);
  s.setReady(true); await tick(); assert.equal(s.state.runs.length, 1);
});
test('page reload preserves work but fences interrupted runs', async () => {
  const storage = memory(), s = fixture({ storage, ask: async () => new Promise(() => {}) });
  s.setReady(true); const t = s.state.tasks[0]; await s.request(`/tasks/${t.id}`, 'PATCH', { expected_revision: 1, status: 'ready', automation_policy: 'ready_to_done' });
  const restarted = fixture({ storage }); restarted.setReady(true); await tick();
  assert.equal(restarted.state.runs.length, 1); assert.equal(restarted.state.runs[0].status, 'failed'); assert.equal(restarted.task(t.id).automation_revision, null);
  assert.match(restarted.task(t.id).blocked_reason, /reload/); s.cancel();
});
test('planning invokes Main and creates editable proposals without running them', async () => {
  const proposal = { title: 'Expense policy', objective: example().objective, acceptance_criteria: example().acceptance_criteria, task_type: 'feature', priority: 3, labels: ['goal'], depends_on: [] };
  const s = fixture({ ask: async role => { assert.equal(role, 'Main'); return JSON.stringify({ summary: 'One scoped improvement', proposals: [proposal] }); } });
  s.setReady(true); const data = example();
  await s.request('/plans', 'POST', { goal: data.objective, project: data.project, repository: data.repository, context: data.context.join('\n') }); await idle(s);
  const plan = s.state.plans[0]; assert.equal(plan.status, 'proposed'); assert.equal(s.state.runs.length, 0);
  await s.request(`/plans/${plan.id}/accept`, 'POST', { expected_revision: 1, selected: [{ proposal_id: plan.proposals[0].proposal_id, qa_policy: 'required', proposal: { ...proposal, title: 'Human edited title' } }] });
  assert.equal(s.state.tasks.at(-1).title, 'Human edited title'); assert.equal(s.state.tasks.at(-1).status, 'backlog'); assert.equal(s.state.runs.length, 0);
});
test('unselected proposal prerequisites reject acceptance without partially creating tasks', async () => {
  const p = { title: 'A', objective: 'Small task', acceptance_criteria: ['Pass'], priority: 3, task_type: 'feature', labels: [], depends_on: [] };
  const s = fixture({ ask: async () => JSON.stringify({ summary: 'Two tasks', proposals: [p, { ...p, title: 'B', depends_on: [0] }] }) }); s.setReady(true);
  await s.request('/plans', 'POST', { goal: 'Goal', project: 'Project' }); await idle(s); const plan = s.state.plans[0];
  await assert.rejects(s.request(`/plans/${plan.id}/accept`, 'POST', { expected_revision: 1, selected: [{ proposal_id: plan.proposals[1].proposal_id, qa_policy: 'required', proposal: { ...p, depends_on: [0] } }] }), { code: 'planning_dependency_unselected' });
  assert.equal(s.state.tasks.length, 1); assert.equal(plan.status, 'proposed');
});
test('replay is read-only and cannot start, apply or alter the saved workspace', async () => {
  const s = fixture(), t = await ready(s), saved = s.storage.getItem(KEY); s.replay(s.state.runs[0].id);
  assert.equal(s.snapshot().capabilities.write, false);
  await assert.rejects(accept(s, t), { code: 'forbidden' }); await assert.rejects(s.request('/tasks', 'POST', example()), { code: 'forbidden' });
  assert.equal(s.storage.getItem(KEY), saved); s.endReplay(); await accept(s, t); assert.equal(t.status, 'done');
});
test('reset restores seed tasks/app and retains the loaded model', async () => {
  const s = fixture(), t = await ready(s); await accept(s, t); s.reset();
  assert.equal(s.state.runs.length, 0); assert.equal(s.state.tasks.length, 1); assert.equal(s.state.accepted.version, 0); assert.equal(s.ready, true);
});
