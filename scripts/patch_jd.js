// 补抓缺失的岗位 JD：只对 jd 为空的岗位重试（慢速 + 退避重试 + 阶段落盘）。
// 用法：node patch_jd.js [job51|liepin|all] [--dry] [--jobs-only 公司A,公司B]
//   默认 all。--dry 只统计待补条数，不实际抓取。
// 背景：主流程节奏偏快时，详情页可能成片返回空 JD（不是没数据）。单独慢速补一轮成本很低。
const fs = require('fs');
const path = require('path');
const P = require('./paths.js');
const { CDP, evaluate, sleep } = require('./cdp.js');

const PORT = +(process.env.CDP_PORT || 9222);
const httpJSON = (p, method = 'GET') => new Promise((res, rej) => {
  const req = require('http').request({ host: '127.0.0.1', port: PORT, path: p, method }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(d); } });
  });
  req.on('error', rej); req.end();
});

// 各平台详情配方：detailUrl 里抠出调用参数 → 注入 func → 调用 window.__*Detail
const PF = {
  job51: {
    pfx: 'job51', host: /jobs\.51job\.com/, seed: 'https://jobs.51job.com/',
    func: 'j51_func.js',
    arg: j => (String(j.detailUrl || '').match(/(\d+)\.html/) || [])[1],
    call: a => 'window.__j51Detail(' + JSON.stringify(String(a)) + ')',
    // 返回体字段名（用于把结果写回 job）
    take: d => ({
      jd: d.jd || '',
      intro: d.corp || '',
      welfare: (d.welfare || []).filter(x => !/职位描述|竞争力分析|微信分享/.test(x)).join('、'),
    }),
  },
  liepin: {
    pfx: 'liepin', host: /liepin\.com/, seed: 'https://www.liepin.com/',
    func: 'liepin_func.js',
    arg: j => j.detailUrl,
    call: a => 'window.__lpDetail(' + JSON.stringify(String(a)) + ')',
    take: d => ({ jd: d.jd || '', intro: d.companyIntro || '', welfare: d.welfare || '' }),
  },
};

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const onlyIdx = argv.indexOf('--jobs-only');
const onlySet = onlyIdx >= 0 && argv[onlyIdx + 1]
  ? new Set(argv[onlyIdx + 1].split(',').map(s => s.trim()).filter(Boolean))
  : null;
// 找平台名时跳过 --jobs-only 的取值，避免把公司名误当平台
const positionals = argv.filter((a, i) => !a.startsWith('--') && !(onlyIdx >= 0 && i === onlyIdx + 1));
const which = (positionals.find(a => PF[a]) || 'all');
const LIST = which === 'all' ? Object.keys(PF) : [which];

async function conn(target) {
  let list = [];
  try { list = await httpJSON('/json/list'); } catch (e) { throw new Error('CDP 端口不通（' + PORT + '）：' + e.message); }
  const pages = (Array.isArray(list) ? list : []).filter(t => t.type === 'page');
  let t = pages.find(x => target.host.test(x.url || ''));
  if (!t) {
    t = await httpJSON('/json/new?' + encodeURIComponent(target.seed), 'PUT');
    await sleep(3000);
  }
  const c = await CDP.connect(t.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const src = fs.readFileSync(path.join(__dirname, target.func), 'utf8');
  await evaluate(c, src, false).catch(() => {});
  return c;
}

async function patchPlatform(key) {
  const target = PF[key];
  const OUT = P.out(target.pfx + '_all.jsonl');
  if (!fs.existsSync(OUT)) { console.log('[' + key + '] 无文件，跳过：' + OUT); return; }
  const lines = fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean);
  const raw = lines;
  const recs = lines.map(l => { try { return JSON.parse(l); } catch { return null; } });

  const todo = [];
  recs.forEach((d, ri) => {
    if (!d) return;
    if (onlySet && !onlySet.has(d.n)) return;
    (d.jobs || []).forEach((j, ji) => {
      if ((!j.jd || j.jd.length < 20) && j.detailUrl) {
        const a = target.arg(j);
        if (a) todo.push({ ri, ji, n: d.n, jobName: j.jobName, arg: a });
      }
    });
  });
  console.log('[' + key + '] 待补 JD 岗位数：' + todo.length);
  if (!todo.length || DRY) return;

  let c = await conn(target);
  // 落盘时保留未能解析的原始行，避免丢数据
  const flush = () => fs.writeFileSync(OUT, recs.map((r, i) => (r ? JSON.stringify(r) : raw[i])).join('\n') + '\n');
  let fixed = 0, failed = 0;
  for (let i = 0; i < todo.length; i++) {
    const it = todo[i];
    let parsed = null, last = '';
    for (let r = 0; r < 4; r++) {
      try {
        if (r > 0) { try { c.close(); } catch {} c = await conn(target); }  // 换标签页重连
        const out = await evaluate(c, target.call(it.arg));
        const d = JSON.parse(out || '{}');
        if (d && d.jd && d.jd.length > 20) { parsed = d; break; }
        last = (d && d.err) || 'EMPTY_JD';
      } catch (e) { last = String(e.message || e).slice(0, 60); try { c.close(); } catch {} }
    }
    if (parsed) {
      const t = target.take(parsed);
      const job = recs[it.ri].jobs[it.ji];
      job.jd = t.jd;
      if (t.intro) job.companyIntro = t.intro;
      if (t.welfare) job.welfare = t.welfare;
      fixed++;
      console.log('  [' + (i + 1) + '/' + todo.length + '] OK   ' + it.n + ' | ' + it.jobName + ' | JD' + t.jd.length + '字');
    } else {
      failed++;
      console.log('  [' + (i + 1) + '/' + todo.length + '] FAIL ' + it.n + ' | ' + it.jobName + ' | ' + last);
    }
    await sleep(1200 + Math.random() * 900);
    if ((i + 1) % 15 === 0) {
      flush();
      console.log('  … 阶段落盘（已补 ' + fixed + ' / 失败 ' + failed + '）');
      await sleep(2000);
    }
  }
  flush();
  console.log('[' + key + '] 补抓完成：成功 ' + fixed + ' / 失败 ' + failed + '\n');
  try { c.close(); } catch {}
}

(async () => {
  P.ensureData();
  for (const k of LIST) await patchPlatform(k);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });
