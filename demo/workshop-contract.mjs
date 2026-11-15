import {validateChecks} from './page-checks.mjs';
import {canonicalBundle,validateConsistentChecks} from './page-contract.mjs';

export const WORKSHOP_VERSION=1;
export const DEFAULT_BRIEF={version:1,text:'Product: V135 Spend, an expense inbox for finance reviewers.\nAmounts use USD and integer cents. Use synthetic data only.\nExplain changes in plain language. Preserve paid history unless the approved request explicitly changes it.'};
// These are suggestions, never a request router or source-edit allowlist.
export const SCENARIOS=Object.freeze([
  {id:'dates',title:'Make information visible',value:'Help finance reviewers spot older expenses.',request:'Our finance team cannot see when expenses occurred. Show each expense’s date in the table so reviewers can investigate older expenses. Keep amounts, search, approval rules and paid statuses unchanged.',preserve:['data-v1','policy-v1','search-v1']},
  {id:'receipts',title:'Help reviewers prioritize',value:'Find missing receipts without opening every expense.',request:'Add a Missing receipts option to the expense filter so finance reviewers can find submissions that need documentation. Keep all amounts, existing filters, approval rules and paid statuses unchanged.',preserve:['data-v1','policy-v1','search-v1']},
  {id:'policy',title:'Change a business rule',value:'Make documentation requirements explicit.',request:'Require a receipt for submitted expenses above $75. Explain when a receipt is required and disable approval for those expenses. Preserve the manager-review rule for expenses with receipts and leave already-paid expenses unchanged.',preserve:['data-v1','search-v1']},
]);
const assertion=(selector,property,expected,operator='equals')=>({selector,property,operator,expected});
const row=name=>`#expenses tr[aria-label^="${name},"]`;
export const PRESERVATION=Object.freeze([
  {id:'data-v1',label:'Expense amounts and paid history',check:{name:'Preserve: sample amounts and paid history',steps:[],assertions:[
    assertion('#expenses tr','count',6),
    ...[['Studio Supply','$500.00'],['Design Tools','$76.00'],['Team Dinner','$640.00'],['Cloud Hosting','$1,250.00'],['Train Tickets','$180.00'],['Client Lunch','$92.00']].map(([name,amount])=>assertion(row(name),'text',amount,'includes')),
    assertion(row('Train Tickets')+' .badge','text','Paid'),
  ]}},
  {id:'policy-v1',label:'Existing approval rules',check:{name:'Preserve: existing approval decisions',steps:[],assertions:[
    assertion(row('Studio Supply')+' .badge','text','Eligible'),assertion(row('Design Tools')+' .badge','text','Eligible'),
    assertion(row('Team Dinner')+' .badge','text','Manager review'),assertion(row('Cloud Hosting')+' .badge','text','Manager review'),
  ]}},
  {id:'search-v1',label:'Search and paid filter',check:{name:'Preserve: search and paid filter',steps:[{action:'input',selector:'#search',value:'Train'},{action:'select',selector:'#filter',value:'paid'}],assertions:[
    assertion('#expenses tr','count',1),assertion('#expenses','text','Train Tickets','includes'),assertion('#expenses .badge','text','Paid'),
  ]}},
]);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function normalizeWorkshop(value={}){
  if(!object(value))throw Error('Workshop context must be an object.');
  if(value.version!==undefined&&value.version!==WORKSHOP_VERSION)throw Error('Unsupported workshop context version.');
  const brief=value.brief??DEFAULT_BRIEF;
  if(!object(brief)||typeof brief.text!=='string'||brief.text.length>2000||!Number.isSafeInteger(brief.version)||brief.version<1)throw Error('Use a project brief of at most 2,000 characters and a valid version.');
  const preserve=value.preserve??[];
  if(!Array.isArray(preserve)||preserve.length>3||new Set(preserve).size!==preserve.length||preserve.some(id=>!PRESERVATION.some(p=>p.id===id)))throw Error('Unknown preservation group. Review the selected checks.');
  const network=value.network??'restricted';
  if(!['restricted','standard'].includes(network))throw Error('Unknown preview permissions.');
  const feedback=value.feedback??[];
  if(!Array.isArray(feedback)||feedback.length>3||feedback.some(text=>typeof text!=='string'||!text.trim()||text.length>700))throw Error('Use up to three plan revisions, each at most 700 characters.');
  return {version:WORKSHOP_VERSION,brief:{version:brief.version,text:brief.text},preserve:[...preserve],network,feedback:[...feedback]};
}
export function preservationChecks(settings){
  const normalized=normalizeWorkshop(settings);
  return normalized.preserve.length?validateChecks(normalized.preserve.map(id=>PRESERVATION.find(p=>p.id===id).check)):[];
}
export function attachWorkshop(plan,settings){
  const normalized=normalizeWorkshop(settings),requestedCount=plan.checks.length;
  if(plan.checks.some(c=>PRESERVATION.some(p=>p.check.name===c.name)))throw Error('Planner duplicated a reserved preservation check. Request a new plan with requested outcomes only.');
  const checks=validateConsistentChecks([...plan.checks,...preservationChecks(normalized)]);
  if(checks.length>6)throw Error('Use fewer preservation groups or request a shorter plan; up to six checks can run.');
  return {...plan,checks,workshop:{...normalized,requestedCount}};
}
export function reviewedWorkshop(task){
  if(task?.workshopPending)throw Error('Workshop requirements were not finished. Create a new plan.');
  const meta=task?.plan?.workshop;
  if(!meta)return null; // Earlier, local recordings keep their original semantics.
  if(meta.version!==WORKSHOP_VERSION)throw Error('Workshop requirements changed. Create a new plan.');
  const settings=normalizeWorkshop(meta);
  if(!Number.isInteger(meta.requestedCount)||meta.requestedCount<1||meta.requestedCount>4||
    JSON.stringify(task.plan.checks.slice(meta.requestedCount))!==JSON.stringify(preservationChecks(settings)))throw Error('Reviewed preservation checks changed. Create a new plan.');
  return settings;
}
export function contextFor(settings){
  if(!settings)return '';
  const s=normalizeWorkshop(settings);
  return `\nShared project brief v${s.brief.version} (reviewed task context):\n${s.brief.text}\nPreview policy: ${s.network==='restricted'?'External connections and external asset loads are blocked. Use self-contained HTML/CSS/JS.':'Public HTTPS resources permitted under the preview CSP. No parent credentials or repository access.'}\nPreservation checks, added by the host and not editable by agents: ${s.preserve.map(id=>PRESERVATION.find(p=>p.id===id).label).join('; ')||'None selected. Do not invent restrictions on the request.'}\n${s.feedback.length?'Human plan revision feedback:\n'+s.feedback.map((line,i)=>`${i+1}. ${line}`).join('\n'):''}\nFor planning, propose only 1–2 requested-outcome checks; the host adds selected preservation checks separately. The request is not restricted to the example suggestions.`;
}
export function evidenceGroups(task){
  const meta=task?.plan?.workshop,requestedNames=new Set((task?.plan?.checks||[]).slice(0,meta?.requestedCount??task?.plan?.checks?.length).map(c=>c.name));
  const preservedNames=new Set(meta?preservationChecks(meta).map(c=>c.name):[]);
  const groups={requested:[],preserved:[],additional:[]};
  for(const row of task?.evidence?.rows||[])groups[preservedNames.has(row.name)?'preserved':requestedNames.has(row.name)?'requested':'additional'].push(row);
  return groups;
}
/** A bounded single-hunk line diff. No extra model call and no rendered HTML. */
export function sourceDiff(before,after){
  canonicalBundle(before);canonicalBundle(after);
  return ['html','css','js'].map(file=>{
    const a=before[file].split('\n'),b=after[file].split('\n');let start=0,endA=a.length,endB=b.length;
    while(start<endA&&start<endB&&a[start]===b[start])start++;
    while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
    return {file,changed:before[file]!==after[file],startLine:start+1,removed:a.slice(start,endA),added:b.slice(start,endB)};
  });
}
