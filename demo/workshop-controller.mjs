import {Controller as AppController,MAX_BUILD_ATTEMPTS} from './page-controller.mjs';
import {digest} from './page-contract.mjs';
import {normalizeWorkshop,preservationChecks,attachWorkshop,reviewedWorkshop,contextFor} from './workshop-contract.mjs';
export {MAX_BUILD_ATTEMPTS};

/** Add reviewed context to the existing controller, not a second execution engine. */
export class Controller extends AppController {
  constructor({model,execute,onChange=()=>{},...rest}){
    let owner;
    const sharedModel=new Proxy(model,{get(target,key){
      if(key==='generate')return (role,prompt,options)=>target.generate(role,prompt+contextFor(owner.scope()),options);
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    super({...rest,model:sharedModel,
      execute:(bundle,checks,options)=>execute(bundle,checks,{...options,network:owner.scope()?.network??'standard'}),
      onChange:task=>{if(owner?.preparing&&task)task.workshopPending=true;onChange(task);},
    });
    owner=this;this.preparing=null;this.reviewHistory=[];
  }
  scope(){return this.preparing??reviewedWorkshop(this.task);}
  async plan({workshop,...args}){
    if(this.busy||this.preparing)throw Error('A run is already active.');
    const settings=normalizeWorkshop(workshop),operation={};if(args.request!==this.task?.request||!settings.feedback.length)this.reviewHistory=[];this.planOperation=operation;this.preparing=settings;
    let t,epoch;
    try{
      t=await super.plan(args);epoch=this.epoch;if(this.planOperation!==operation)throw Error('Plan cancelled or replaced.');this.busy=true;
      t.status='Active';t.phase='Checking preservation requirements';this.emit();
      const checks=preservationChecks(settings);
      let preserved=null;
      if(checks.length){
        preserved=await this.execute(t.base,checks,{signal:this.abort.signal});this.assert(epoch,t);
        if(!Array.isArray(preserved.rows)||preserved.errors?.length||checks.some((c,i)=>preserved.rows[i]?.name!==c.name||preserved.rows[i]?.pass!==true||JSON.stringify(preserved.rows[i]?.expected)!==JSON.stringify(c.assertions)))throw Error('Selected preservation checks do not pass on the current app. Change the selected groups or revise the app before planning; no check was silently dropped.');
      }
      t.plan=attachWorkshop(t.plan,settings);
      t.preservationBaseline=preserved;
      t.planHash=await digest(JSON.stringify(t.plan));this.assert(epoch,t);
      t.planReviews=structuredClone(this.reviewHistory);
      t.workshopPending=false;this.preparing=null;t.status='Ready';t.phase='Awaiting authorization';
      this.event('Planner',`Project brief v${settings.brief.version} frozen for all roles. ${checks.length} preservation groups added for human review.`);
      return t;
    }catch(error){if(t&&t===this.task&&epoch===this.epoch)this.block(error);throw error;}
    finally{if(this.planOperation===operation){this.planOperation=null;this.preparing=null;this.busy=false;this.emit();}}
  }
  async revisePlan(feedback){
    const t=this.task;
    if(this.busy||this.preparing||t?.status!=='Ready'||t.mode!=='live')throw Error('Revise a ready Live plan before approving its build.');
    const settings=reviewedWorkshop(t)||normalizeWorkshop();
    const revised=normalizeWorkshop({...settings,feedback:[...settings.feedback,feedback.trim()]});
    this.reviewHistory=[...(t.planReviews||[]),{summary:t.plan.summary,hash:t.planHash,feedback:feedback.trim(),at:new Date().toISOString()}].slice(-3);
    return this.plan({request:t.request,mode:t.mode,base:t.base,workshop:revised});
  }
  async run(){
    reviewedWorkshop(this.task);
    if(this.task?.status==='Ready'&&!this.busy)this.event('Human','Approved the reviewed plan, project brief and preservation checks.');
    return super.run();
  }
  async verify(t=this.task){reviewedWorkshop(t);return super.verify(t);}
  restart(){this.planOperation=null;this.preparing=null;this.reviewHistory=[];return super.restart();}
  cancel(){this.planOperation=null;this.preparing=null;return super.cancel();}
}
