#!/usr/bin/env python3
"""Official task-board integration. Default: real page/runtime + synthetic model only.
--in-memory: also substitutes checks/storage and asset navigation for restricted runners.
Neither mode is evidence of Gemma quality; no model weights/provider calls are used.
Requires Python Playwright and Chromium. Screenshots stay outside the checkout.
"""
import argparse, functools, hashlib, http.server, json, pathlib, re, shutil, subprocess, tempfile, threading
from playwright.sync_api import sync_playwright, expect
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--in-memory',action='store_true');p.add_argument('--screenshots',type=pathlib.Path,default=pathlib.Path(tempfile.gettempdir())/'task-board-previews');args=p.parse_args();args.screenshots.mkdir(parents=True,exist_ok=True)
MODEL="""import {INITIAL_BUNDLE,GUIDED_PLAN,guidedDateEdit} from './page-baseline.mjs';
export class LocalModel {
 constructor(status=()=>{},state,activity=()=>{}){this.status=status;this.ready=false;this.pending=null;this.identity={name:'SYNTHETIC integration fixture'};this.metrics=[];this.epoch=0;}
 async start(){this.ready=true;this.status('Synthetic test model ready');}
 async generate(role){const epoch=this.epoch;this.pending={role};await new Promise(r=>setTimeout(r,role==='Coder'?700:40));this.pending=null;if(epoch!==this.epoch)throw Error('Fixture stopped');return JSON.stringify(role==='Planner'?GUIDED_PLAN:role==='Coder'?guidedDateEdit(INITIAL_BUNDLE):{summary:'Synthetic QA response; browser checks are separate.',cases:[]});}
 cancel(){this.epoch++;this.ready=false;this.pending=null;this.status('Fixture stopped');}
}
"""
RUNTIME="""// Test-only fallback. Default browser mode uses production page-runtime.mjs instead.
export async function runPageChecks(bundle,checks,{signal}={}){
 if(signal?.aborted)throw Error('Cancelled');await new Promise(r=>setTimeout(r,20));if(signal?.aborted)throw Error('Cancelled');
 const pass=bundle.html.includes('<th>Date</th>')&&bundle.js.includes("+'</small></td><td>'+e.date");
 return {errors:[],rows:checks.map(c=>({name:c.name,expected:c.assertions,actual:'Synthetic check adapter',pass})),observations:{text:'Synthetic check adapter',html:''}};
}
export async function createPagePreview(container,bundle){
 const f=document.createElement('iframe');f.title='Synthetic preview transport';f.sandbox='allow-scripts';f.style.cssText='width:100%;height:100%;border:0';
 f.srcdoc='<style>'+bundle.css+'</style>'+bundle.html+'<script type="module">'+bundle.js.replaceAll('</script','<\\/script')+'</script>';container.replaceChildren(f);return {destroy(){f.remove();}};
}
"""
STORAGE="""export async function load(){return globalThis.__fixtureWorkspace?structuredClone(globalThis.__fixtureWorkspace):null;}export async function save(value){globalThis.__fixtureWorkspace=structuredClone(value);} """
IMPORT=re.compile(r"(?:from\s+|import\s+)(['\"])(\.[^'\"\n]+)\1")
def graph(entry,overrides=None):
 sources={};overrides=overrides or {}
 def visit(key):
  if key in sources:return
  source=overrides.get(key,(ROOT/key).read_text())
  source=source.replace('import.meta.url',json.dumps('https://fixture.invalid/'+key))
  # Native modules still execute, but CSS and frame documents are supplied in memory.
  source=source.replace('document.head.append(css);','/* CSS is preloaded by the fixture. */').replace('doc.head.append(css);','/* CSS is preloaded by the fixture. */')
  if args.in_memory and key=='demo/task-board.mjs':source=source.replace("frame.src=new URL('./workboard/live.html',"+json.dumps('https://fixture.invalid/'+key)+").href",'frame.srcdoc=globalThis.__boardHtml').replace("if(!frame.getAttribute('src'))",'if(!frame.srcdoc)')
  sources[key]=source
  for match in IMPORT.finditer(source):
   child=str(pathlib.PurePosixPath(key).parent.joinpath(match[2]));parts=[]
   for part in child.split('/'):
    if part=='..':parts.pop()
    elif part!='.':parts.append(part)
   visit('/'.join(parts))
 visit(entry);return sources
