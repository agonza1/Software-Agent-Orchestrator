import {TaskQueue} from './task-queue.mjs';
/** Optional official workboard surface. The parent retains the only controller/model. */
export function mountTaskBoard({runtime,prepare,currentRequest,changed,notice}){
  const el=(tag,content='',className='')=>{const n=document.createElement(tag);n.textContent=content;n.className=className;return n;};
  const css=el('link');css.rel='stylesheet';css.href=new URL('./task-board.css',import.meta.url).href;document.head.append(css);
  const button=el('button','Tasks','quiet task-board-button');button.id='open-task-board';button.type='button';button.setAttribute('aria-haspopup','dialog');
  document.querySelector('.builder .panel-heading').append(button);
  const label=el('p','','workboard-task-label');label.id='workboard-task-label';label.hidden=true;document.getElementById('request-form').before(label);
  const dialog=el('dialog','','task-board-dialog');dialog.id='task-board-dialog';dialog.setAttribute('aria-labelledby','task-board-title');
  const head=el('div','','task-board-top'),title=el('h2','Local task board');title.id='task-board-title';
  const save=el('button','Save current request','quiet'),next=el('button','Open next Ready','primary'),close=el('button','Close','quiet');
  save.id='board-save-request';next.id='board-next-ready';close.id='board-close';
  for(const node of [save,next,close])node.type='button';head.append(title,save,next,close);
  const hint=el('p','Uses the official workboard UI and this tab’s existing builder. Closing this view does not stop work.','task-board-hint');
  const feedback=el('p','','task-board-error');feedback.hidden=true;feedback.setAttribute('role','status');
  const frame=el('iframe');frame.id='task-board-frame';frame.title='Editable local workboard';
  // This is trusted, generated application UI, not the opaque generated-app sandbox.
  dialog.append(head,hint,feedback,frame);document.body.append(dialog);
  let failedSnapshot=null;
  const showBuilder=()=>{dialog.close();document.getElementById('request')?.focus();};
  const queue=new TaskQueue({changed:()=>{sync();changed();},prepare:(task,request)=>{prepare(task,request);showBuilder();},show:showBuilder,
    available:()=>{const r=runtime();return r.initialized!==false&&!r.loading&&!r.controller.busy&&!r.recorded&&(!r.controller.task||['Done','Blocked'].includes(r.controller.task.status));}});
  function sync(){
    button.disabled=runtime().initialized===false;
    button.textContent=`Tasks${queue.state.tasks.length?` (${queue.state.tasks.length})`:''}`;
    const b=queue.state.binding,task=b&&queue.state.tasks.find(t=>t.id===b.taskId);
    label.hidden=!task;label.textContent=task?`Workboard: ${task.title} · revision ${b.revision}. Start over detaches this task.`:'';
    const available=queue.available()&&!queue.state.binding&&!queue.state.paused;
    next.disabled=!available||!queue.next()||Boolean(failedSnapshot);
    save.disabled=runtime().initialized===false||!currentRequest().trim()||Boolean(failedSnapshot)||runtime().recorded;
  }
  const error=error=>{feedback.textContent=String(error.message||error);feedback.hidden=false;};
  const clearError=()=>{feedback.hidden=true;feedback.textContent='';};
  Object.defineProperty(window,'__saoTaskBoard',{configurable:true,value:Object.freeze({version:1,
    request:(path,options)=>{if(runtime().initialized===false)throw Error('Workspace is still restoring.');if(failedSnapshot)throw Error('Saved task board needs attention. Export it before Reset demo.');return queue.request(path,options);},
    subscribe:listener=>queue.subscribe(listener),close:()=>dialog.close()})});
  button.onclick=()=>{clearError();if(!frame.getAttribute('src'))frame.src=new URL('./workboard/live.html',import.meta.url).href;sync();dialog.showModal();close.focus();};
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>button.focus());
  save.onclick=()=>{clearError();try{const request=currentRequest().trim();queue.create({title:request.slice(0,100),objective:request});}catch(e){error(e);}};
  next.onclick=()=>{clearError();try{const task=queue.next();if(task)queue.open(task,task.revision);}catch(e){error(e);}};
  const result={queue,
    observe(){const r=runtime();if(r.initialized===false)return;queue.observe(r.controller.task,r.controller.busy,{acceptedSource:r.acceptedSource,canonical:r.canonical});sync();},
    refresh(){sync();for(const fn of queue.listeners){try{fn();}catch{/* Detached frame. */}}},
    export(){return failedSnapshot||queue.export();},
    restore(raw,run){try{queue.restore(raw,run);}catch(e){failedSnapshot=structuredClone(raw);notice(e.message);}sync();},
    reset(){failedSnapshot=null;queue.state={version:1,paused:false,tasks:[],runs:[],events:[],watermark:0,binding:null};queue.signal();},
  };
  sync();return result;
}
