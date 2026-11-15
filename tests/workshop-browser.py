#!/usr/bin/env python3
"""Workshop integration: production controller/UI/check harness with a synthetic model.
Default serves real files on localhost. --in-memory substitutes asset transport,
crypto and storage for restricted runners, but keeps real DOM checks and child CSP.
Neither mode loads Gemma or proves hosted Pages/GPU behavior.
"""
import argparse, functools, hashlib, http.server, json, pathlib, re, shutil, subprocess, tempfile, threading
from playwright.sync_api import sync_playwright, expect
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--in-memory',action='store_true')
p.add_argument('--screenshots',type=pathlib.Path,default=pathlib.Path(tempfile.gettempdir())/'workshop-previews')
args=p.parse_args();args.screenshots.mkdir(parents=True,exist_ok=True)
MODEL="""import {INITIAL_BUNDLE,GUIDED_PLAN,guidedDateEdit} from './page-baseline.mjs';
export class LocalModel {
 constructor(status=()=>{},state,activity=()=>{}){this.status=status;this.activityEvent=activity;this.ready=false;this.pending=null;this.identity={name:'SYNTHETIC browser test'};this.epoch=0;globalThis.__modelCalls=[];}
 async start(){this.ready=true;this.status('Synthetic model fixture ready');}
 async generate(role,prompt){const epoch=this.epoch;this.pending={role};globalThis.__modelCalls.push({role,prompt});this.activityEvent({type:'start',operation:'generate',role,inputChars:prompt.length});await new Promise(r=>setTimeout(r,role==='Coder'?350:100));this.pending=null;if(epoch!==this.epoch)throw Error('Fixture cancelled');const text=JSON.stringify(role==='Planner'?GUIDED_PLAN:role==='Coder'?guidedDateEdit(INITIAL_BUNDLE):{summary:'Synthetic model response; DOM checks execute separately.',cases:[]});this.activityEvent({type:'complete',operation:'generate',role,output:text});return text;}
 cancel(){this.epoch++;this.ready=false;this.pending=null;this.activityEvent({type:'stopped',message:'Fixture stopped'});}
}
"""
STORAGE="""export async function load(){return globalThis.__savedWorkspace?structuredClone(globalThis.__savedWorkspace):null;}export async function save(value){globalThis.__savedWorkspace=structuredClone(value);} """
IMPORT=re.compile(r"(?:from\s+|import\s+)(['\"])(\.[^'\"\n]+)\1")
def graph(entry,overrides):
    sources={}
    def visit(key):
        if key in sources:return
        source=overrides[key] if key in overrides else (ROOT/key).read_text()
        source=source.replace('import.meta.url',json.dumps('https://fixture.invalid/'+key))
        source=source.replace('document.head.append(stylesheet);','/* CSS preloaded by fixture. */').replace('doc.head.append(css);','/* CSS preloaded by fixture. */')
        if key=='demo/page-runtime.mjs':
            needle="iframe.src=(network==='restricted'?RESTRICTED_URL:PREVIEW_URL).href+'?preview-token='+token;"
            assert needle in source
            source=source.replace(needle,"iframe.srcdoc=globalThis.__previewTemplates[network].replace('__FIXTURE_PREVIEW_TOKEN__',token);")
        sources[key]=source
        for match in IMPORT.finditer(source):
            child=pathlib.PurePosixPath(key).parent.joinpath(match[2].split('?')[0]);parts=[]
            for part in str(child).split('/'):
                if part=='..':parts.pop()
                elif part!='.':parts.append(part)
            visit('/'.join(parts))
    visit(entry)
    return sources