BOOT="""async function boot(sources,entry){
 const urls={};function compile(key){if(urls[key])return urls[key];let source=sources[key];const re=/(?:from\\s+|import\\s+)(['"])(\\.[^'"\\n]+)\\1/g;
 for(const match of [...source.matchAll(re)]){const child=new URL(match[2],'https://fixture.invalid/'+key).pathname.slice(1),url=compile(child);source=source.replace(match[0],match[0].replace(match[1]+match[2]+match[1],JSON.stringify(url)));}
 return urls[key]=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));}await import(compile(entry));
}"""
def clean_html(path,styles):
 html=path.read_text();html=re.sub(r'<script[^>]*src=[^>]*></script>','',html);html=re.sub(r'<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>','',html);html=re.sub(r'<link[^>]*>','',html)
 return html.replace('</head>','<style>'+''.join((ROOT/s).read_text() for s in styles)+'</style></head>')
subprocess.run(['node','scripts/generate-live-workboard.mjs'],cwd=ROOT,check=True)
server=None
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page();page.set_default_timeout(5000);errors=[];page.on('pageerror',lambda e:(errors.append(str(e)),print('PAGEERROR',str(e),flush=True)))
  page.on('console',lambda m:print('CONSOLE',m.type,m.text,flush=True) if m.type=='error' else None)
  if args.in_memory:
   # No navigation to a blocked host: an explicit in-memory integration fixture.
   page.set_content(clean_html(ROOT/'demo/index.html',['demo/styles.css','demo/agent-activity.css','demo/run-log.css','demo/task-board.css']))
   page.expose_function('__digest',lambda value:list(hashlib.sha256(bytes(value)).digest()))
   page.evaluate("""()=>{if(!crypto.randomUUID)crypto.randomUUID=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');if(!crypto.subtle)Object.defineProperty(crypto,'subtle',{value:{digest:async(_,data)=>new Uint8Array(await __digest(Array.from(new Uint8Array(data)))).buffer}});} """)
   child=graph('demo/workboard/live-workboard.js')
   child_html=clean_html(ROOT/'demo/workboard/live.html',['demo/workboard/styles.css','demo/workboard/preview.css','demo/workboard/live.css'])
   script=BOOT+'\nboot('+json.dumps(child)+',"demo/workboard/live-workboard.js").catch(e=>parent.console.error(e));'
   child_html=child_html.replace('</body>','<script>'+script.replace('</script','<\\/script')+'</script></body>')
   page.evaluate('(html)=>{globalThis.__boardHtml=html}',child_html)
   sources=graph('demo/app.mjs',{'demo/model.mjs':MODEL,'demo/page-runtime.mjs':RUNTIME,'demo/storage.mjs':STORAGE})
   page.evaluate('async ({sources})=>{'+BOOT+';await boot(sources,"demo/app.mjs")}',{'sources':sources})
  else:
   class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
   server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
   page.route('**/demo/model.mjs',lambda route:route.fulfill(content_type='text/javascript',body=MODEL));page.goto(f'http://127.0.0.1:{server.server_port}/demo/')
  page.evaluate("document.title='Task-board test · synthetic model';const label=document.createElement('p');label.textContent='Integration test: synthetic model'+"+json.dumps(' and checks/storage' if args.in_memory else '')+";label.style='padding:8px;color:#e8bf78';document.querySelector('main').prepend(label)")
  expect(page.locator('#open-task-board')).to_be_enabled()
  page.locator('#load-model').click();expect(page.locator('#plan')).to_be_enabled()
  page.locator('#open-task-board').click();board=page.frame_locator('#task-board-frame');expect(board.locator('#new-task')).to_be_enabled()
  # Create with the actual official editor, not through a test-only direct store mutation.
  board.locator('#new-task').click();board.locator('#task-title').fill('Show expense dates');board.locator('#task-objective').fill("Let's add a date in table.");board.locator('#task-status').select_option('ready');board.locator('#save-task').click()
  expect(board.locator('#task-editor')).not_to_be_visible();expect(board.locator('#detail-title')).to_have_text('Show expense dates')
  expect(board.get_by_role('button',name='Open in builder',exact=True)).to_be_enabled()
  page.screenshot(path=str(args.screenshots/'editable-board.png'),full_page=True)
  board.get_by_role('button',name='Open in builder',exact=True).click();expect(page.locator('#task-board-dialog')).not_to_be_visible()
  expect(page.locator('#workboard-task-label')).to_contain_text('Show expense dates');expect(page.locator('#request')).to_have_value("Let's add a date in table.")
  # Handoff does not invoke the model. Plan review and final acceptance are still separate.
  expect(page.locator('#run')).to_be_disabled();page.locator('#plan').click();expect(page.locator('#run')).to_be_enabled(timeout=15000)
  page.locator('#run').click();page.locator('#open-task-board').click();expect(board.locator('#board-notice')).to_contain_text('Ready does not launch')
  page.locator('#board-close').click();expect(page.locator('#accept')).to_be_enabled(timeout=15000)
  page.locator('#accept').click();expect(page.locator('#artifact-title')).to_have_text('Accepted locally',timeout=15000)
  page.locator('#open-task-board').click();board.locator('#close-detail').click();expect(board.locator('#stage-done').get_by_role('button',name='View Show expense dates',exact=True)).to_be_visible()
  if not args.in_memory:
   page.locator('#board-close').click();page.reload();expect(page.locator('#open-task-board')).to_be_enabled();page.locator('#open-task-board').click();expect(board.locator('#stage-done').get_by_role('button',name='View Show expense dates',exact=True)).to_be_visible()

  # Create a dependent task. The accepted predecessor is Done and can unblock it.
  board.locator('#new-task').click();board.locator('#task-title').fill('Polish dates');board.locator('#task-objective').fill('Polish the date formatting.');board.locator('#task-status').select_option('ready');board.locator('#task-priority').select_option('1');options=board.locator('#task-dependencies option');dep=options.first.get_attribute('value');board.locator('#task-dependencies').select_option(dep);board.locator('#save-task').click();expect(board.locator('#task-editor')).not_to_be_visible()
  page.locator('#board-close').click();page.locator('#open-task-board').click();page.locator('#board-next-ready').click();expect(page.locator('#request')).to_have_value('Polish the date formatting.')
  expect(page.locator('#start-over')).to_be_visible();page.locator('#plan').click();expect(page.locator('#run')).to_be_enabled();page.locator('#run').click();expect(page.locator('#artifact-title')).to_have_text('Coder');page.locator('#cancel').click();expect(page.locator('#artifact-title')).to_have_text('Cancelled');page.wait_for_timeout(850);expect(page.locator('#accept')).not_to_be_visible();page.locator('#start-over').click();expect(page.locator('#workboard-task-label')).not_to_be_visible()
  page.locator('#open-task-board').click();board.locator('#close-detail').click();expect(board.locator('#stage-backlog').get_by_role('button',name='View Polish dates',exact=True)).to_be_visible()
  # Host-only Main/System controls stay disabled; no shadow runtime or credentials.
  board.locator('[data-view="system"]').click();expect(board.locator('#edit-agents')).to_be_disabled();board.locator('[data-view="main"]').click();expect(board.locator('#main-goal')).to_be_disabled()
  page.locator('#board-close').click();expect(page.locator('#open-task-board')).to_be_focused()
  # Original unqueued Guided flow still works after reset. Reset must clear task references too.
  page.once('dialog',lambda dialog:dialog.accept());page.locator('#reset').click();expect(page.locator('#open-task-board')).to_have_text('Tasks');page.locator('#mode').select_option('guided');page.locator('#plan').click();expect(page.locator('#run')).to_be_enabled();page.locator('#run').click();expect(page.locator('#accept')).to_be_enabled(timeout=15000)
  page.locator('#open-task-board').click();page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(args.screenshots/'mobile-board.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  page.locator('#board-close').click()
  assert not errors,errors
  print('PASS: official editor → explicit handoff → real controller plan/build/accept gate → Done, dependency selection, next-ready, active Stop/late-result fence, Start over, disabled host controls, unchanged Guided lifecycle, modal focus and mobile width.')
  print('EVIDENCE: '+('IN-MEMORY: model, checks, storage and asset transport substituted; no GPU/CSP/Pages proof.' if args.in_memory else 'Real page/check runtime; synthetic model only. No GPU proof.'))
  browser.close()
finally:
 if server:server.shutdown()
