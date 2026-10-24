import { expenses, money, thresholdCents } from './demo-core.mjs';
import { DemoStore, example } from './demo-store.mjs';
const $ = id => document.getElementById(id), node = (tag, text) => { const e = document.createElement(tag); e.textContent = text; return e; };
let worker, serial = 0, loading = false, selectedTask, selectedExpense = 0, playback;
const pending = new Map();
const notice = text => { $('notice').textContent = text; };
function stopWorker() {
  worker?.terminate(); worker = null;
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Worker stopped. No new change was applied.')); }
  pending.clear(); $('model-status').textContent = 'Model unloaded · cached download retained';
}
function rpc(action, ...args) {
  if (!worker) {
    worker = new Worker(new URL('./demo-worker.mjs', import.meta.url), { type: 'module' });
    worker.onerror = () => { stopWorker(); runtime.setReady(false); };
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id); if (!p) return;
      if (data.progress) { $('model-status').textContent = data.progress; return; }
      pending.delete(data.id); clearTimeout(p.timer); data.error ? p.reject(Error(data.error)) : p.resolve(data.value);
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { stopWorker(); runtime.setReady(false); }, action === 'load' ? 900000 : 180000);
    pending.set(id, { resolve, reject, timer }); worker.postMessage({ id, action, args });
  });
}
let storage; try { storage = sessionStorage; } catch { /* Workspace still works without persistence. */ }
const runtime = new DemoStore({ storage, ask: (role, prompt) => rpc('ask', role, prompt), evaluate: (code, inputs) => rpc('evaluate', code, inputs), stop: stopWorker, changed: render });
function chosenRun() { const runs = runtime.snapshot().runs; return runs.filter(r => r.task_id === selectedTask).at(-1) || runs.at(-1); }
function render() {
  if (runtime.busy?.run) selectedTask = runtime.busy.run.task_id;
  const data = runtime.snapshot(), run = chosenRun(), receipt = run?.receipt;
  $('load').disabled = loading || runtime.ready || runtime.readOnly; $('stop').disabled = !loading && !runtime.busy;
  $('reset').disabled = Boolean(runtime.busy) || loading; $('example').disabled = runtime.readOnly;
  $('replay').disabled = Boolean(runtime.busy) || loading || !data.runs.some(r => r.timeline?.length);
  $('replay').textContent = runtime.readOnly ? 'Exit replay' : 'Replay last run'; $('mode').textContent = runtime.readOnly ? 'Recorded · read-only' : 'Live · browser-local';
  const candidate = $('preview').value === 'candidate', rows = candidate && receipt ? receipt.rows : data.accepted.rows;
  $('total').textContent = money(expenses.filter(e => e.status !== 'paid').reduce((sum, e) => sum + e.amountCents, 0));
  $('review-count').textContent = rows.filter(r => r.value?.status === 'review').length; $('expenses').replaceChildren();
  expenses.forEach((expense, i) => {
    const status = rows[i]?.value?.status || 'error'; if ($('filter').checked && status !== 'review') return;
    const tr = node('tr', ''), cell = node('td', ''), button = node('button', expense.merchant), employee = node('span', expense.employee);
    employee.className = 'employee'; button.append(employee); button.onclick = () => { selectedExpense = i; render(); }; cell.append(button);
    const pill = node('span', { eligible: 'Eligible', review: 'Manager review', paid: 'Paid', error: 'Needs fix' }[status] || 'Invalid'); pill.className = `pill ${status === 'review' ? 'review' : status === 'error' ? 'error' : ''}`;
    const badge = node('td', ''); badge.append(pill); tr.append(cell, node('td', money(expense.amountCents)), badge); $('expenses').append(tr);
  });
  const e = expenses[selectedExpense], row = rows[selectedExpense];
  $('expense-detail').textContent = `${e.merchant} · ${e.receipt ? 'Receipt attached' : 'Receipt missing'}. ${row?.value?.reason || row?.error || 'No manager review required.'}`;
  $('preview-note').textContent = `${runtime.readOnly ? 'Recorded result' : candidate && receipt ? 'Candidate only' : `Accepted version ${data.accepted.version}`} · browser-local; no real financial actions.`;
  $('hash').textContent = receipt ? `Task ${run.task_id.slice(0, 8)} · revision ${run.task_revision} · ${receipt.hash.slice(0, 12)} · QA ${receipt.qa_status}` : 'Select a task with executed checks.';
  $('before').textContent = run?.spec.base || ''; $('code').textContent = receipt?.source || run?.source || '';
  $('tests').replaceChildren(...(receipt?.tests || []).map(t => { const li = node('li', `${t.pass ? 'PASS' : 'FAIL'} · ${money(t.input.amountCents)} ${t.input.status} → ${t.actual} (expected ${t.expected})`); li.className = t.pass ? 'pass' : 'fail'; return li; }));
  if (runtime.storageWarning) notice(runtime.storageWarning);
}
window.demoWorkbench = { runtime, notice, example: () => example(thresholdCents($('threshold').value)), select: (key, candidate) => { selectedTask = key; if (candidate) { $('preview').value = 'candidate'; $('evidence').open = true; } render(); } };
$('board').src = './workboard.html';
$('load').onclick = async () => {
  loading = true; render();
  try { await rpc('load'); runtime.setReady(true); $('model-status').textContent = 'Gemma E4B ready · shared by Main, Coder and QA'; }
  catch (error) { notice(error.message); }
  finally { loading = false; render(); }
};
$('stop').onclick = () => { runtime.cancel(); stopWorker(); runtime.setReady(false); };
$('example').onclick = () => { try { $('board').contentWindow.useExample(window.demoWorkbench.example()); } catch (error) { notice(error.message); } };
$('preview').onchange = $('filter').onchange = render;
$('reset').onclick = () => { playback?.abort(); runtime.reset(); selectedTask = null; $('preview').value = 'accepted'; $('board').src = './workboard.html'; };
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(runtime.state, null, 2)], { type: 'application/json' })), link = node('a', '');
  link.href = url; link.download = 'agent-workspace.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('replay').onclick = async () => {
  if (runtime.readOnly) { playback?.abort(); runtime.endReplay(); return; }
  const run = runtime.state.runs.filter(r => r.timeline?.length).at(-1); if (!run) return;
  playback = new AbortController(); const signal = playback.signal, events = runtime.replay(run.id), view = runtime.view.runs.find(r => r.id === run.id), task = runtime.view.tasks.find(t => t.id === run.task_id);
  selectedTask = task.id; $('preview').value = 'candidate';
  for (const event of events) {
    if (signal.aborted) return;
    view.status = 'running'; view.stage = event.phase === 'Coder' ? 'coder' : 'qa'; task.status = 'active';
    if (event.receipt) view.receipt = event.receipt;
    runtime.signal(); await new Promise(resolve => setTimeout(resolve, 450));
  }
  if (!signal.aborted) { Object.assign(view, structuredClone(run)); task.status = run.applied_at ? 'done' : 'review'; runtime.signal(); }
};
$('layout').onchange = () => { const stack = $('layout').value === 'stack'; $('workspace').classList.toggle('stack', stack); $('workspace').style.cssText = ''; $('divider').setAttribute('aria-orientation', stack ? 'horizontal' : 'vertical'); };
let size = 60;
function resize(value) { size = Math.max(35, Math.min(75, value)); const stack = $('layout').value === 'stack'; $('workspace').style[stack ? 'gridTemplateRows' : 'gridTemplateColumns'] = stack ? `${size * 10}px 6px minmax(580px,auto)` : `minmax(440px,${size}fr) 6px minmax(340px,${100 - size}fr)`; $('divider').setAttribute('aria-valuenow', String(Math.round(size))); }
$('divider').onpointerdown = event => { $('divider').setPointerCapture(event.pointerId); $('divider').onpointermove = e => { const rect = $('workspace').getBoundingClientRect(); resize($('layout').value === 'stack' ? (e.clientY - rect.top) / 10 : (e.clientX - rect.left) / rect.width * 100); }; };
$('divider').onpointerup = $('divider').onpointercancel = () => { $('divider').onpointermove = null; };
$('divider').onkeydown = event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); resize(size + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -2 : 2)); } };
render();
