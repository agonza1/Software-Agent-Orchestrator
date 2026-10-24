// Implements the official UI's API contract locally; never contacts a native host.
import { BASE, expenses, objective, unFence, runTask, canAccept } from './demo-core.mjs';
export const REPO = 'demo/expense-inbox', KEY = 'sao-browser-workspace-v2';
const now = () => new Date().toISOString(), id = () => crypto.randomUUID();
const copy = value => structuredClone(value);
const fail = (code, message = code, status = 400) => { throw Object.assign(Error(message), { code, status }); };
const live = run => ['queued', 'running'].includes(run.status);
const text = (value, limit = 4000) => typeof value === 'string' && value.length <= limit;
const strings = (value, limit = 40) => Array.isArray(value) && value.length <= limit && value.every(v => text(v));
const fields = ['title', 'objective', 'acceptance_criteria', 'context', 'task_type', 'priority', 'labels', 'dependencies', 'project', 'owner', 'criticality', 'workflow', 'repository', 'coding_agent_id', 'qa_policy', 'merge_policy', 'automation_policy', 'blocked_reason', 'github_issue_url', 'github_pull_request_url'];
export function example(threshold = 50000) {
  return { title: 'Route large expenses to a manager', objective: objective(threshold),
    acceptance_criteria: ['At/below threshold stays eligible', 'Above threshold needs review and an explanation', 'Paid expenses remain paid'],
    context: [`demo.thresholdCents=${threshold}`, 'Browser example: only evaluateExpense(expense) is editable.'],
    project: 'V135 Spend', repository: REPO, owner: 'Coder', workflow: 'engineering', task_type: 'feature', priority: 3,
    labels: ['workshop'], dependencies: [], qa_policy: 'required', merge_policy: 'manual', automation_policy: 'ready_to_done', coding_agent_id: 'coder' };
}
function initial() {
  return { version: 2, watermark: 0, tasks: [], runs: [], plans: [], events: [], paused: false,
    project: { id: 'browser', name: 'V135 Spend', repository: REPO, revision: 1, paused: false, runtime_status: 'ready', validation_summary: 'Browser sandbox · protected expense checks', default_branch: 'local' },
    system: { revision: 1, editable: true, defaults: { main: 'main', coder: 'coder', qa: 'qa' },
      agents: ['main', 'coder', 'qa'].map(role => ({ id: role, label: role === 'qa' ? 'QA' : role[0].toUpperCase() + role.slice(1), role, model: 'Gemma 4 E4B', enabled: true, instructions: '' })) },
    accepted: { source: BASE, version: 0, rows: expenses.map(e => ({ value: { status: e.status === 'paid' ? 'paid' : 'eligible', reason: '' } })) } };
}
export class DemoStore {
  constructor({ storage, ask, evaluate, stop = () => {}, changed = () => {} }) {
    Object.assign(this, { storage, ask, evaluate, stopWorker: stop, changed });
    this.state = initial(); this.ready = false; this.busy = null; this.readOnly = false; this.listeners = new Set(); this.commands = new Map(); this.tail = Promise.resolve();
    try {
      const raw = storage?.getItem(KEY), data = raw && JSON.parse(raw);
      if (raw?.length < 4000000 && data?.version === 2 && ['tasks', 'runs', 'plans', 'events'].every(k => Array.isArray(data[k])) && data.system && data.project && data.accepted) this.state = data;
    } catch { /* Storage is optional, not permission to fake a recovered execution. */ }
    for (const run of this.state.runs.filter(live)) {
      Object.assign(run, { status: 'failed', reason: 'restart_requires_reconciliation' });
      const task = this.task(run.task_id); if (task) Object.assign(task, { status: 'review', automation_revision: null, blocked_reason: 'Interrupted by reload. Review the evidence, then edit or retry deliberately.' });
    }
    for (const plan of this.state.plans.filter(p => ['generating', 'queued'].includes(p.status))) plan.status = 'unknown';
    if (!this.state.tasks.length) this.create(example());
    this.save();
  }
  task(key) { return this.state.tasks.find(t => t.id === key); }
  run(key) { return this.state.runs.find(r => r.id === key); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  save() { try { this.storage?.setItem(KEY, JSON.stringify(this.state)); } catch { this.storageWarning = 'Browser storage unavailable; export the workspace before leaving.'; } }
  publish(type = 'workspace.updated', task, run, summary = type) {
    this.state.events.push({ cursor: ++this.state.watermark, type, task_id: task?.id, run_id: run?.id, task_revision: task?.revision, stage: run?.stage, status: run?.status, at: now(), summary });
    this.state.events = this.state.events.slice(-300); this.save(); this.signal();
    queueMicrotask(() => this.pump());
  }
  signal() { this.changed(this); for (const fn of this.listeners) fn({ cursor: this.state.watermark }); }
  setReady(value) { this.ready = value; this.signal(); queueMicrotask(() => this.pump()); }
  snapshot() {
    const data = copy(this.view || this.state), enabled = this.ready && !data.paused && !this.busy && !this.readOnly;
    data.tasks.forEach(t => { t.dependency_blockers = (t.dependencies || []).map(key => data.tasks.find(d => d.id === key)).filter(d => d && d.status !== 'done').map(d => ({ id: d.id, title: d.title })); });
    return { ...data, projects: [{ ...data.project, lane_run_id: this.busy?.run?.id || null }],
      execution: { approved: true, paused: data.paused, lane_run_id: this.busy?.run?.id || null },
      coding_agents: { default_coder: data.system.defaults.coder, agents: data.system.agents.filter(a => a.role === 'coder' && a.enabled) },
      capabilities: { write: !this.readOnly, accept: !this.readOnly, cancel: !this.readOnly, stop: !this.readOnly, projects: true, ready_to_done: true, planning: enabled, run: enabled && !data.project.paused, paused: data.paused,
        execution_state: !this.ready ? 'unavailable' : this.busy ? 'busy' : 'ready' }, execution_activity: { state: 'available', tasks: {} } };
  }
  validate(task, all = this.state.tasks) {
    if (!text(task.title, 240) || !task.title.trim() || !text(task.objective) || !task.objective.trim() || !strings(task.acceptance_criteria) || !strings(task.context) || !strings(task.labels, 12) || !strings(task.dependencies, 100) || !Number.isInteger(task.priority) || task.priority < 0 || task.priority > 4 || !['manual', 'engineering'].includes(task.workflow) || !['feature', 'bug', 'improvement', 'chore', 'research'].includes(task.task_type) || !['required', 'skip'].includes(task.qa_policy) || !['manual', 'auto'].includes(task.merge_policy) || !['manual', 'ready_to_done'].includes(task.automation_policy)) fail('invalid_task_text');
    if (JSON.stringify(task).length > 16000) fail('task_too_large');
    if (new Set(task.dependencies).size !== task.dependencies.length || task.dependencies.some(key => !all.some(t => t.id === key))) fail('dependency_not_found');
    const visit = (key, path = new Set()) => {
      if (path.has(key)) fail('dependency_cycle');
      const item = key === task.id ? task : all.find(t => t.id === key);
      for (const dep of item?.dependencies || []) visit(dep, new Set([...path, key]));
    };
    visit(task.id);
  }
  create(body, insert = true) {
    const task = { ...example(), ...Object.fromEntries(fields.filter(k => body[k] !== undefined).map(k => [k, copy(body[k])])),
      id: id(), revision: 1, status: body.status || 'backlog', created_at: now(), updated_at: now() };
    if (!['backlog', 'ready'].includes(task.status)) fail('invalid_task_text');
    this.validate(task);
    task.automation_revision = task.automation_policy === 'ready_to_done' ? task.revision : null;
    if (task.status === 'ready') task.ready_at = now();
    if (insert) this.state.tasks.push(task);
    return task;
  }
  revision(item, body) { if (!item) fail('not_found', 'Not found', 404); if (item.revision !== body.expected_revision) fail('revision_conflict', 'Refresh the changed record.', 409); }
  unlocked(task) { if (this.state.runs.some(r => r.task_id === task.id && live(r))) fail('task_has_active_run'); }
  agent(role, chosen) {
    const a = this.state.system.agents.find(a => a.id === (chosen || this.state.system.defaults[role]) && a.role === role && a.enabled);
    if (!a) fail('agent_unavailable'); return copy(a);
  }
  threshold(task) {
    const matches = task.context.filter(c => /^demo\.thresholdCents=\d+$/.test(c));
    const value = Number(matches[0]?.split('=')[1]);
    if (task.task_type === 'research' || task.repository !== REPO || matches.length !== 1 || !Number.isSafeInteger(value) || value < 1 || value > 10000000) fail('demo_scope', 'Browser execution supports the expense-threshold example only. Keep one demo.thresholdCents=<integer> context entry and demo/expense-inbox, or use Manual tracking. Other repositories/research require the self-hosted app.');
    return value;
  }
  request(path, method = 'GET', body = {}, key) {
    const perform = async () => {
      if (method !== 'GET' && this.readOnly) fail('forbidden', 'Recorded view is read-only.', 403);
      const identity = `${method} ${path} ${JSON.stringify(body)}`;
      if (key && this.commands.has(key)) { const previous = this.commands.get(key); if (previous.identity !== identity) fail('revision_conflict'); return copy(previous.result); }
      const result = await this.route(path.split('?')[0], method, body);
      if (method !== 'GET') { this.publish(); if (key) { this.commands.set(key, { identity, result: copy(result) }); if (this.commands.size > 100) this.commands.delete(this.commands.keys().next().value); } }
      return copy(result);
    };
    if (method === 'GET') return perform();
    const result = this.tail.then(perform); this.tail = result.catch(() => {}); return result;
  }
  async route(path, method, body) {
    if (path === '/session' && method === 'GET') return { authenticated: true, login_method: 'browser-demo', identity: 'Local demo · no host session', capabilities: this.snapshot().capabilities };
    if (path === '/snapshot' && method === 'GET') return this.snapshot();
    if (path === '/execution/pause' && method === 'POST') { this.state.paused = body.paused === true; return {}; }
    if (path === '/tasks' && method === 'POST') { if (this.state.tasks.length >= 100) fail('task_too_large'); const task = this.create(body); this.publish('task.created', task); return { task }; }
    if (path === '/system/agents' && method === 'PUT') {
      this.revision(this.state.system, body);
      if (!Array.isArray(body.agents) || body.agents.length > 12 || new Set(body.agents.map(a => a.id)).size !== body.agents.length || body.agents.some(a => !/^[a-z0-9_-]{1,40}$/.test(a.id) || !text(a.label, 80) || !a.label.trim() || !text(a.instructions, 2000) || !['', 'Gemma 4 E4B'].includes(a.model) || !['main', 'coder', 'qa'].includes(a.role) || typeof a.enabled !== 'boolean') || ['main', 'coder', 'qa'].some(role => !body.agents.some(a => a.id === body.defaults?.[role] && a.role === role))) fail('invalid_agents');
      this.state.system = { revision: this.state.system.revision + 1, editable: true, agents: copy(body.agents), defaults: copy(body.defaults) }; return {};
    }
    if (path === '/projects/browser' && method === 'PATCH') {
      this.revision(this.state.project, body);
      if (body.reconnect) fail('demo_host_only', 'Repository checkout/setup is host-only. Browser checks execute on each candidate.');
      this.state.project.paused = body.paused === true; this.state.project.revision++; return {};
    }
    if (path === '/plans' && method === 'POST') return { plan: this.plan(body) };
    const [, kind, key, action] = path.split('/'), task = this.task(key), run = this.run(key);
    if (kind === 'tasks' && task) {
      if (method === 'GET' && !action) return { task: this.snapshot().tasks.find(t => t.id === key), runs: this.snapshot().runs.filter(r => r.task_id === key), events: this.snapshot().events.filter(e => e.task_id === key), execution_activity: { state: 'available', tasks: {} } };
      this.revision(task, body); this.unlocked(task);
      if (method === 'PATCH' && !action) {
        if (task.archived_at || ['done', 'cancelled'].includes(task.status)) fail('forbidden');
        const next = { ...task, ...Object.fromEntries(fields.filter(k => body[k] !== undefined).map(k => [k, copy(body[k])])), status: body.status || task.status };
        if (!['backlog', 'ready', 'review'].includes(next.status) || task.workflow === 'engineering' && next.workflow !== 'engineering') fail('workflow_locked');
        this.validate(next); next.revision++; next.updated_at = now(); next.automation_revision = body.automation_policy === 'ready_to_done' ? next.revision : null;
        if (next.status === 'ready' && task.status !== 'ready') next.ready_at = now();
        Object.assign(task, next); this.publish('task.updated', task); return { task };
      }
      if (method === 'POST' && action === 'run') { if (!['ready', 'review'].includes(task.status)) fail('forbidden'); return { run: this.start(task) }; }
      if (method === 'POST' && action === 'accept') {
        if (task.workflow === 'manual') { if (task.blocked_reason || !['backlog', 'ready', 'review'].includes(task.status) || task.dependencies.some(k => this.task(k)?.status !== 'done')) fail('dependencies_unmet'); task.status = 'done'; task.completed_at = now(); }
        else await this.apply(task, this.state.runs.filter(r => r.task_id === key).at(-1));
        this.publish('task.accepted', task); return { task };
      }
      if (method === 'POST' && ['archive', 'restore', 'reopen'].includes(action)) {
        if (!['done', 'cancelled'].includes(task.status)) fail('forbidden');
        if (action === 'reopen') Object.assign(task, { status: 'backlog', revision: task.revision + 1, automation_policy: 'manual', automation_revision: null, blocked_reason: null, archived_at: null, completed_at: null });
        else task.archived_at = action === 'archive' ? now() : null;
        this.publish(`task.${action}`, task); return { task };
      }
    }
    if (kind === 'runs' && run && method === 'POST' && action === 'cancel') {
      if (this.busy?.run?.id === key) this.cancel();
      return { run };
    }
    if (kind === 'plans' && method === 'POST') {
      const plan = this.state.plans.find(p => p.id === key); if (!plan) fail('not_found');
      if (action === 'discard') { if (!['queued', 'generating', 'proposed', 'unknown'].includes(plan.status)) fail('planning_not_reviewable'); if (this.busy?.plan?.id === key) this.cancel(); plan.status = 'discarded'; return {}; }
      if (action === 'accept') return this.acceptPlan(plan, body);
    }
    fail('demo_host_only', 'This host operation is not available in the browser demo.', 404);
  }
  launchAllowed() { if (!this.ready || this.busy || this.state.paused || this.readOnly) fail('execution_unavailable'); }
  start(task) {
    this.launchAllowed(); this.unlocked(task);
    if (task.workflow !== 'engineering' || task.archived_at || task.blocked_reason || this.state.project.paused) fail('execution_paused');
    if (task.dependencies.some(key => this.task(key)?.status !== 'done')) fail('dependencies_unmet');
    const threshold = this.threshold(task), agents = { coder: this.agent('coder', task.coding_agent_id), qa: task.qa_policy === 'skip' ? null : this.agent('qa') };
    if (this.state.runs.length >= 100) fail('task_too_large');
    const run = { id: id(), task_id: task.id, task_revision: task.revision, status: 'running', stage: 'coder', created_at: now(), updated_at: now(), agents, base_version: this.state.accepted.version, max_qa_repairs: 2, repair_count: 0, review_history: [], evidence: {}, timeline: [],
      spec: { id: `${task.id}@${task.revision}`, threshold, plan: JSON.stringify(task), qa_policy: task.qa_policy, base: this.state.accepted.source } };
    this.state.runs.push(run); task.status = 'active'; task.blocked_reason = null;
    const controller = new AbortController(); this.busy = { run, controller }; this.publish('run.created', task, run);
    void this.execute(task, run, controller); return run;
  }
  async execute(task, run, controller) {
    try {
      const receipt = await runTask(run.spec, (role, prompt) => {
        const agent = run.agents[role.toLowerCase()]; return this.ask(role, `Additional role instructions: ${agent?.instructions || '(none)'}\n${prompt}`);
      }, this.evaluate, event => {
        controller.signal.throwIfAborted(); run.timeline.push(copy(event)); run.updated_at = now(); run.stage = event.phase === 'Coder' ? 'coder' : 'qa'; run.repair_count = event.attempt;
        if (event.source) run.source = event.source;
        if (event.receipt) { run.receipt = event.receipt; run.evidence = { coder_status: 'complete', qa_status: event.receipt.qa_status, review_status: 'not_required' }; run.review_history.push({ cycle: event.attempt, passed: event.receipt.approved, findings: [...(event.findings || []), ...event.receipt.tests.filter(t => !t.pass).map(t => `${t.input.amountCents} cents: expected ${t.expected}, got ${t.actual}`)], report_digest: event.receipt.hash }); }
        this.publish('run.updated', task, run, event.message);
      }, controller.signal);
      controller.signal.throwIfAborted(); run.receipt = receipt; run.status = 'succeeded'; run.stage = 'awaiting_acceptance'; task.status = 'review'; task.automation_revision = null;
      if (task.merge_policy === 'auto') await this.apply(task, run);
      this.publish('run.updated', task, run, task.status === 'done' ? 'Tested change applied locally' : 'Tests complete; awaiting local acceptance');
    } catch (error) {
      if (!controller.signal.aborted) { run.status = 'failed'; run.reason = 'driver_reported_failure'; task.status = 'review'; task.automation_revision = null; task.blocked_reason = error.message; this.publish('run.updated', task, run, error.message); }
    } finally { if (this.busy?.controller === controller) { this.busy = null; this.publish(); } }
  }
  async apply(task, run) {
    const valid = () => task.status === 'review' && run?.status === 'succeeded' && run.task_revision === task.revision && run.base_version === this.state.accepted.version && !task.blocked_reason && !this.readOnly;
    if (!valid() || !await canAccept(run.spec, run.receipt) || !valid()) fail('stale_revision', 'Candidate is stale or unverified. Run this task again against the accepted app.');
    this.state.accepted = { source: run.receipt.source, rows: copy(run.receipt.rows), version: this.state.accepted.version + 1 };
    task.status = 'done'; task.completed_at = now(); run.stage = 'applied_locally'; run.applied_at = now();
  }
  pump() {
    if (!this.ready || this.busy || this.state.paused || this.state.project.paused || this.readOnly) return;
    const eligible = this.state.tasks.filter(t => t.status === 'ready' && t.workflow === 'engineering' && !t.archived_at && !t.blocked_reason && t.automation_revision === t.revision && t.automation_policy === 'ready_to_done' && !t.dependencies.some(k => this.task(k)?.status !== 'done') && !this.state.runs.some(r => r.task_id === t.id && r.task_revision === t.revision));
    eligible.sort((a, b) => (a.priority || 5) - (b.priority || 5) || String(a.ready_at).localeCompare(String(b.ready_at)));
    const task = eligible[0]; if (!task) return;
    try { this.start(task); } catch (error) { task.blocked_reason = error.message; this.publish('task.blocked', task, null, error.message); }
  }
  plan(body) {
    this.launchAllowed();
    if (!text(body.goal, 8000) || !body.goal.trim() || !text(body.context || '', 8000) || !text(body.project, 160) || !body.project.trim() || !text(body.repository || '', 160)) fail('planning_input_invalid');
    if (this.state.plans.some(p => ['generating', 'unknown', 'proposed'].includes(p.status))) fail('planning_busy');
    const plan = { id: id(), revision: 1, goal: body.goal, context: body.context || '', project: body.project, repository: body.repository || '', status: 'generating', agent: this.agent('main'), proposals: [] };
    this.state.plans.push(plan); const controller = new AbortController(); this.busy = { plan, controller };
    void (async () => {
      try {
        const data = JSON.parse(unFence(await this.ask('Main', `Role instructions: ${plan.agent.instructions}\nGoal: ${plan.goal}\nContext: ${plan.context}\nPlan from supplied context only; no repository inspection. Return ONLY JSON {"summary":"...","proposals":[{"title":"...","objective":"...","acceptance_criteria":["..."],"priority":3,"task_type":"feature","labels":[],"depends_on":[]}]}. Propose 1-3 small tickets. depends_on uses zero-based proposal indexes and only real prerequisites. Browser execution supports the provided expense-threshold contract; suggest manual work otherwise.`)));
        controller.signal.throwIfAborted();
        if (!text(data.summary, 2000) || !Array.isArray(data.proposals) || !data.proposals.length || data.proposals.length > 3) fail('planning_result_invalid');
        const proposals = data.proposals.map(p => ({ task_type: 'feature', priority: 3, labels: [], depends_on: [], ...p, proposal_id: id() }));
        for (const p of proposals) { if (!text(p.title, 240) || !text(p.objective) || !strings(p.acceptance_criteria) || !Array.isArray(p.depends_on) || p.depends_on.some(n => !Number.isInteger(n) || n < 0 || n >= proposals.length)) fail('planning_result_invalid'); }
        Object.assign(plan, { summary: data.summary, proposals, status: 'proposed' });
      } catch (error) { if (!controller.signal.aborted) { plan.status = 'unknown'; plan.summary = error.message; } }
      finally { if (this.busy?.controller === controller) this.busy = null; this.publish('plan.updated'); }
    })(); return plan;
  }
  acceptPlan(plan, body) {
    this.revision(plan, body); if (plan.status !== 'proposed') fail('planning_not_reviewable');
    const selected = body.selected;
    if (!Array.isArray(selected) || !selected.length || selected.length > plan.proposals.length || new Set(selected.map(p => p.proposal_id)).size !== selected.length || selected.some(p => !plan.proposals.some(o => o.proposal_id === p.proposal_id))) fail('planning_selection_invalid');
    const created = selected.map(p => this.create({ ...p.proposal, repository: plan.repository, project: plan.project, context: plan.context.split('\n').filter(Boolean), qa_policy: p.qa_policy, status: 'backlog', dependencies: [], merge_policy: 'manual', automation_policy: 'ready_to_done' }, false));
    selected.forEach((p, i) => {
      if (!Array.isArray(p.proposal.depends_on)) fail('invalid_dependencies');
      created[i].dependencies = p.proposal.depends_on.map(n => {
        const original = Number.isInteger(n) && plan.proposals[n], at = selected.findIndex(s => s.proposal_id === original?.proposal_id);
        if (!original || at < 0) fail('planning_dependency_unselected'); return created[at].id;
      });
    });
    const all = [...this.state.tasks, ...created]; created.forEach(t => this.validate(t, all));
    this.state.tasks.push(...created); created.forEach(t => this.publish('task.created', t)); plan.status = 'accepted'; plan.revision++; plan.accepted_task_ids = created.map(t => t.id); return { tasks: created };
  }
  cancel() {
    const job = this.busy; if (!job) return;
    job.controller.abort(Error('Stopped by user')); this.stopWorker(); this.ready = false; this.busy = null;
    if (job.run) { job.run.status = 'cancelled'; job.run.reason = 'native_cancelled'; const task = this.task(job.run.task_id); task.status = 'review'; task.automation_revision = null; task.blocked_reason = 'Run stopped. Edit or explicitly retry; no change was applied.'; }
    if (job.plan) job.plan.status = 'discarded';
    this.publish('execution.stopped');
  }
  reset() { if (this.busy) fail('execution_busy'); this.readOnly = false; this.view = null; this.state = initial(); this.commands.clear(); this.create(example()); this.publish(); }
  replay(runId) {
    if (this.busy) fail('execution_busy'); const run = this.run(runId); if (!run?.timeline.length) fail('not_found');
    this.view = copy(this.state); this.readOnly = true; this.signal(); return copy(run.timeline);
  }
  endReplay() { this.view = null; this.readOnly = false; this.signal(); }
}
