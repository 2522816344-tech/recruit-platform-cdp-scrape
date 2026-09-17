// 极简 Chrome DevTools Protocol 驱动（Node 22 内置 WebSocket）
const http = require('http');

const PORT = +(process.env.CDP_PORT || 9222);

function httpJSON(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.dead = false;
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
        else p.res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    };
    ws.onclose = () => this.kill('CDP closed');
    ws.onerror = () => this.kill('CDP error');
  }
  kill(reason) {
    this.dead = true;
    for (const [, p] of this.pending) { try { p.rej(new Error(reason)); } catch {} }
    this.pending.clear();
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = e => rej(new Error('WS connect failed: ' + (e.message || '')));
    });
    return new CDP(ws);
  }
  send(method, params = {}, timeout = 25000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      if (this.dead) return rej(new Error('CDP dead'));
      this.pending.set(id, { res, rej });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { this.pending.delete(id); return rej(e); }
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('CDP timeout: ' + method));
        }
      }, timeout);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

// 找到一个 zhipin 页面 target；没有就用 about:blank 页面 target
async function pickTarget() {
  const list = await httpJSON('/json/list');
  const pages = (Array.isArray(list) ? list : []).filter(t => t.type === 'page');
  return (
    pages.find(t => (t.url || '').includes('zhipin.com')) ||
    pages.find(t => (t.url || '') === 'about:blank') ||
    pages[0]
  );
}

// 判断当前页面是否已经是目标 URL（比对 origin/pathname/key 参数）
function samePage(href, want) {
  try {
    const a = new URL(href), b = new URL(want);
    if (a.origin !== b.origin || a.pathname !== b.pathname) return false;
    for (const k of ['key', 'city', 'query']) {
      const bv = b.searchParams.get(k);
      if (bv !== null && a.searchParams.get(k) !== bv) return false;
    }
    return true;
  } catch { return href === want; }
}

// 导航到指定 url，等到真正落在目标 URL 且加载完成
async function navigate(c, url, timeout = 45000) {
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Page.navigate', { url });
  const t0 = Date.now();
  let settled = false;
  while (Date.now() - t0 < timeout) {
    await sleep(400);
    try {
      const r = await c.send('Runtime.evaluate', {
        expression: 'document.readyState + "|" + location.href',
        returnByValue: true,
      });
      const v = r.result && r.result.value;
      if (typeof v !== 'string') continue;
      const i = v.indexOf('|');
      const rs = v.slice(0, i), href = v.slice(i + 1);
      if (href.startsWith('chrome-error')) return 'ERROR:' + href;
      if (rs === 'complete' && samePage(href, url)) {
        // 再确认一次 readyState，避免刚好卡在切换瞬间
        if (settled) return href;
        settled = true;
        await sleep(300);
        continue;
      }
      settled = false;
    } catch {}
  }
  return 'TIMEOUT';
}

// 执行 JS 并返回解析后的值
async function evaluate(c, expr, awaitPromise = true) {
  const r = await c.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result ? r.result.value : undefined;
}

module.exports = { CDP, httpJSON, pickTarget, navigate, evaluate, sleep, PORT };

// CLI 用法: node cdp.js eval "<js>"  |  node cdp.js nav <url>  |  node cdp.js info
if (require.main === module) {
  (async () => {
    const [cmd, ...rest] = process.argv.slice(2);
    const t = await pickTarget();
    if (!t) { console.log('NO_TARGET'); process.exit(1); }
    if (cmd === 'info') {
      console.log(JSON.stringify({ url: t.url, title: t.title, id: t.id }, null, 2));
      return;
    }
    const c = await CDP.connect(t.webSocketDebuggerUrl);
    try {
      if (cmd === 'eval') {
        const v = await evaluate(c, rest.join(' '));
        console.log(typeof v === 'string' ? v : JSON.stringify(v));
      } else if (cmd === 'nav') {
        const r = await navigate(c, rest[0]);
        console.log(r);
      }
    } finally { c.close(); }
  })().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
}
