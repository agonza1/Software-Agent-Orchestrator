import {SCENARIOS,PRESERVATION,normalizeWorkshop,evidenceGroups,sourceDiff,reviewedWorkshop} from './workshop-contract.mjs';
import {MAX_PACK_BYTES,MAX_CHECKPOINTS,captureCheckpoint,exportPack,importPack,seededRepair,validateCheckpoint} from './workshop-pack.mjs';

/** Presenter features are views around the existing builder; imported packs never
 * become a controller task, accepted app, model prompt, or approval authority. */
export function mountWorkshop({state,suggest,settingsChanged,revise,changed,notify,execute,createPreview}){
  const el=(tag,value='',cls='')=>{const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;};
  const button=(id,label,fn,cls='quiet')=>{const b=el('button',label,cls);b.id=id;b.type='button';b.onclick=fn;return b;};
  const $=id=>document.getElementById(id);
  const stylesheet=el('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('./workshop.css',import.meta.url).href;document.head.append(stylesheet);
  let settings=normalizeWorkshop(),records=[],captureKeys=new Set(),captureEpoch=0,selectedRecord=null,selectedVersion=-1;
  let previewHandle=null,previewAbort=null,previewEpoch=0,rehearsalAbort=null,rehearsing=false,presentation=false,unrestored=null,reviewSignature='';
  const mutateControls=[];
  function modal(id,title){
    const dialog=el('dialog','','workshop-dialog');dialog.id=id;dialog.setAttribute('aria-labelledby',id+'-title');
    const header=el('header','','workshop-heading'),h=el('h2',title);h.id=id+'-title';
    const close=button(id+'-close','Close',()=>dialog.close());header.append(h,close);
    const body=el('div','','workshop-content');dialog.append(header,body);document.body.append(dialog);
    let trigger;dialog.addEventListener('close',()=>{if(trigger?.isConnected)trigger.focus({preventScroll:true});});
    return {dialog,body,open(from){trigger=from;dialog.showModal();close.focus({preventScroll:true});}};
  }
  const config=modal('workshop-context','Project brief & permissions');
  const review=modal('workshop-review','What changed—and what stayed correct');
  const replay=modal('workshop-replay','Presenter checkpoints & repair walkthrough');
  const feedback=modal('workshop-feedback','Request a plan revision');
  const toolbar=el('div','','workshop-toolbar');
  const contextButton=button('workshop-context-open','Brief & permissions',e=>{renderConfig();config.open(e.currentTarget);});
  const reviewButton=button('workshop-review-open','Review change',e=>{renderReview(true);review.open(e.currentTarget);});
  const replayButton=button('workshop-replay-open','Presenter checkpoints',e=>{renderReplay();replay.open(e.currentTarget);});
  const presentButton=button('workshop-present','Presentation view',()=>{presentation=!presentation;document.body.classList.toggle('presentation-mode',presentation);presentButton.setAttribute('aria-pressed',String(presentation));presentButton.textContent=presentation?'Exit presentation':'Presentation view';changed();});presentButton.setAttribute('aria-pressed','false');
  toolbar.append(contextButton,reviewButton,replayButton,presentButton);document.querySelector('.runtime-bar').after(toolbar);
  const banner=el('section','','workshop-live-banner');banner.setAttribute('aria-label','Current workshop activity');toolbar.after(banner);
  const suggestions=el('section','','workshop-suggestions');suggestions.setAttribute('aria-label','Optional starting points');
  suggestions.append(el('p','Start with a suggestion—or describe any app change.','workshop-caption'));
  const cards=el('div','','suggestion-grid');
  for(const scenario of SCENARIOS){const b=button('suggest-'+scenario.id,'',()=>{settings={...settings,preserve:[...scenario.preserve],feedback:[]};suggest(scenario.request);refresh();changed();},'suggestion-card');b.append(el('strong',scenario.title),el('span',scenario.value));cards.append(b);mutateControls.push(b);}
  const safeguards=el('p','','workshop-help');const editSafeguards=button('workshop-safeguards-edit','Change safeguards',e=>{renderConfig();config.open(e.currentTarget);});
  suggestions.append(cards,safeguards,editSafeguards);$('request-form').before(suggestions);
  const reviseButton=button('workshop-revise','Request plan revision',e=>{feedbackText.value='';feedbackError.textContent='';feedback.open(e.currentTarget);});$('run').before(reviseButton);
  const feedbackText=el('textarea');feedbackText.id='workshop-feedback-text';feedbackText.maxLength=700;feedbackText.rows=4;
  const feedbackLabel=el('label','What should the plan also cover?');feedbackLabel.htmlFor=feedbackText.id;
  const feedbackError=el('p','','workshop-error');feedbackError.setAttribute('role','status');
  const reviseSubmit=button('workshop-feedback-submit','Revise with Planner',async()=>{const value=feedbackText.value.trim();if(!value){feedbackError.textContent='Enter a requested correction.';return;}if(state().busy){feedbackError.textContent='Wait for the current operation to finish.';return;}feedback.dialog.close();await revise(value);},'primary');
  feedback.body.append(el('p','The previous plan is retained as history. The revised plan needs a new approval; this does not start Coder.'),feedbackLabel,feedbackText,feedbackError,reviseSubmit);
  function renderConfig(){
    const s=state();config.body.replaceChildren();
    const label=el('label',`Shared project brief · version ${settings.brief.version}`),area=el('textarea');area.id='workshop-brief';area.rows=5;area.maxLength=2000;area.value=settings.brief.text;label.htmlFor=area.id;
    config.body.append(label,area,el('p','All three roles receive the same frozen brief. Edit it for any other application; clearing it is allowed.','workshop-help'));
    const fieldset=el('fieldset'),legend=el('legend','What must stay correct?');fieldset.append(legend);
    const checkboxes=[];
    for(const group of PRESERVATION){const line=el('label','','workshop-checkbox'),input=el('input');input.type='checkbox';input.value=group.id;input.checked=settings.preserve.includes(group.id);line.append(input,document.createTextNode(group.label));fieldset.append(line);checkboxes.push(input);}
    fieldset.append(el('p','Optional checks for the supplied expense app, not restrictions on custom requests. Uncheck a group when the requested change intentionally replaces that behavior. Selected checks must already pass on the starting app.','workshop-help'));config.body.append(fieldset);
    const policyLabel=el('label','Generated app external access'),policy=el('select');policy.id='workshop-network';policyLabel.htmlFor=policy.id;
    for(const [value,title]of [['restricted','Blocked · self-contained workshop'],['standard','Allow public HTTPS resources']]){const o=el('option',title);o.value=value;policy.append(o);}policy.value=settings.network;
    config.body.append(policyLabel,policy);
    const list=el('dl','','permissions-list');for(const [k,v]of [['Edit app source','Allowed: HTML, CSS and JavaScript'],['Real accounts or payments','Not connected; use synthetic data only'],['GitHub publication','Not connected'],['Apply candidate','Human acceptance after executed checks'],['Current accepted preview',s.acceptedNetwork==='restricted'?'External connections/assets blocked':'Standard HTTPS preview policy']])list.append(el('dt',k),el('dd',v));
    config.body.append(list,el('p','Restricted mode applies CSP to generated previews and checks: external fetches and external assets are blocked. The host still downloads model/runtime files. Same-site harness loading and browser navigation are not an air gap; a JavaScript loop can still freeze a shared renderer.','workshop-help'),el('p','Tester is a separate conversation with the same model—not an independent model. Executed checks remain the evidence.','workshop-help'));
    const save=button('workshop-context-save','Save & require a new plan',()=>{
      if(state().busy||state().mode==='recorded')return;
      if(state().task&&!confirm('Changing context or permissions invalidates the current plan and candidate. Continue?'))return;
      try{settings=normalizeWorkshop({brief:{version:area.value===settings.brief.text?settings.brief.version:settings.brief.version+1,text:area.value},preserve:checkboxes.filter(c=>c.checked).map(c=>c.value),network:policy.value,feedback:[]});settingsChanged(settings);config.dialog.close();changed();refresh();}catch(error){notify(error.message);}
    },'primary');
    const disabled=s.busy||s.mode==='recorded';for(const node of [area,policy,save,...checkboxes])node.disabled=disabled;
    if(disabled)config.body.append(el('p','Read-only while a run is active or a recording is selected.','workshop-help'));config.body.append(save);
  }
  function rowList(root,title,rows,baseline=[]){
    root.append(el('h3',title));if(!rows.length){root.append(el('p','No executed results yet.','workshop-help'));return;}
    for(const row of rows){const line=el('div','','evidence-line'),before=baseline.find(r=>r.name===row.name);line.append(el('span',row.name),el('strong',`${before?'Before: '+(before.pass?'pass':'fail')+' → ':''}${row.pass?'PASS':'FAIL'}`,row.pass?'pass':'fail'));root.append(line);}
  }
  function diffInto(root,base,candidate){
    root.append(el('h3','Source changes'));
    for(const item of sourceDiff(base,candidate)){
      const detail=el('details','','source-change'),title=el('summary',item.file.toUpperCase()+(item.changed?` · changed region at line ${item.startLine}`:' · unchanged'));detail.append(title);
      if(item.changed){const pre=el('pre');for(const line of item.removed)pre.append(el('span','− '+line+'\n','diff-removed'));for(const line of item.added)pre.append(el('span','+ '+line+'\n','diff-added'));detail.append(pre);}root.append(detail);
    }
  }
  function renderReview(force=false){
    const t=state().task,signature=JSON.stringify([t?.id,t?.phase,t?.hash,t?.planHash,t?.evidence?.at,t?.status]);if(!force&&signature===reviewSignature)return;reviewSignature=signature;const body=review.body;body.replaceChildren();
    if(!t){body.append(el('p','Create a plan or open Presenter checkpoints to inspect a recorded example.'));return;}
    body.append(el('p',t.request,'workshop-request'),el('p',`${t.mode==='recorded'?'Recorded evidence':t.mode==='guided'?'Guided: scripted agents':'Live model workflow'} · ${t.phase}`,'workshop-provenance'));
    const meta=t.plan?.workshop;if(meta)body.append(el('p',`Shared brief v${meta.brief.version} · ${meta.preserve.length} preservation groups · external access ${meta.network==='restricted'?'blocked':'HTTPS allowed'}`,'workshop-help'));
    if(t.evidence?.hash===t.hash){const groups=evidenceGroups(t),baseline=[...(t.baseline?.rows||[]),...(t.preservationBaseline?.rows||[])];rowList(body,'Requested outcomes',groups.requested,baseline);rowList(body,'Preserved behavior',groups.preserved,baseline);rowList(body,'Additional and runtime checks',groups.additional,baseline);}
    else{body.append(el('h3','Reviewed checks'));for(const check of t.plan?.checks||[])body.append(el('p',check.name));body.append(el('p','No passing candidate evidence yet. A model response is not an approval.','workshop-help'));}
    if(t.candidate)diffInto(body,t.base,t.candidate);
    if(t.planReviews?.length){body.append(el('h3','Human plan revisions'));for(const r of t.planReviews)body.append(el('p',r.feedback));}
    const timing=el('p',`Build attempts: ${t.attempt||0}. Human gates: plan approval and final acceptance. No production deployment or real payment.`,'workshop-help');body.append(timing);
  }
  const replayControls=el('div','','checkpoint-controls');
  const saveCurrent=button('checkpoint-save','Save current checkpoint',()=>void saveCheckpoint());
  const seed=button('checkpoint-seed','Run seeded repair rehearsal',async()=>{
    if(state().busy||rehearsing)return;rehearsing=true;rehearsalAbort=new AbortController();replayMessage.textContent='Executing the prepared defect and repair against real browser checks. No model call.';refresh();
    try{const record=await seededRepair(execute,{signal:rehearsalAbort.signal});if(!rehearsalAbort.signal.aborted){addRecord(record);selectedRecord=record.id;selectedVersion=0;renderReplay();}}
    catch(error){if(!rehearsalAbort?.signal.aborted)replayMessage.textContent=error.message;}
    finally{rehearsing=false;refresh();}
  });
  const exportButton=button('checkpoint-export','Export pack',async()=>{try{const value=await exportPack(records);const url=URL.createObjectURL(new Blob([value],{type:'application/json'})),a=el('a');a.href=url;a.download='venture135-workshop-pack.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){replayMessage.textContent=error.message;}});
  const importLabel=el('label','Import pack','quiet checkpoint-import'),input=el('input');input.id='checkpoint-import';input.type='file';input.accept='.json,application/json';importLabel.append(input);
  input.onchange=async()=>{const file=input.files[0];input.value='';if(!file)return;try{if(file.size>MAX_PACK_BYTES)throw Error('Choose a pack below 2.5 MB.');const incoming=await importPack(await file.text());if(records.length&& !confirm('Replace presenter checkpoints? The current app, plan, model and accepted version will not change.'))return;captureEpoch++;records=incoming;selectedRecord=records[0].id;selectedVersion=-1;changed();renderReplay();}catch(error){replayMessage.textContent=error.message;}};
  const recordSelect=el('select');recordSelect.id='checkpoint-select';recordSelect.setAttribute('aria-label','Saved checkpoint');recordSelect.onchange=()=>{selectedRecord=recordSelect.value;selectedVersion=-1;renderReplayDetail();};
  const remove=button('checkpoint-remove','Remove checkpoint',()=>{records=records.filter(r=>r.id!==selectedRecord);selectedRecord=records.at(-1)?.id||null;changed();renderReplay();});
  const replayMessage=el('p','','workshop-help');replayMessage.setAttribute('role','status');const replayDetail=el('div');
  replayControls.append(saveCurrent,seed,exportButton,importLabel,remove);
  replay.body.append(el('p','Read-only checkpoints. Viewing a plan or candidate here never applies it or authorizes a new run.','workshop-provenance'),el('p','Packs contain app source, the project brief and recorded evidence. Review for sensitive data before sharing. Imported hashes show consistency, not verified model provenance.','workshop-help'),replayControls,recordSelect,replayMessage,replayDetail);
  function addRecord(record){records=[...records.filter(r=>r.id!==record.id),record].slice(-MAX_CHECKPOINTS);changed();}
  async function saveCheckpoint(){try{const s=state(),epoch=captureEpoch;if(s.busy||rehearsing)return;const record=await captureCheckpoint(s.task,{base:s.accepted});if(epoch!==captureEpoch)return;addRecord(record);selectedRecord=record.id;selectedVersion=-1;renderReplay();}catch(error){replayMessage.textContent=error.message;}}
  function clearPreview(){previewEpoch++;previewAbort?.abort();previewHandle?.destroy();previewHandle=null;}
  function renderReplay(){
    recordSelect.replaceChildren();for(const r of records){const opt=el('option',`${r.source==='imported'?'IMPORTED · ':r.source==='seeded'?'SEEDED · ':r.source==='guided'?'GUIDED · ':''}${r.title}`);opt.value=r.id;recordSelect.append(opt);}
    if(!records.some(r=>r.id===selectedRecord))selectedRecord=records.at(-1)?.id||null;recordSelect.value=selectedRecord||'';renderReplayDetail();refresh();
  }
  function renderReplayDetail(){
    clearPreview();replayDetail.replaceChildren();replayMessage.textContent='';const r=records.find(r=>r.id===selectedRecord);
    if(!r){replayDetail.append(el('p','Save the original app, a reviewed plan or a completed candidate. The seeded repair rehearsal works without downloading Gemma.'));return;}
    replayDetail.append(el('h3',r.title),el('p',r.source==='imported'?`IMPORTED recording · origin claimed: ${r.originalSource}. Not independently verified, never eligible for acceptance.`:r.source==='seeded'?'SEEDED example · prepared defect and repair; no model was used.':r.source==='local-live'?'Captured from this browser’s Live workflow. Recorded evidence—not a new execution.':r.source==='guided'?'GUIDED recording · scripted agents.':'Manual original-app checkpoint.','workshop-provenance'));
    const steps=el('div','','checkpoint-steps'),original=button('checkpoint-original','Original app',()=>{selectedVersion=-1;renderReplayDetail();}),plan=button('checkpoint-plan','Reviewed plan',()=>{selectedVersion=-2;renderReplayDetail();});steps.append(original,plan);
    for(const [i,v]of r.versions.entries())steps.append(button('checkpoint-version-'+i,v.label,()=>{selectedVersion=i;renderReplayDetail();}));replayDetail.append(steps);
    if(selectedVersion===-2){replayDetail.append(el('p',r.plan?.summary||'No reviewed plan in this checkpoint.'));for(const c of r.plan?.checks||[])replayDetail.append(el('p',c.name));if(r.plan?.workshop)replayDetail.append(el('pre',r.plan.workshop.brief.text));return;}
    const v=r.versions[selectedVersion],bundle=v?.bundle||r.base;
    if(v){rowList(replayDetail,'Executed at capture time',v.evidence.rows);replayDetail.append(el('p',`Source SHA-256: ${v.hash}`,'workshop-hash'));diffInto(replayDetail,r.base,bundle);}
    const inspect=el('details');inspect.append(el('summary','Inspect source without executing it'));for(const name of ['html','css','js'])inspect.append(el('h4',name.toUpperCase()),el('pre',bundle[name]));replayDetail.append(inspect);
    const preview=el('div','','checkpoint-preview');const previewStatus=el('p','','workshop-help');
    const show=button('checkpoint-preview-open','Preview recorded app (restricted)',async()=>{clearPreview();previewAbort=new AbortController();const generation=previewEpoch;show.disabled=true;previewStatus.textContent='Opening an isolated preview with external access blocked…';try{const handle=await createPreview(preview,bundle,{network:'restricted',signal:previewAbort.signal,onError:error=>{if(generation===previewEpoch)previewStatus.textContent=String(error?.message||error);}});if(generation!==previewEpoch){handle.destroy();return;}previewHandle=handle;previewStatus.textContent='Recorded code is running only in this isolated preview. Current app and approval state are unchanged.';}catch(error){if(generation===previewEpoch)previewStatus.textContent=error.message;}finally{show.disabled=false;}});
    replayDetail.append(show,previewStatus,preview);
    const events=el('details');events.append(el('summary','Recorded activity'));for(const e of r.events)events.append(el('p',`${e.role}: ${e.text}`));replayDetail.append(events);
  }
  replay.dialog.addEventListener('close',()=>{clearPreview();rehearsalAbort?.abort();});
  function refresh(){
    const s=state(),busy=s.busy||rehearsing,locked=busy||s.mode==='recorded';
    suggestions.hidden=Boolean(s.task); // Keep the working run prominent; Start over reveals suggestions again.
    safeguards.textContent='Optional preservation groups: '+(settings.preserve.map(id=>PRESERVATION.find(p=>p.id===id).label).join('; ')||'none')+'. Custom requests can change any app file.';
    for(const b of mutateControls)b.disabled=locked;
    reviseButton.hidden=s.task?.status!=='Ready'||s.mode!=='live';reviseButton.disabled=busy||s.task?.workshopPending;
    saveCurrent.disabled=busy;seed.disabled=busy;exportButton.disabled=!records.length;input.disabled=rehearsing;
    reviewButton.disabled=!s.task;replayButton.textContent=`Presenter checkpoints${records.length?' ('+records.length+')':''}`;
    banner.replaceChildren(el('strong',s.task?.phase||'One request → reviewed plan → executed checks → your decision'),el('span',s.task?.status==='Review'?'Your decision: compare the result and accept only when satisfied.':s.task?.phase==='Coder'?'Generating a candidate. Checks and human acceptance still follow.':s.task?.phase==='Tester'?'Executing checks and reviewing the candidate.':s.task?.phase==='Planner'?'Turning the request and shared brief into reviewable checks.':'Suggestions are optional. Custom app changes remain supported.'));
    if(review.dialog.open)renderReview();
    if(s.task&&!busy&&!s.task.workshopPending&&['Ready','Review','Done','Blocked'].includes(s.task.status)&&s.task.mode!=='recorded'){
      const key=[s.task.id,s.task.status,s.task.hash,s.task.planHash].join('|');
      if(!captureKeys.has(key)){captureKeys.add(key);const epoch=captureEpoch,snapshot=structuredClone(s.task);void captureCheckpoint(snapshot,{base:s.accepted}).then(record=>{if(epoch!==captureEpoch)return;addRecord(record);if(replay.dialog.open)renderReplay();else refresh();}).catch(()=>{captureKeys.delete(key);});}
    }
  }
  return {
    get settings(){return structuredClone(settings);},get rehearsing(){return rehearsing;},refresh,
    export(){return {version:1,settings:structuredClone(settings),presentation,records:structuredClone(records),unrestored};},
    async restore(raw){if(!raw)return;const epoch=captureEpoch;unrestored=structuredClone(raw);if(raw.version!==1||!Array.isArray(raw.records)||raw.records.length>MAX_CHECKPOINTS)throw Error('Saved workshop preferences are invalid. Export before resetting.');const next=normalizeWorkshop(raw.settings),validated=await Promise.all(raw.records.map(r=>validateCheckpoint(r)));if(epoch!==captureEpoch)return;settings=next;records=validated;unrestored=raw.unrestored||null;presentation=raw.presentation===true;document.body.classList.toggle('presentation-mode',presentation);presentButton.setAttribute('aria-pressed',String(presentation));presentButton.textContent=presentation?'Exit presentation':'Presentation view';},
    reset(){unrestored=null;captureEpoch++;presentation=false;document.body.classList.remove('presentation-mode');presentButton.setAttribute('aria-pressed','false');presentButton.textContent='Presentation view';rehearsalAbort?.abort();clearPreview();captureKeys.clear();records=[];settings=normalizeWorkshop();selectedRecord=null;changed();},
  };
}
