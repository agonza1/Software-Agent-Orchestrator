// Generated code only runs inside QuickJS, never in this worker's JS realm.
const MODEL = 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/e6a3892a8c22cf87ff99583996149cf3cb32452b/gemma-4-E4B-it-web.litertlm';
let engine, quickJS;
async function load(progress) {
  if (engine) return;
  if (!navigator.gpu || !await navigator.gpu.requestAdapter()) throw Error('WebGPU is unavailable. Use a compatible desktop browser/GPU.');
  const { Engine } = await import('https://cdn.jsdelivr.net/npm/@litert-lm/core@0.12.1/+esm');
  const cache = await caches.open('sao-gemma-e4b-v1');
  let response = await cache.match(MODEL);
  if (!response) {
    progress('Downloading Gemma E4B (~3 GB)…');
    const download = await fetch(MODEL);
    if (!download.ok || !download.body) throw Error(`Model download failed (${download.status}).`);
    let bytes = 0, last = 0;
    const stream = download.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
      bytes += chunk.length;
      if (Date.now() - last > 500) { progress(`Downloading ${(bytes / 1e9).toFixed(2)} GB…`); last = Date.now(); }
      controller.enqueue(chunk);
    } }));
    // Stream to disk before loading; never buffer a multi-GB Blob in application memory.
    await cache.put(MODEL, new Response(stream, { headers: { 'Content-Type': 'application/octet-stream' } }));
    response = await cache.match(MODEL);
  }
  progress('Loading cached Gemma E4B into GPU memory…');
  engine = await Engine.create({ model: response.body, mainExecutorSettings: { maxNumTokens: 4096 } });
}
async function ask(role, prompt) {
  if (!engine) throw Error('Load Gemma first.');
  const conversation = await engine.createConversation({
    preface: { messages: [{ role: 'system', content: `You are the ${role} agent in a small software workflow. Follow the supplied output format exactly.` }], extra_context: { enable_thinking: false } },
    sessionConfig: { maxOutputTokens: 1024 },
  });
  try {
    const response = await conversation.sendMessage(prompt);
    return (response.content ?? []).filter(c => typeof c.text === 'string').map(c => c.text).join('');
  } finally { await conversation.delete(); }
}
async function evaluate(source, inputs) {
  if (typeof source !== 'string' || source.length > 8000 || !Array.isArray(inputs) || inputs.length > 32) throw Error('Invalid evaluation request.');
  quickJS ??= await (await import('https://esm.sh/quickjs-emscripten@0.32.0')).getQuickJS();
  return inputs.map(input => {
    try {
      const deadline = Date.now() + 100;
      const json = quickJS.evalCode(`JSON.stringify((${source})(${JSON.stringify(input)}))`, {
        memoryLimitBytes: 8 * 1024 * 1024, maxStackSizeBytes: 256 * 1024,
        shouldInterrupt: () => Date.now() > deadline,
      });
      if (typeof json !== 'string' || json.length > 1024) throw Error('Invalid or oversized result.');
      return { value: JSON.parse(json) };
    } catch (error) { return { error: String(error?.message ?? error).slice(0, 240) }; }
  });
}
self.onmessage = async ({ data: { id, action, args = [] } }) => {
  try {
    let value;
    if (action === 'load') await load(progress => self.postMessage({ id, progress }));
    else if (action === 'ask') value = await ask(...args);
    else if (action === 'evaluate') value = await evaluate(...args);
    else throw Error('Unknown operation.');
    self.postMessage({ id, value });
  } catch (error) { self.postMessage({ id, error: String(error?.message ?? error) }); }
};
