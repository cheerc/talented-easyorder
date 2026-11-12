// throwaway #719 prober: Emulator latency per document, owner token, every 500ms
const B = 'http://127.0.0.1:8080/v1/projects/demo-easyorder/databases/(default)';
const H = { Authorization: 'Bearer owner', 'content-type': 'application/json' };
const docs = ['system/accessLease', 'system/dataHead', 'operators/none'];
const one = async doc => {
  const t = Date.now();
  try {
    const r = await fetch(`${B}/documents:batchGet`, { method: 'POST', headers: H, body: JSON.stringify({ documents: [`projects/demo-easyorder/databases/(default)/documents/${doc}`] }) });
    const x = await r.text();
    const ms = Date.now() - t;
    if (ms > 800) console.log(`[PROBE] ${new Date(t).toISOString()} batchGet ${doc} ${r.status} ${ms}ms readTime=${(x.match(/"readTime": "([^"]+)"/) || [])[1]}`);
  } catch (e) { console.log(`[PROBE] ${new Date(t).toISOString()} batchGet ${doc} ERR ${e}`); }
};
setInterval(() => { for (const d of docs) void one(d); }, 500);
