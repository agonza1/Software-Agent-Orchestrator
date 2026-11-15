import {canonicalBundle,validateBundle,validatePlan,validateConsistentChecks,digest,applyEdits} from './page-contract.mjs';
import {INITIAL_BUNDLE,GUIDED_PLAN,guidedDateEdit} from './page-baseline.mjs';
import {normalizeWorkshop,attachWorkshop} from './workshop-contract.mjs';

export const MAX_PACK_BYTES=2500000;
export const MAX_CHECKPOINTS=6;
const cleanText=(value,max,label)=>{if(typeof value!=='string'||value.length>max)throw Error(`Invalid ${label}.`);return value;};
const hashPattern=/^[a-f0-9]{64}$/;
const sources=['local-live','guided','seeded','imported','manual'];
const stages=['original','plan','candidate','accepted','blocked'];
function planCopy(raw){
  if(raw==null)return null;
  const p=validatePlan(raw);
  if(raw.workshop){const s=normalizeWorkshop(raw.workshop);if(!Number.isInteger(raw.workshop.requestedCount)||raw.workshop.requestedCount<1||raw.workshop.requestedCount>4)throw Error('Invalid checkpoint plan.');p.workshop={...s,requestedCount:raw.workshop.requestedCount};}
  return p;
}
function rowsCopy(rows){
  if(!Array.isArray(rows)||rows.length>10)throw Error('Invalid checkpoint evidence.');
  return rows.map(row=>{
    const name=cleanText(row.name,200,'check name');if(typeof row.pass!=='boolean')throw Error('Invalid check outcome.');
    // Evidence is inert data; no event handlers, templates, or executable check strings.
    const actual=JSON.stringify(row.actual??null),expected=JSON.stringify(row.expected??null);
    if(actual.length>40000||expected.length>16000)throw Error('Checkpoint evidence is too large.');
    return {name,pass:row.pass,expected:JSON.parse(expected),actual:JSON.parse(actual)};
  });
}
async function versionCopy(raw){
  const bundle=validateBundle(raw.bundle),hash=await digest(canonicalBundle(bundle));
  if(raw.hash!==hash||!hashPattern.test(raw.hash))throw Error('Checkpoint source hash does not match its code.');
  const checks=validateConsistentChecks(raw.checks),checksHash=await digest(JSON.stringify(checks));
  if(raw.evidence?.hash!==hash||raw.evidence?.checksHash!==checksHash)throw Error('Checkpoint checks are not bound to this source.');
  return {label:cleanText(raw.label||'Candidate',160,'candidate label'),bundle,hash,checks,evidence:{hash,checksHash,rows:rowsCopy(raw.evidence.rows),at:cleanText(raw.evidence.at||'',60,'evidence time')}};
}
export async function validateCheckpoint(raw,{imported=false}={}){
  if(!raw||raw.version!==1||!stages.includes(raw.stage)||!sources.includes(raw.source))throw Error('Unsupported workshop checkpoint.');
  if(!Array.isArray(raw.versions)||raw.versions.length>4||!Array.isArray(raw.events)||raw.events.length>80)throw Error('Too many checkpoint versions or events.');
  const base=validateBundle(raw.base),baseHash=await digest(canonicalBundle(base));
  if(raw.baseHash!==baseHash)throw Error('Checkpoint baseline hash mismatch.');
  const plan=planCopy(raw.plan),planHash=plan?await digest(JSON.stringify(plan)):null;
  if(raw.planHash!==planHash)throw Error('Checkpoint plan hash mismatch.');
  const versions=await Promise.all(raw.versions.map(versionCopy));
  const finalHash=raw.finalHash??null;
  if(finalHash!==null&&!versions.some(v=>v.hash===finalHash))throw Error('Unknown final candidate in checkpoint.');
  const events=raw.events.map(e=>({role:cleanText(e.role,40,'event role'),text:cleanText(e.text,2000,'event'),at:cleanText(e.at,60,'event time')}));
  return {version:1,id:cleanText(raw.id,100,'checkpoint id'),title:cleanText(raw.title,160,'checkpoint title'),stage:raw.stage,
    source:imported?'imported':raw.source,originalSource:raw.source==='imported'?cleanText(raw.originalSource||'unknown',40,'original source'):raw.source,
    capturedAt:cleanText(raw.capturedAt,60,'checkpoint time'),request:cleanText(raw.request||'',1000,'request'),base,baseHash,plan,planHash,versions,finalHash,events};
}
export async function captureCheckpoint(task,{base,title}={}){
  if(task)task=structuredClone(task);
  const original=validateBundle(task?.base||base||INITIAL_BUNDLE);
  const plan=planCopy(task?.plan);
  const versions=(task?.versions||[]).slice(-4).map((v,i)=>({label:`Candidate ${i+1}`,bundle:v.bundle,hash:v.hash,checks:v.checks,evidence:v.evidence}));
  const stage=task?.status==='Done'?'accepted':task?.status==='Review'?'candidate':task?.status==='Blocked'?'blocked':plan?'plan':'original';
  const raw={version:1,id:task?`${task.id}:${stage}:${(task.hash||'').slice(0,12)}`:crypto.randomUUID(),title:(title||`${stage[0].toUpperCase()+stage.slice(1)} · ${task?.request||'Original app'}`).slice(0,160),stage,
    source:task?.mode==='live'?'local-live':task?.mode==='guided'?'guided':'manual',capturedAt:new Date().toISOString(),request:task?.request||'',base:original,baseHash:await digest(canonicalBundle(original)),
    plan,planHash:plan?await digest(JSON.stringify(plan)):null,versions,finalHash:versions.some(v=>v.hash===task?.hash)?task.hash:null,
    events:(task?.events||[]).slice(-80).map(e=>({role:e.role,text:String(e.text).slice(0,2000),at:e.at}))};
  return validateCheckpoint(raw);
}
export async function exportPack(records){
  if(!Array.isArray(records)||!records.length||records.length>MAX_CHECKPOINTS)throw Error('Save between one and six presenter checkpoints.');
  const checkpoints=await Promise.all(records.map(r=>validateCheckpoint(r)));
  const text=JSON.stringify({kind:'sao-workshop-pack',version:1,exportedAt:new Date().toISOString(),checkpoints},null,2);
  if(new TextEncoder().encode(text).length>MAX_PACK_BYTES)throw Error('Workshop pack is too large. Remove a checkpoint and try again.');
  return text;
}
export async function importPack(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_PACK_BYTES)throw Error('Choose a workshop pack smaller than 2.5 MB.');
  const value=JSON.parse(text);
  if(value.kind!=='sao-workshop-pack'||value.version!==1||!Array.isArray(value.checkpoints)||!value.checkpoints.length||value.checkpoints.length>MAX_CHECKPOINTS)throw Error('Not a supported workshop pack. Workspace exports cannot authorize imported changes.');
  // Import always strips live provenance. Hashes establish consistency, not authenticity.
  return Promise.all(value.checkpoints.map(r=>validateCheckpoint(r,{imported:true})));
}
export async function seededRepair(execute,{signal}={}){
  const settings=normalizeWorkshop({preserve:['data-v1','policy-v1'],network:'restricted'});
  const plan=attachWorkshop(validatePlan(structuredClone(GUIDED_PLAN)),settings);
  const base=structuredClone(INITIAL_BUNDLE);
  const broken=applyEdits(base,{edits:[guidedDateEdit(base).edits[0]]});
  const fixed=applyEdits(base,guidedDateEdit(base));
  fixed.css=fixed.css.replaceAll('td:nth-child(2),th:nth-child(2)','td:nth-child(3),th:nth-child(3)');
  const versions=[];
  for(const [label,bundle]of [['Seeded defect: header without dates',broken],['Prepared repair: dates rendered',fixed]]){
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const result=await execute(bundle,plan.checks,{signal,network:'restricted'});
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    if(!Array.isArray(result.rows)||plan.checks.some((c,i)=>result.rows[i]?.name!==c.name||JSON.stringify(result.rows[i]?.expected)!==JSON.stringify(c.assertions)))throw Error('Incomplete browser evidence for the seeded rehearsal.');
    const hash=await digest(canonicalBundle(bundle)),checksHash=await digest(JSON.stringify(plan.checks));
    versions.push({label,bundle,hash,checks:plan.checks,evidence:{hash,checksHash,rows:result.rows,at:new Date().toISOString()}});
  }
  return validateCheckpoint({version:1,id:crypto.randomUUID(),title:'Seeded repair rehearsal · no model used',stage:'candidate',source:'seeded',capturedAt:new Date().toISOString(),request:'Expose expense dates without changing the existing payment policy.',base,baseHash:await digest(canonicalBundle(base)),plan,planHash:await digest(JSON.stringify(plan)),versions,finalHash:versions.at(-1).hash,events:[{role:'Rehearsal',text:'The defect and repair are prepared fixtures. Browser checks were executed; neither candidate was generated by Gemma or applied to your app.',at:new Date().toISOString()}]});
}
