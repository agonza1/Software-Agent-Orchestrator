/** Local task organization only. Execution and acceptance stay in page-controller.mjs. */
export const LOCAL_SCOPE = 'local/app';
const MAX_TASKS = 50, MAX_EVENTS = 200, MAX_RUNS = 100;
const clone = value => structuredClone(value);
const stamp = () => new Date().toISOString();
const fail = (message, code = 'local_task_error') => { throw Object.assign(Error(message), {code, status:409}); };
const terminal = task => ['done','cancelled'].includes(task.status);
const fields = ['title','objective','acceptance_criteria','context','priority','labels','dependencies','owner','project','task_type','workflow','blocked_reason','criticality'];
const empty = () => ({version:1,paused:false,tasks:[],runs:[],events:[],watermark:0,binding:null});
const bounded = (value, max) => typeof value === 'string' && value.length <= max;
const strings = (value, count, width) => Array.isArray(value) && value.length <= count && value.every(v=>bounded(v,width));
export function taskRequest(task) {
  return [task.objective, task.acceptance_criteria.length ? `Acceptance criteria:\n${task.acceptance_criteria.join('\n')}` : '', task.context.length ? `Context:\n${task.context.join('\n')}` : ''].filter(Boolean).join('\n\n');
}
export class TaskQueue {
  constructor({changed=()=>{},prepare=()=>{},show=()=>{},available=()=>true}={}) {
    Object.assign(this,{changed,prepare,show,available}); this.state=empty(); this.listeners=new Set();
  }
  export(){return clone(this.state);}
  subscribe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
  signal(){if(this.restoring)return;this.changed();for(const fn of this.listeners){try{fn();}catch{/* A detached view cannot break the builder. */}}}
  event(type,task,summary){
    this.state.events.push({id:crypto.randomUUID(),cursor:++this.state.watermark,type,task_id:task?.id,at:stamp(),summary:String(summary).slice(0,1000)});
    this.state.events=this.state.events.slice(-MAX_EVENTS); this.signal();
  }
  task(id){const task=this.state.tasks.find(t=>t.id===id);if(!task)fail('Task not found.','not_found');return task;}
  validate(task, tasks=this.state.tasks) {
    if(!bounded(task.title,240)||!task.title.trim()||!bounded(task.objective,1000)||!task.objective.trim()||
       !strings(task.acceptance_criteria,12,400)||!strings(task.context,12,400)||!strings(task.labels,12,40)||
       !strings(task.dependencies,MAX_TASKS,80)||new Set(task.dependencies).size!==task.dependencies.length||
       !Number.isInteger(task.priority)||task.priority<0||task.priority>4||!bounded(task.owner||'',160)||!bounded(task.project||'',160)||
       !bounded(task.blocked_reason||'',1000)||!['engineering','manual'].includes(task.workflow)||
       !['feature','bug','improvement','chore','research'].includes(task.task_type)||
       ![null,'','critical','high','medium','low'].includes(task.criticality??null))fail('Check the task fields and length limits.','invalid_task_text');
    if(task.workflow==='engineering'&&task.task_type==='research')fail('Web research requires the installed application. Use Manual for tracking only.');
    if(task.workflow==='engineering'&&taskRequest(task).length>1000)fail('Keep objective, criteria and context within the builder’s combined 1,000-character limit.');
    if(task.dependencies.some(id=>!tasks.some(t=>t.id===id)))fail('Select existing prerequisite tasks.','dependency_not_found');
    const visiting=new Set(),visited=new Set();
    const visit=id=>{
      if(visiting.has(id))fail('Dependencies cannot form a cycle.','dependency_cycle');
      if(visited.has(id))return;visiting.add(id);
      const current=id===task.id?task:tasks.find(t=>t.id===id);
      for(const dependency of current?.dependencies||[])visit(dependency);
      visiting.delete(id);visited.add(id);
    };visit(task.id);
  }
  assertRevision(task,body){if(task.revision!==body.expected_revision)fail('This task changed. Reopen it before saving.','revision_conflict');}
  dependentsBound(id){
    const binding=this.state.binding;if(!binding)return false;
    const seen=new Set();const visit=key=>{if(key===id)return true;if(seen.has(key))return false;seen.add(key);return this.task(key).dependencies.some(visit);};
    return visit(binding.taskId);
  }
  mutable(task){
    if(this.dependentsBound(task.id))fail('This task or a dependent is open in the builder. Start over there before editing.');
    if(task.archived_at||terminal(task))fail('Reopen this closed task before editing.');
  }
  blockers(task){return task.dependencies.map(id=>this.task(id)).filter(t=>t.status!=='done');}
  policy(body){
    if(body.automation_policy&&body.automation_policy!=='manual'||body.merge_policy&&body.merge_policy!=='manual'||body.qa_policy&&body.qa_policy!=='required'||body.repository&&body.repository!==LOCAL_SCOPE||body.coding_agent_id&&body.coding_agent_id!=='coder'||body.github_issue_url||body.github_pull_request_url)
      fail('This board uses explicit builder approval, required QA and local application only. No repository or host actions.');
  }
  create(body){
    this.policy(body);if(this.state.tasks.length>=MAX_TASKS)fail('This workshop board supports up to 50 tasks. Export before resetting.');
    const task={title:'',objective:'',acceptance_criteria:[],context:[],priority:3,labels:[],dependencies:[],owner:'Coder',project:'Local app',task_type:'feature',workflow:'engineering',blocked_reason:null,criticality:null,
      ...Object.fromEntries(fields.filter(f=>body[f]!==undefined).map(f=>[f,clone(body[f])])),id:crypto.randomUUID(),revision:1,status:body.status||'backlog',created_at:stamp(),updated_at:stamp()};
    if(!['backlog','ready'].includes(task.status))fail('New tasks start in Backlog or Ready.');this.validate(task);
    Object.assign(task,{repository:task.workflow==='engineering'?LOCAL_SCOPE:null,automation_policy:'manual',merge_policy:'manual',qa_policy:'required',coding_agent_id:task.workflow==='engineering'?'coder':null});
    this.state.tasks.push(task);this.event('task.created',task,'Task saved locally. No agent started.');return clone(task);
  }
  edit(task,body){
    this.assertRevision(task,body);this.mutable(task);this.policy(body);
    const next={...task,...Object.fromEntries(fields.filter(f=>body[f]!==undefined).map(f=>[f,clone(body[f])])),status:body.status||task.status};
    if(!['backlog','ready','review'].includes(next.status)||body.status==='review'&&task.status!=='review')fail('Move tasks between Backlog and Ready; review is set by execution.');
    this.validate(next);next.repository=next.workflow==='engineering'?LOCAL_SCOPE:null;next.coding_agent_id=next.workflow==='engineering'?'coder':null;
    next.revision++;next.updated_at=stamp();Object.assign(task,next);this.event('task.updated',task,'Task revision updated.');return clone(task);
  }
  next(){return this.state.tasks.filter(t=>t.status==='ready'&&t.workflow==='engineering'&&!t.archived_at&&!t.blocked_reason&&!this.blockers(t).length).sort((a,b)=>(a.priority||5)-(b.priority||5)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))[0]||null;}
  open(task,revision){
    this.assertRevision(task,{expected_revision:revision});
    if(this.state.binding?.taskId===task.id){this.show();return {task:clone(task)};}
    if(this.state.binding||!this.available())fail('Finish or Start over in the builder before selecting another task.');
    if(this.state.paused)fail('Task handoff is paused. Resume it first.');
    if(task.workflow!=='engineering'||task.status!=='ready'||task.archived_at||task.blocked_reason)fail('Mark an unblocked app task Ready first.');
    if(this.blockers(task).length)fail('Finish the prerequisite tasks first.','dependencies_unmet');
    const request=taskRequest(task);
    this.state.binding={taskId:task.id,revision:task.revision,request,runId:null};
    try{this.prepare(clone(task),request);}catch(error){this.state.binding=null;throw error;}
    this.event('task.opened',task,'Opened in builder. Review a plan before running code.');return {task:clone(task)};
  }
  assertBinding(){
    const b=this.state.binding;if(!b)return;
    const task=this.task(b.taskId);
    if(task.revision!==b.revision||taskRequest(task)!==b.request||this.blockers(task).length)fail('Workboard scope or prerequisites changed. Start over and review a new plan.');
  }
  observe(run,busy,{acceptedSource,canonical}={}){
    const b=this.state.binding;if(!b||!run||run.mode==='recorded'||run.request!==b.request||b.runId&&b.runId!==run.id)return;
    this.assertBinding();const task=this.task(b.taskId);b.runId=run.id;
    const done=run.status==='Done'&&!busy&&acceptedSource&&canonical&&canonical(run.candidate)===acceptedSource;
    // This is a display projection; never turn model prose, saved queue data or a route into acceptance.
    const status=done?'done':run.status==='Blocked'?'review':run.status==='Review'?'review':run.status==='Active'?'active':run.status==='Ready'?'ready':task.status;
    const reason=run.status==='Blocked'?(run.events?.at(-1)?.text||run.phase):null;
    const projection={id:run.id,task_id:task.id,task_revision:b.revision,created_at:run.createdAt||stamp(),status:done?'succeeded':run.status==='Blocked'?'failed':run.status==='Active'?'running':run.status==='Review'?'awaiting_acceptance':'awaiting_authorization',stage:run.phase,local_hash:run.hash||'',attempt:run.attempt||0,passed:run.evidence?.rows?.filter(r=>r.pass).length||0,total:run.evidence?.rows?.length||0,mode:run.mode};
    const previous=this.state.runs.find(r=>r.id===run.id);
    if(previous&&JSON.stringify(previous)===JSON.stringify(projection)&&task.status===status&&task.blocked_reason===reason)return;
    if(previous)Object.assign(previous,projection);else this.state.runs.push(projection);
    this.state.runs=this.state.runs.slice(-MAX_RUNS);task.status=status;task.blocked_reason=reason;task.updated_at=stamp();
    if(done){task.completed_at=stamp();this.state.binding=null;}
    this.event('run.updated',task,done?'Exact tested app accepted locally.':`${run.phase} · ${projection.passed}/${projection.total} checks recorded.`);
  }
  release(reason='Detached in builder. Mark Ready and select deliberately to retry.'){
    const b=this.state.binding;if(!b)return;const task=this.task(b.taskId);this.state.binding=null;
    if(!terminal(task)){task.status='backlog';task.blocked_reason=null;task.revision++;task.updated_at=stamp();}
    const run=this.state.runs.find(r=>r.id===b.runId);if(run&&!['failed','succeeded'].includes(run.status)){run.status='failed';run.stage='Stopped or detached';}
    this.event('task.detached',task,reason);
  }
  restore(raw,restoredRun=null){
    if(!raw)return;const state=clone(raw);
    if(state.version!==1||typeof state.paused!=='boolean'||!Array.isArray(state.tasks)||state.tasks.length>MAX_TASKS||!Array.isArray(state.runs)||state.runs.length>MAX_RUNS||!Array.isArray(state.events)||state.events.length>MAX_EVENTS||!Number.isSafeInteger(state.watermark)||state.watermark<0||JSON.stringify(state).length>1000000)fail('Saved task board is invalid. Export the workspace before resetting.');
    const ids=new Set();for(const task of state.tasks){if(!bounded(task.id,80)||!task.id||ids.has(task.id)||!Number.isSafeInteger(task.revision)||task.revision<1||!['backlog','ready','active','review','done','cancelled'].includes(task.status)||!bounded(task.created_at,40))fail('Saved task record is invalid.');ids.add(task.id);this.validate(task,state.tasks);this.policy(task);}
    for(const run of state.runs)if(!bounded(run.id,80)||!ids.has(run.task_id))fail('Saved task run is invalid.');
    const b=state.binding;if(b&&(!ids.has(b.taskId)||!Number.isSafeInteger(b.revision)||!bounded(b.request,1000)||b.runId!==null&&!bounded(b.runId,80)))fail('Saved task handoff is invalid.');
    this.state=state;this.restoring=true;
    // Restored review is attached only to the exact saved builder identity/scope. The
    // app re-verifies it before enabling UI; Active work is never resumed.
    const keep=b&&restoredRun?.kind==='workspace'&&restoredRun.mode!=='recorded'&&['Ready','Review','Done'].includes(restoredRun.status)&&b.runId===restoredRun.id&&b.request===restoredRun.request&&this.task(b.taskId).revision===b.revision&&taskRequest(this.task(b.taskId))===b.request;
    if(b&&!keep)this.release('Reload interrupted the workboard handoff. Reselect this task deliberately.');
    for(const task of this.state.tasks)if(task.status==='active'){task.status='backlog';task.blocked_reason='Interrupted by reload. Edit and mark Ready to retry.';}
    for(const run of this.state.runs)if(!(keep&&run.id===b.runId)&&['running','awaiting_authorization','awaiting_acceptance'].includes(run.status)){run.status='failed';run.stage='Interrupted by reload';}
    this.restoring=false;
  }
  snapshot(){
    const data=this.export();const binding=data.binding;
    for(const task of data.tasks){task.browser_locked=this.dependentsBound(task.id);task.browser_active=binding?.taskId===task.id;task.dependency_blockers=this.blockers(task).map(t=>({id:t.id,title:t.title}));}
    const roles=['main','coder','qa'].map(role=>({id:role,label:{main:'Planner',coder:'Coder',qa:'Tester'}[role],role,enabled:true,model:'Shared browser Gemma',instructions:'Uses the existing full-app builder. Settings remain in its pinned runtime.'}));
    return {...data,plans:[],projects:[],system:{editable:false,agents:roles,defaults:{main:'main',coder:'coder',qa:'qa'}},coding_agents:{default_coder:'coder',agents:[roles[1]]},execution:{approved:true,paused:data.paused,lane_run_id:binding?.runId||null},execution_activity:{state:'available',tasks:{}},capabilities:{read:true,write:true,accept:true,run:!data.paused&&!binding&&this.available(),stop:false,cancel:false,planning:false,projects:false,ready_to_done:false}};
  }
  request(path,{method='GET',body={}}={}){
    if(method==='GET'){
      if(path==='/session')return {authenticated:true,login_method:'tailnet',identity:'This browser · local task board',capabilities:this.snapshot().capabilities};
      if(path==='/snapshot')return this.snapshot();
      const match=/^\/tasks\/([^/]+)$/.exec(path);if(match){const task=this.task(match[1]),s=this.snapshot();return {task:s.tasks.find(t=>t.id===task.id),runs:s.runs.filter(r=>r.task_id===task.id),events:s.events.filter(e=>e.task_id===task.id),execution_activity:s.execution_activity};}
    }
    if(method==='POST'&&path==='/tasks')return {task:this.create(body)};
    if(method==='POST'&&path==='/execution/pause'){if(typeof body.paused!=='boolean')fail('Expected a pause value.');this.state.paused=body.paused;this.event('queue.paused',null,body.paused?'New task handoffs paused.':'Task handoffs resumed.');return {};}
    const match=/^\/tasks\/([^/]+)(?:\/(run|show|accept|archive|restore|reopen))?$/.exec(path);
    if(match){const task=this.task(match[1]),action=match[2];
      if(method==='PATCH'&&!action)return {task:this.edit(task,body)};
      if(method==='POST'){
        this.assertRevision(task,body);
        if(action==='run')return this.open(task,body.expected_revision);
        if(action==='show'){if(this.state.binding?.taskId!==task.id)fail('This task is not open in the builder.');this.show();return {};}
        if(action==='accept'){this.mutable(task);if(task.workflow!=='manual'||task.blocked_reason||this.blockers(task).length)fail('App changes must pass checks and be accepted in the builder.');task.status='done';task.completed_at=stamp();this.event('task.accepted',task,'Manual task completed by user; no model or app change.');return {task:clone(task)};}
        if(['archive','restore','reopen'].includes(action)){
          if(!terminal(task)||this.dependentsBound(task.id))fail('Only idle closed tasks can be archived, restored or reopened.');
          if(action==='reopen'){task.status='backlog';task.revision++;task.completed_at=null;task.blocked_reason=null;}
          task.archived_at=action==='archive'?stamp():null;this.event(`task.${action}`,task,`Task ${action}.`);return {task:clone(task)};
        }
      }
    }
    fail('This host operation is not available. Use Work tasks and the existing builder.','local_only');
  }
}
