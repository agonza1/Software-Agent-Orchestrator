// Trusted official UI frame only. No HTTP fallback, credentials, or independent model.
function bridge(){
  try {
    const host=parent.__saoTaskBoard;
    if(parent!==window&&parent.location.origin===location.origin&&parent.document.getElementById('task-board-frame')?.contentWindow===window&&host?.version===1)return host;
  }catch{}
  throw Error('Open the Task board button inside Agents at Work. This page cannot run by itself.');
}
export async function boardRequest(path,options={}){return structuredClone(await bridge().request(path,structuredClone(options)));}
export function subscribeBoard(listener){return bridge().subscribe(listener);}