BOOT="""async function boot(sources,entry){const urls={};function compile(key){if(urls[key])return urls[key];let source=sources[key];const re=/(?:from\\s+|import\\s+)(['"])(\\.[^'"\\n]+)\\1/g;for(const match of [...source.matchAll(re)]){const child=new URL(match[2],'https://fixture.invalid/'+key).pathname.slice(1),url=compile(child);source=source.replace(match[0],match[0].replace(match[1]+match[2]+match[1],JSON.stringify(url)));}return urls[key]=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));}globalThis.__fixtureImport=key=>import(compile(key));await import(compile(entry));}"""
server=None
try:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1512,'height':1100},device_scale_factor=1)
        page.set_default_timeout(7000)
        errors=[];external=[];routed=[];blocked=[];console=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda request:external.append(request.url) if 'example.invalid' in request.url else None)
        # No external test request is ever allowed to leave the runner.
        page.route('**/example.invalid/**',lambda route:(routed.append(route.request.url),route.abort()))
        page.on('requestfailed',lambda request:blocked.append((request.url,request.failure)) if 'example.invalid' in request.url else None)
        page.on('console',lambda msg:console.append(msg.text) if 'example.invalid' in msg.text else None)
        if args.in_memory:
            html=(ROOT/'demo/index.html').read_text()
            html=re.sub(r'<script[^>]*src=[^>]*></script>','',html)
            html=re.sub(r'<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>','',html)
            html=re.sub(r'<link[^>]*>','',html)
            page.set_content(html)
            for path in ['styles.css','agent-activity.css','workshop.css']:
                page.add_style_tag(content=(ROOT/'demo'/path).read_text())
            page.expose_function('__digest',lambda value:list(hashlib.sha256(bytes(value)).digest()))
            page.evaluate("""()=>{if(!crypto.randomUUID)crypto.randomUUID=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');if(!crypto.subtle)Object.defineProperty(crypto,'subtle',{value:{digest:async(_,data)=>new Uint8Array(await __digest(Array.from(new Uint8Array(data)))).buffer}});} """)
            harness=(ROOT/'demo/preview/runtime.mjs').read_text().replace("new URLSearchParams(location.search).get('preview-token')","'__FIXTURE_PREVIEW_TOKEN__'")
            templates={}
            for policy,path in [('standard','index.html'),('restricted','restricted.html')]:
                text=(ROOT/'demo/preview'/path).read_text().replace('<base href="../">','')
                text=text.replace('<script src="./preview/runtime.mjs"></script>','<script>'+harness.replace('</script','<\\/script')+'</script>')
                templates[policy]=text
            page.evaluate('(templates)=>{globalThis.__previewTemplates=templates}',templates)
            sources=graph('demo/app.mjs',{'demo/model.mjs':MODEL,'demo/storage.mjs':STORAGE})
            page.evaluate('async ({sources})=>{'+BOOT+';await boot(sources,"demo/app.mjs")}',{'sources':sources})
        else:
            class Handler(http.server.SimpleHTTPRequestHandler):
                def log_message(self,*args):pass
            server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
            threading.Thread(target=server.serve_forever,daemon=True).start()
            page.route('**/model.mjs*',lambda route:route.fulfill(content_type='text/javascript',body=MODEL))
            page.goto(f'http://127.0.0.1:{server.server_port}/demo/')
        page.evaluate("document.title='Workshop integration · synthetic model';const n=document.createElement('p');n.textContent='Integration test · synthetic model; real DOM checks'+"+json.dumps(' · in-memory asset transport' if args.in_memory else '')+";n.style='color:#f4cc8b;font-size:12px;padding:8px';document.querySelector('main').prepend(n)")
        expect(page.locator('#suggest-dates')).to_be_enabled()
        expect(page.locator('.suggestion-card')).to_have_count(3)
        page.locator('#suggest-dates').click()
        expect(page.locator('#mode')).to_have_value('live')
        expect(page.locator('#request')).to_have_value(re.compile('finance team'))
        assert page.evaluate('__modelCalls.length')==0
        page.locator('#workshop-context-open').click()
        page.locator('#workshop-brief').fill('Product: a synthetic finance inbox. Keep the explanation understandable to founders.')
        page.locator('#workshop-context-save').click()
        page.locator('#load-model').click()
        expect(page.locator('#plan')).to_be_enabled()
        page.screenshot(path=str(args.screenshots/'suggestions.png'),full_page=True)
        page.locator('#plan').click()
        expect(page.locator('#run')).to_be_enabled(timeout=30000)
        expect(page.locator('.workshop-suggestions')).not_to_be_visible()
        page.locator('#workshop-revise').click()
        page.locator('#workshop-feedback-text').fill('Use the existing dates and verify paid history.')
        page.locator('#workshop-feedback-submit').click()
        expect(page.locator('#run')).to_be_enabled(timeout=30000)
        assert page.evaluate('__modelCalls.length')==2
        assert page.evaluate('__modelCalls[1].prompt.includes("Human plan revision feedback")')
        page.locator('#run').click()
        page.locator('#show-run-log').click()
        expect(page.locator('#run-log-dialog')).to_be_visible()
        page.locator('#run-log-dialog').get_by_role('button',name='Close',exact=True).click()
        expect(page.locator('#accept')).to_be_enabled(timeout=30000)
        assert page.evaluate('__modelCalls.every(c=>c.prompt.includes("brief v2"))')
        page.locator('#workshop-review-open').click()
        expect(page.locator('#workshop-review')).to_contain_text('Preserved behavior')
        expect(page.locator('#workshop-review')).to_contain_text('Before: fail → PASS')
        page.locator('#workshop-review .source-change summary').first.click()
        page.screenshot(path=str(args.screenshots/'change-review.png'),full_page=True)
        page.locator('#workshop-review-close').click()
        page.locator('#accept').click()
        expect(page.locator('#artifact-title')).to_have_text('Accepted locally',timeout=30000)
        page.locator('#workshop-present').click()
        expect(page.locator('body')).to_have_class(re.compile('presentation-mode'))
        page.locator('#workshop-present').click()
        page.locator('#layout').click()
        expect(page.locator('#workspace')).to_have_class(re.compile('stacked'))
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        page.screenshot(path=str(args.screenshots/'stacked-layout.png'),full_page=True)
        page.locator('#layout').click()
        page.locator('#workshop-replay-open').click()
        page.locator('#checkpoint-seed').click()
        expect(page.locator('#checkpoint-version-1')).to_be_visible(timeout=30000)
        expect(page.locator('#workshop-replay')).to_contain_text('SEEDED example')
        expect(page.locator('#workshop-replay .evidence-line .fail')).to_have_count(1)
        page.screenshot(path=str(args.screenshots/'repair-walkthrough.png'),full_page=True)
        page.locator('#checkpoint-version-1').click()
        expect(page.locator('#workshop-replay .evidence-line .fail')).to_have_count(0)
        calls=page.evaluate('__modelCalls.length')
        # Failed imports leave the current app, accepted state and checkpoints intact.
        count=page.locator('#checkpoint-select option').count()
        page.locator('#checkpoint-import').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':b'{"schema":3}'})
        expect(page.locator('#workshop-replay')).to_contain_text('Not a supported workshop pack')
        assert page.locator('#checkpoint-select option').count()==count
        page.locator('#checkpoint-preview-open').click()
        expect(page.locator('.checkpoint-preview iframe')).to_have_count(1)
        expect(page.locator('#workshop-replay')).to_contain_text('Current app and approval state are unchanged.',timeout=15000)
        with page.expect_download() as download:
            page.locator('#checkpoint-export').click()
        pack_path=pathlib.Path(download.value.path());pack=pack_path.read_text();assert json.loads(pack)['kind']=='sao-workshop-pack'
        page.once('dialog',lambda d:d.accept())
        page.locator('#checkpoint-import').set_input_files({'name':'workshop-pack.json','mimeType':'application/json','buffer':pack.encode()})
        expect(page.locator('#workshop-replay')).to_contain_text('IMPORTED recording')
        expect(page.locator('.checkpoint-preview iframe')).to_have_count(0)
        assert page.evaluate('__modelCalls.length')==calls
        page.locator('#workshop-replay-close').click()
        expect(page.locator('#artifact-title')).to_have_text('Accepted locally')
        expect(page.locator('#workshop-replay-open')).to_be_focused()
        # Custom requests stay editable. Clear optional scenario checks for a different app.
        page.locator('#request').fill('Replace this with a small interactive trip planner.')
        expect(page.locator('#request')).to_have_value('Replace this with a small interactive trip planner.')
        page.locator('#workshop-context-open').click()
        for cb in page.locator('.workshop-checkbox input').all():cb.uncheck()
        page.locator('#workshop-brief').fill('A new sample application. No expense-specific requirements.')
        page.locator('#workshop-context-save').click()
        expect(page.locator('.workshop-suggestions')).to_contain_text('groups: none')
        # Check restrictions in a genuine browser CSP, not a mocked pass/fail oracle.
        if args.in_memory:
            result=page.evaluate("""async()=>{const {runPageChecks}=await __fixtureImport('demo/page-runtime.mjs');return runPageChecks({html:'<p id="result">starting</p>',css:'',js:`const a=await Promise.allSettled([fetch('https://example.invalid/data'),import('https://example.invalid/code.mjs')]);document.getElementById('result').textContent=a.every(v=>v.status==='rejected')?'blocked':'escape';`},[{name:'External connections blocked',steps:[],assertions:[{selector:'#result',property:'text',operator:'equals',expected:'blocked'}]}],{network:'restricted'});} """)
            assert result['rows'][0]['pass'],result
            print('NETWORK',{'initiated':external,'routed':routed,'failed':blocked,'console':console},flush=True)
            assert not routed,routed
            assert any('violates' in msg and 'Content Security Policy' in msg for msg in console),console
        page.set_viewport_size({'width':390,'height':844})
        page.locator('#workshop-context-open').click()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        page.screenshot(path=str(args.screenshots/'permissions-mobile.png'),full_page=True)
        page.keyboard.press('Escape')
        expect(page.locator('#workshop-context')).not_to_be_visible()
        page.emulate_media(reduced_motion='reduce')
        page.locator('#workshop-present').click()
        expect(page.locator('body')).to_have_class(re.compile('presentation-mode'))
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        page.locator('#workshop-present').click()
        page.set_viewport_size({'width':1512,'height':1100})
        # Existing Guided flow remains a distinct scripted example.
        page.once('dialog',lambda d:d.accept());page.locator('#reset').click()
        page.locator('#mode').select_option('guided');page.locator('#plan').click()
        expect(page.locator('#run')).to_be_enabled(timeout=30000);page.locator('#run').click()
        expect(page.locator('#accept')).to_be_enabled(timeout=30000)
        assert not errors,errors
        print('PASS: suggestions/free-form requests, versioned shared brief, plan revision, real preservation DOM checks, existing logs, source review, acceptance, presentation toggle, real seeded failure/repair checks, portable read-only import, CSP fetch/import blocking, mobile width, keyboard close, and original Guided flow.')
        print('Evidence: '+('IN-MEMORY transport/crypto/storage + synthetic model; actual production controller, DOM harness, child CSP and workshop UI. No GPU, real-origin, IndexedDB or hosted proof.' if args.in_memory else 'Production page/check runtime with synthetic model. No GPU proof.'))
        browser.close()
finally:
    if server:server.shutdown()
