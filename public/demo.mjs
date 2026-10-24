import { columns, labels } from './workboard-model.js';
import { BASE, expenses, money, thresholdCents, objective, runTask, canAccept } from './demo-core.mjs';
const $ = id => document.getElementById(id);
const node = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el; };
const baselineRows = () => expenses.map(e => ({ value: { status: e.status === 'paid' ? 'paid' : 'eligible', reason: '' } }));
let worker, ready = false, busy = false, serial = 0, task, receipt, controller, recorded = false;
let accepted = BASE, acceptedRows = baselineRows(), events = [], stage = 'backlog', selected = 0;
const pending = new Map(), STORAGE = 'sao-demo-last-run-v1';
function stopWorker(message) {
  worker?.terminate(); worker = null; ready = false;
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error(message)); }
  pending.clear(); $('model-status').textContent = 'Model unloaded · cached download retained';
}
function rpc(action, ...args) {
  if (!worker) {
    worker = new Worker(new URL('./demo-worker.mjs', import.meta.url), { type: 'module' });
    worker.onerror = () => stopWorker('Browser runtime failed. Reload the model to retry.');
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id); if (!p) return;
      if (data.progress) { $('model-status').textContent = data.progress; return; }
      pending.delete(data.id); clearTimeout(p.timer);
      data.error ? p.reject(Error(data.error)) : p.resolve(data.value);
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => stopWorker('Operation timed out. Nothing was applied.'), action === 'load' ? 900000 : 180000);
    pending.set(id, { resolve, reject, timer }); worker.postMessage({ id, action, args });
  });
}
function remember() {
  try { localStorage.setItem(STORAGE, JSON.stringify({ task, events })); }
  catch { $('status').textContent += ' · Run could not be saved locally.'; }
}
function saved() { try { return JSON.parse(localStorage.getItem(STORAGE)); } catch { return null; } }
function controls() {
  $('load').disabled = busy || ready;
  $('threshold').disabled = busy || recorded;
  $('plan').disabled = busy || !ready || recorded;
  $('run').disabled = busy || !ready || !task || stage !== 'backlog' || recorded;
  $('accept').disabled = busy || !receipt?.approved || stage !== 'review' || recorded;
  $('stop').disabled = !busy; $('reset').disabled = busy;
  $('replay').disabled = busy || !saved()?.events?.length;
  $('mode').textContent = recorded ? 'Recorded · local run' : 'Live · local';
  $('stages').replaceChildren(...columns.filter(c => c !== 'cancelled').map(c => {
    const el = node('span', labels[c]); if (c === stage) el.setAttribute('aria-current', 'step'); return el;
  }));
}
function renderApp() {
  const candidate = $('preview').value === 'candidate';
  const rows = candidate && receipt ? receipt.rows : acceptedRows;
  $('total').textContent = money(expenses.filter(e => e.status !== 'paid').reduce((sum, e) => sum + e.amountCents, 0));
  $('review-count').textContent = rows.filter(r => r.value?.status === 'review').length;
  $('expenses').replaceChildren();
  expenses.forEach((expense, i) => {
    const value = rows[i]?.value;
    if ($('filter').checked && value?.status !== 'review') return;
    const tr = document.createElement('tr'), cell = document.createElement('td');
    const button = node('button', expense.merchant); button.onclick = () => { selected = i; renderApp(); };
    const employee = node('span', expense.employee); employee.className = 'employee'; button.append(employee); cell.append(button);
    const status = value?.status ?? 'error', pill = node('span', { eligible: 'Eligible', review: 'Manager review', paid: 'Paid', error: 'Needs fix' }[status] ?? 'Invalid');
    pill.className = `pill ${['review', 'error'].includes(status) ? status : ''}`;
    const statusCell = document.createElement('td'); statusCell.append(pill);
    tr.append(cell, node('td', money(expense.amountCents)), statusCell); $('expenses').append(tr);
  });
  const e = expenses[selected], row = rows[selected];
  $('expense-detail').textContent = `${e.merchant} · ${e.receipt ? 'Receipt attached' : 'Receipt missing'}. ${row?.value?.reason || row?.error || 'No manager review required.'}`;
  $('preview-note').textContent = recorded ? 'Recorded result · not a new execution.' : candidate ? (receipt ? 'Candidate only · not applied to the accepted version.' : 'No candidate yet · showing accepted version.') : 'Accepted version · local demo only.';
}
function show(event, save = true) {
  if (save) events.push(event);
  if (event.stage) stage = event.stage;
  if (event.source) $('code').textContent = event.source;
  if (event.receipt) {
    receipt = event.receipt; $('code').textContent = receipt.source;
    $('hash').textContent = `Tested candidate ${receipt.hash.slice(0, 12)} · attempt ${receipt.attempt + 1}/3`;
    $('tests').replaceChildren(...receipt.tests.map(t => {
      const li = node('li', `${t.pass ? 'PASS' : 'FAIL'} · ${money(t.input.amountCents)} ${t.input.status} → ${t.actual} (expected ${t.expected})${t.error ? ` · ${t.error}` : ''}`);
      li.className = t.pass ? 'pass' : 'fail'; return li;
    }));
    $('preview').value = 'candidate'; $('evidence').open = true; renderApp();
  }
  if (recorded && event.stage === 'done' && receipt) {
    accepted = receipt.source; acceptedRows = receipt.rows; $('preview').value = 'accepted'; renderApp();
  }
  const text = `${event.phase ?? labels[stage]} · ${event.message}`;
  $('status').textContent = text; $('activity').append(node('li', text)); controls();
}
async function operation(fn) {
  busy = true; controller = new AbortController(); controls();
  try { await fn(controller.signal); }
  catch (error) { show({ message: error.message, phase: 'Needs attention' }); if (task && !recorded) remember(); receipt = null; renderApp(); }
  finally { busy = false; controls(); }
}
function clearTask() {
  task = null; receipt = null; events = []; stage = 'backlog'; recorded = false;
  $('plan-text').textContent = 'Choose a threshold, then ask Main for a plan.';
  $('code').textContent = accepted; $('hash').textContent = '';
  $('tests').replaceChildren(); $('activity').replaceChildren(); $('evidence').open = false;
  $('status').textContent = 'Backlog · no execution authorized'; $('preview').value = 'accepted';
  controls(); renderApp();
}
$('load').onclick = () => operation(async () => {
  await rpc('load'); ready = true; $('model-status').textContent = 'Gemma E4B ready · one model, three roles';
});
$('plan').onclick = () => operation(async signal => {
  const threshold = thresholdCents($('threshold').value); clearTask();
  show({ phase: 'Main', message: 'Planning only; execution still requires Ready & run' });
  const plan = await rpc('ask', 'Main', `${objective(threshold)}\nThe app is an expense inbox. Only evaluateExpense(expense) may change. Propose at most three short implementation/verification steps. No code. The existing paid state must be preserved.`);
  signal.throwIfAborted(); if (!plan.trim()) throw Error('Main returned an empty plan.');
  task = Object.freeze({ id: crypto.randomUUID(), threshold, plan: plan.slice(0, 2000), base: accepted, baseRows: acceptedRows });
  $('plan-text').textContent = task.plan; show({ phase: 'Main', message: 'Plan ready in Backlog · review it before authorizing execution' });
});
$('run').onclick = () => operation(async signal => {
  show({ stage: 'ready', message: 'Execution explicitly authorized for this task revision' });
  show({ stage: 'active', message: 'Starting Coder → independent QA' });
  try {
    receipt = await runTask(task, (role, prompt) => rpc('ask', role, prompt), (code, inputs) => rpc('evaluate', code, inputs), show, signal);
    signal.throwIfAborted(); show({ stage: 'review', message: 'Checks passed · human acceptance required' });
  } finally { remember(); }
});
$('accept').onclick = () => operation(async signal => {
  if (recorded || stage !== 'review' || !await canAccept(task, receipt)) throw Error('Candidate no longer matches its tested task revision.');
  signal.throwIfAborted(); accepted = receipt.source; acceptedRows = receipt.rows;
  show({ stage: 'done', message: 'Tested candidate applied locally · no GitHub publication' });
  $('preview').value = 'accepted'; renderApp(); remember();
});
$('stop').onclick = () => { controller?.abort(Error('Stopped by user. Nothing new was applied.')); stopWorker('Stopped by user.'); };
$('reset').onclick = () => { accepted = BASE; acceptedRows = baselineRows(); $('threshold').value = '500'; $('filter').checked = false; clearTask(); };
$('threshold').oninput = clearTask;
$('preview').onchange = $('filter').onchange = renderApp;
$('layout').onchange = () => $('workspace').classList.toggle('stack', $('layout').value === 'stack');
$('replay').onclick = () => operation(async signal => {
  const record = saved();
  if (!record?.task || !Array.isArray(record.events) || record.events.length > 40) throw Error('No valid saved run.');
  clearTask(); recorded = true; task = record.task; accepted = task.base; acceptedRows = task.baseRows; renderApp();
  $('plan-text').textContent = task.plan; controls();
  for (const event of record.events) {
    await new Promise(resolve => setTimeout(resolve, 450)); signal.throwIfAborted(); show(event, false);
  }
  renderApp();
});
clearTask();
