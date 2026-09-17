// 关闭某个站点堆积的 CDP 标签页（长时间抓取后智联/猎聘会漏十几个，是浏览器内存压力的主要来源）
// 用法:
//   node close_tabs.js zhilian              关闭该站点全部标签页
//   node close_tabs.js zhilian --keep       保留 1 个（最近打开的搜索页）
//   node close_tabs.js all                  关闭四个站点的全部标签页
const http = require('http');

const PORT = +(process.env.CDP_PORT || 9222);

function req(path, method = 'GET') {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

const HOSTS = {
  job51: /51job\.com/,
  liepin: /liepin\.com/,
  zhilian: /zhaopin\.com/,
  boss: /zhipin\.com/,
};

(async () => {
  const key = process.argv[2];
  const keep = process.argv.includes('--keep');
  const keys = key === 'all' ? Object.keys(HOSTS) : [key];
  if (!keys.length || keys.some(k => !HOSTS[k])) {
    console.log('用法: node close_tabs.js <51job|liepin|zhilian|boss|all> [--keep]');
    process.exit(1);
  }

  const list = JSON.parse(await req('/json/list'));
  let grand = 0;
  for (const k of keys) {
    const pages = list.filter(t => t.type === 'page' && HOSTS[k].test(t.url || ''));
    if (!pages.length) { console.log(`[${k}] 无标签页`); continue; }
    const keepIds = new Set();
    if (keep) {
      // 搜索类页面优先保留
      const search = pages.find(t => /pc\/search|\/zhaopin\/|\/jobs\/|geek\/jobs/.test(t.url || '')) || pages[0];
      keepIds.add(search.id);
    }
    let closed = 0;
    for (const p of pages) {
      if (keepIds.has(p.id)) { console.log('  keep  ', (p.url || '').slice(0, 80)); continue; }
      await req('/json/close/' + p.id);
      console.log('  closed', (p.url || '').slice(0, 80));
      closed++;
    }
    grand += closed;
    console.log(`[${k}] 共 ${pages.length} 个标签页 → 关闭 ${closed}，保留 ${keepIds.size}`);
  }
  console.log('合计关闭', grand, '个标签页');
})();
