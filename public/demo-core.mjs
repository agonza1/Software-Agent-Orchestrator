// The browser demo mirrors a bounded workflow, not native execution/merge authority.
export const BASE = `function evaluateExpense(expense) {
  return { status: expense.status === "paid" ? "paid" : "eligible", reason: "" };
}`;
export const expenses = [
  { merchant: 'Atlas Air', employee: 'Alex', amountCents: 89000, status: 'submitted', receipt: true },
  { merchant: 'Corner Coffee', employee: 'Sam', amountCents: 4200, status: 'submitted', receipt: true },
  { merchant: 'Office Supply', employee: 'Jordan', amountCents: 50000, status: 'submitted', receipt: false },
  { merchant: 'City Hotel', employee: 'Alex', amountCents: 189000, status: 'submitted', receipt: true },
  { merchant: 'Cloud Hosting', employee: 'Sam', amountCents: 250000, status: 'paid', receipt: true },
];
export const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const unFence = text => String(text).trim().replace(/^```(?:javascript|js|json)?\s*\n?/, '').replace(/\n?```$/, '').trim();
export function thresholdCents(value) {
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(String(value))) throw Error('Enter a threshold from $0.01 to $100,000 with at most two decimals.');
  const [whole, fraction = ''] = String(value).split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < 1 || cents > 10000000) throw Error('Threshold must be between $0.01 and $100,000.');
  return cents;
}
export function objective(threshold) {
  return `Require manager approval for submitted expenses above ${money(threshold)} (${threshold} cents), with a nonempty explanation. At or below the threshold stays eligible. Paid expenses stay paid. Return {status: "review" | "eligible" | "paid", reason: string}.`;
}
export function cases(threshold, extra = []) {
  const required = [threshold - 1, threshold, threshold + 1, 189000].map(amountCents => ({ amountCents, status: 'submitted' }));
  required.push({ amountCents: 250000, status: 'paid' });
  // Also verify every visible row; a correct receipt must support its preview.
  return [...required, ...expenses, ...extra].map((input, i) => ({
    id: i, input,
    expected: input.status === 'paid' ? 'paid' : input.amountCents > threshold ? 'review' : 'eligible',
  }));
}
export function check(cases, outputs) {
  return cases.map(({ id, input, expected }, i) => {
    const value = outputs[i]?.value;
    const valid = value && typeof value.reason === 'string' && value.reason.length <= 240;
    return { id, input, expected, actual: value?.status ?? 'error',
      pass: Boolean(valid && value.status === expected && (expected !== 'review' || value.reason.trim())),
      error: outputs[i]?.error ?? (valid ? '' : 'Invalid output shape') };
  });
}
export function review(text) {
  const qa = JSON.parse(unFence(text));
  if (typeof qa.approved !== 'boolean' || !Array.isArray(qa.findings) || qa.findings.length > 3 ||
      qa.findings.some(s => typeof s !== 'string' || s.length > 500) || !Array.isArray(qa.cases) || qa.cases.length > 3 ||
      qa.cases.some(c => !Number.isSafeInteger(c.amountCents) || c.amountCents < 0 || c.amountCents > 100000000 || !['submitted', 'paid'].includes(c.status))) {
    throw Error('QA returned an invalid review.');
  }
  return qa;
}
export async function fingerprint(task, source) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([task.id, task.threshold, task.plan, source])));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function canAccept(task, receipt) {
  return Boolean(receipt?.approved && receipt.tests.length >= cases(task.threshold).length && receipt.tests.every(t => t.pass) &&
    receipt.hash === await fingerprint(task, receipt.source));
}
export async function runTask(task, ask, evaluate, emit, signal) {
  let source = task.base, feedback = [];
  const alive = () => signal?.throwIfAborted();
  for (let attempt = 0; attempt <= 2; attempt++) {
    alive();
    emit({ phase: 'Coder', attempt, message: attempt ? `Repair ${attempt}/2` : 'Implementing the approved task' });
    source = unFence(await ask('Coder', `${objective(task.threshold)}\nPlan: ${task.plan}\nCurrent function:\n${source}\nFeedback: ${JSON.stringify(feedback)}\nReturn ONLY one synchronous JavaScript function evaluateExpense(expense). No imports, prose or markdown. Inputs use integer amountCents and status. Do not modify tests.`));
    alive();
    if (!source || source.length > 8000) throw Error('Coder returned empty or oversized source.');
    emit({ phase: 'QA', attempt, source, message: 'Executing protected checks' });
    const required = cases(task.threshold);
    let tests = check(required, await evaluate(source, required.map(c => c.input)));
    alive();
    let qa;
    try {
      qa = review(await ask('QA', `${objective(task.threshold)}\nReview only this task, without changing code.\nCode:\n${source}\nExecuted checks: ${JSON.stringify(tests)}\nReturn ONLY JSON: {"approved":true,"findings":[],"cases":[{"amountCents":0,"status":"submitted"}]}. Suggest 1-3 extra inputs; the host computes expected results. Set approved false for relevant defects only. Do not claim tests ran yourself.`));
    } catch (error) {
      alive();
      qa = { approved: false, findings: [String(error.message).slice(0, 500)], cases: [] };
    }
    alive();
    const allCases = cases(task.threshold, qa.cases);
    const outputs = await evaluate(source, allCases.map(c => c.input));
    alive();
    tests = check(allCases, outputs);
    const approved = qa.approved && !qa.findings.length && tests.every(t => t.pass);
    const receipt = { source, tests, approved, hash: await fingerprint(task, source),
      rows: outputs.slice(5, 5 + expenses.length), attempt };
    alive();
    emit({ phase: 'QA', attempt, receipt, message: `${tests.filter(t => t.pass).length}/${tests.length} checks passed`, findings: qa.findings });
    if (approved) return receipt;
    feedback = [...qa.findings, ...tests.filter(t => !t.pass)];
    if (!feedback.length) feedback.push('QA did not approve this candidate.');
  }
  throw Error('Two repairs used. Human attention required; nothing was applied.');
}
