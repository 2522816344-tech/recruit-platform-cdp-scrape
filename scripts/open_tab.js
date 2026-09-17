// 在调试端口新开一个标签页（抓取脚本的搜索页不会自建时，或需要独立探测时用）
// 用法:
//   node open_tab.js https://we.51job.com/
//   node open_tab.js                 (开 about:blank)
const http = require('http');

const PORT = +(process.env.CDP_PORT || 9222);
const url = process.argv[2] || 'about:blank';

function req(path, method = 'GET') {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

(async () => {
  const out = await req('/json/new?' + encodeURIComponent(url), 'PUT');
  try {
    const t = JSON.parse(out);
    console.log('新建标签页:', t.id, '|', t.url);
  } catch {
    console.log('返回:', String(out).slice(0, 200));
  }
})();
