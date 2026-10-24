// Boot the UNMODIFIED self-hosted UI against an in-memory API in this frame only.
const host = parent.demoWorkbench;
if (parent === window || !host || location.origin !== parent.location.origin) throw Error('Open the browser demo entry page.');
const { runtime } = host, api = '/api/workboard/v1', originalFetch = window.fetch.bind(window);
let selected, detailSignature = '';
const streams = new Set();
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(api + '/')) return originalFetch(input, options);
  const path = url.pathname.slice(api.length), method = options.method || 'GET';
  try {
    const result = await runtime.request(path, method, options.body ? JSON.parse(options.body) : {}, new Headers(options.headers).get('Idempotency-Key'));
    if (method === 'GET' && /^\/tasks\/[^/]+$/.test(path)) { selected = result.task.id; host.select(selected); }
    return Response.json(result);
  } catch (error) { host.notice(error.message); return Response.json({ error: error.code || 'demo_error' }, { status: error.status || 400 }); }
};
window.EventSource = class extends EventTarget {
  constructor(url) {
    super(); streams.add(this); if (!String(url).startsWith(api + '/events')) throw Error('Only local workboard events are supported.');
    this.unsubscribe = runtime.subscribe(event => this.dispatchEvent(new MessageEvent('workboard', { data: JSON.stringify(event) })));
    queueMicrotask(() => this.onopen?.(new Event('open')));
  }
  close() { this.unsubscribe(); streams.delete(this); }
};
const $ = id => document.getElementById(id);
const setText = (el, value) => { if (el && el.textContent !== value) el.textContent = value; };
function adapt() {
  setText(document.querySelector('.private-label'), 'Browser-local workspace');
  const signOut = $('sign-out'); if (!signOut.hidden) signOut.hidden = true;
  setText($('execution-state'), runtime.state.paused ? 'New launches paused; current work may continue.' : 'One local Gemma engine · sequential task execution');
  for (const option of $('task-merge-policy').options) setText(option, option.value === 'auto' ? 'Apply locally after required checks' : 'Wait for human acceptance');
  for (const input of document.querySelectorAll('#agent-fields input[aria-label^="Model"]')) { if (!input.readOnly) input.readOnly = true; input.title = 'All roles share the downloaded Gemma E4B model.'; }
  for (const row of document.querySelectorAll('#project-list .meta')) if (row.textContent.startsWith('Fresh remote clone')) setText(row, 'Browser workspace · no clone, branch or PR');
  for (const button of document.querySelectorAll('#project-list button')) if (button.textContent === 'Prepare checks again') { button.dataset.unavailable = 'true'; if (!button.disabled) button.disabled = true; button.title = 'Host checkout/setup is not part of this browser runtime.'; }
  for (const link of document.querySelectorAll('a[href="https://github.com/demo/expense-inbox"]')) { link.removeAttribute('href'); link.title = 'Local example workspace, not a GitHub repository'; }
  const task = runtime.snapshot().tasks.find(t => t.id === selected), run = runtime.snapshot().runs.filter(r => r.task_id === selected).at(-1), root = $('detail-content');
  if (!task || !$('task-detail').open) return;
  const signature = JSON.stringify([task.id, task.revision, task.status, run?.receipt?.hash, run?.status, runtime.readOnly]);
  if (root.querySelector('.demo-result') && signature === detailSignature) return;
  detailSignature = signature; root.querySelector('.demo-result')?.remove();
  const section = document.createElement('section'); section.className = 'detail-section demo-result';
  const label = document.createElement('p'); label.className = 'meta'; label.textContent = 'Browser delivery: applies only to this demo. No GitHub commit, PR or merge.'; section.append(label);
  if (run?.receipt) {
    const button = document.createElement('button'); button.className = 'secondary-button'; button.textContent = 'Preview candidate & checks'; button.onclick = () => host.select(task.id, true); section.append(button);
    if (task.workflow === 'engineering' && task.status === 'review' && run.status === 'succeeded') {
      const accept = document.createElement('button'); accept.className = 'primary-button'; accept.textContent = 'Apply tested change locally'; accept.disabled = runtime.readOnly;
      accept.onclick = async () => { accept.disabled = true; try { await runtime.request(`/tasks/${task.id}/accept`, 'POST', { expected_revision: task.revision }, crypto.randomUUID()); } catch (error) { host.notice(error.message); accept.disabled = false; } };
      section.append(accept);
    }
  }
  root.querySelector('.detail-actions')?.after(section);
}
const observer = new MutationObserver(adapt);
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener('pagehide', () => { observer.disconnect(); for (const stream of streams) stream.close(); });
await import('./workboard.js');
// Fill the real Main form, not a parallel demo planner.
window.useExample = data => {
  $('main-goal').value = data.objective; $('main-project').value = data.project; $('main-repository').value = data.repository; $('main-context').value = data.context.join('\n');
  document.querySelector('[data-view="main"]').click();
};
window.useExample(host.example());
document.querySelector('[data-view="work"]').click();
adapt();
