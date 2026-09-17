// 定点连接指定标签页：node cdpx.js <hostKeyword> eval|nav|info "<arg>"
const { CDP, httpJSON, navigate, evaluate, sleep } = require('./cdp.js');

async function pick(host) {
  const list = await httpJSON('/json/list');
  const pages = (Array.isArray(list) ? list : []).filter(t => t.type === 'page');
  return pages.find(t => (t.url || '').includes(host));
}

// 找现成标签页；没有就新建一个（避免用户/脚本手动关掉标签页后直接 NO_*_TAB 中断整个抓取）
async function pickOrCreate(host, url) {
  let t = await pick(host);
  if (t) return t;
  t = await httpJSON('/json/new?' + encodeURIComponent(url || ('https://' + host)), 'PUT');
  if (typeof t === 'string') { try { t = JSON.parse(t); } catch { t = null; } }
  await sleep(3000);
  // 新建后回读一次，确保拿到可用于 CDP 的 target
  return (t && t.webSocketDebuggerUrl) ? t : await pick(host);
}

if (require.main === module) {
  (async () => {
    const [host, cmd, ...rest] = process.argv.slice(2);
    const t = await pick(host);
    if (!t) { console.log('NO_TARGET for ' + host); process.exit(1); }
    const c = await CDP.connect(t.webSocketDebuggerUrl);
    try {
      if (cmd === 'info') {
        console.log(JSON.stringify({ url: t.url, title: t.title, id: t.id }, null, 2));
      } else if (cmd === 'eval') {
        const v = await evaluate(c, rest.join(' '));
        console.log(typeof v === 'string' ? v : JSON.stringify(v));
      } else if (cmd === 'nav') {
        console.log(await navigate(c, rest[0]));
      }
    } finally { c.close(); }
  })().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
}
module.exports = { pick, pickOrCreate };
