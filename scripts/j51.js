// 前程无忧(51job)批量抓取：搜索页卡片 → 严格匹配 → 精选技术岗 → jobs.51job.com 域抓详情JD
const fs = require('fs');
const path = require('path');
const { CDP, navigate, evaluate, sleep } = require('./cdp.js');
const { pick, pickOrCreate } = require('./cdpx.js');
const { normName, matchCompany, scopeOf, HARD_BAD, score } = require('./common.js');

const P = require('./paths.js');
const CFG = P.loadConfig();

// 名单与输出目录跟随工作目录（环境变量 SCRAPE_DIR），不写死在脚本旁边
const ALL = P.loadCompanies();
const OUT = P.out('job51_all.jsonl');
const PROG = P.progress('j51');
const FUNC_SRC = fs.readFileSync(path.join(__dirname, 'j51_func.js'), 'utf8');

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? +args[i + 1] : 999; })();
const ONLY = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const NJOBS = (() => { const i = args.indexOf('--jobs'); return i >= 0 ? +args[i + 1] : (CFG.nJobsPerCompany || 4); })();

const doneKeys = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const d = JSON.parse(line); if (d && d.n && d.ok) doneKeys.add(d.n); } catch {}
  }
}

const WF_RE = /五险|一金|年终奖|奖金|带薪|年假|培训|体检|旅游|补贴|福利|节日|双休|包吃|包住|班车|期权|六险|保险|团建|加班|通讯|全勤|住房|下午茶|双薪|晋升|聚餐|礼物|出国|奖励|提成|分红|年金|补充|公积金|房补|餐补|话补|年度|健康|活动|发展空间|岗位晋升|技能培训/;

const httpJSON = (p, method = 'GET') => new Promise((res, rej) => {
  const req = require('http').request({ host: '127.0.0.1', port: 9222, path: p, method }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(d); } });
  });
  req.on('error', rej); req.end();
});

/* ---------- 连接：搜索页 + 详情页 ---------- */
let Ts = null, Cs = null;    // we.51job.com  搜索
let Td = null, Cd = null;    // jobs.51job.com 详情

async function ensureDetailTab() {
  if (Td) {
    // 校验标签页还在
    try {
      const list = await httpJSON('/json/list');
      if (list.some(t => t.id === Td.id)) return Td;
    } catch {}
    Td = null; try { Cd && Cd.close(); } catch {} Cd = null;
  }
  // 先找现成的，没有就新建（详情页必须在 jobs.51job.com 域内才能同源 fetch）
  Td = await pickOrCreate('jobs.51job.com', 'https://jobs.51job.com/');
  return Td;
}
async function connS(force = false) {
  if (!force && Cs && !Cs.dead) return Cs;
  try { if (Cs) Cs.close(); } catch {}
  // 搜索页优先 we.51job.com；找不到再新建（jobs.51job.com 是详情页，不能当搜索页用）
  if (!Ts) Ts = await pick('we.51job.com') || await pickOrCreate('we.51job.com', 'https://we.51job.com/pc/search');
  if (!Ts) throw new Error('NO_51JOB_TAB');
  Cs = await CDP.connect(Ts.webSocketDebuggerUrl);
  await Cs.send('Runtime.enable');
  return Cs;
}
async function connD(force = false) {
  if (!force && Cd && !Cd.dead) return Cd;
  try { if (Cd) Cd.close(); } catch {}
  await ensureDetailTab();
  Cd = await CDP.connect(Td.webSocketDebuggerUrl);
  await Cd.send('Runtime.enable');
  // 注入详情抓取函数（详情标签页只做 fetch、不导航，注入一次即长期有效）
  await evaluate(Cd, FUNC_SRC, false).catch(() => {});
  return Cd;
}

async function loadCards(kw) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      return await (async () => {
        // 第2次起强制换页：51job 搜索页偶尔卡在 "Loading..."（SPA 数据请求未回落），
        // 此时同一个标签页重试永远失败，必须重置 Ts 让它重新挑/新建标签页
        if (i >= 2) { Ts = null; }
        const c = await connS(i > 0);
        const url = 'https://we.51job.com/pc/search?keyword=' + encodeURIComponent(kw);
        const nav = await navigate(c, url, 35000);
        if (typeof nav === 'string' && nav === 'TIMEOUT') throw new Error('NAV_TIMEOUT');
        if (typeof nav === 'string' && nav.startsWith('ERROR')) throw new Error('NAV_ERROR');
        await sleep(1000);
        await evaluate(c, FUNC_SRC, false).catch(() => {});
        for (let w = 0; w < 25; w++) {          // 最长约 20s，够慢速首屏渲染
          await sleep(800);
          if (w % 3 === 2) await evaluate(c, FUNC_SRC, false).catch(() => {});
          try {
            const raw = await evaluate(c, 'window.__j51Cards ? window.__j51Cards() : "[]"');
            const arr = JSON.parse(raw || '[]');
            if (arr.length) return arr;
          } catch {}
          // 卡在 Loading 就硬刷新一次
          if (w === 10) {
            try {
              const t = await evaluate(c, 'document.body.innerText.slice(0,400)');
              if (/Loading\.\.\./i.test(t || '')) { await c.send('Page.reload', { ignoreCache: true }); await sleep(4000); await evaluate(c, FUNC_SRC, false).catch(() => {}); }
            } catch {}
          }
        }
        let txt = '';
        try { txt = await evaluate(c, 'document.body.innerText.slice(0,1500)'); } catch {}
        if (/拖动到最右边|访问验证|滑动/.test(txt || '')) throw new Error('CAPTCHA51');
        if (/没有找到|暂无|无相关|换个/.test(txt || '')) return [];
        throw new Error('NO_CARDS');
      })();
    } catch (e) {
      last = e; Cs = null;
      if (/CAPTCHA51/.test(String(e.message))) { console.log('      ! 51job 触发滑块验证，暂停 60 秒…'); await sleep(60000); }
      else await sleep(1500);
    }
  }
  throw last;
}

async function fetchJD(jobId) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const c = await connD(i > 0);
      const out = await evaluate(c, 'window.__j51Detail(' + JSON.stringify(String(jobId)) + ')');
      const d = JSON.parse(out || '{}');
      if (d.err && /HTTP(405|403|429)/.test(d.err)) throw new Error(d.err);
      return d;
    } catch (e) { last = e; Cd = null; await sleep(1500); }
  }
  return { err: 'FETCH_FAIL ' + String(last && last.message || last).slice(0, 50) };
}

(async () => {
  P.ensureData();
  await connS();
  console.log('search tab:', Ts.url);
  await connD();
  console.log('detail tab:', Td.url);

  const fd = fs.openSync(OUT, 'a');
  const log = s => console.log(s);
  try {
    const todo = ALL.filter(x => !ONLY || ONLY.includes(x.n)).filter(x => !doneKeys.has(x.n)).slice(0, LIMIT);
    log(`=== ${new Date().toLocaleTimeString()} 51job待抓 ${todo.length} 家 / 总 ${ALL.length} 家 / 已完成 ${doneKeys.size} 家 ===`);

    let ok = 0, miss = 0, err = 0;
    for (let i = 0; i < todo.length; i++) {
      const co = todo[i];
      const rec = { n: co.n, kw: co.kw, src: '前程无忧' };
      try {
        const kws = [co.kw];
        if (co.alt) kws.push(co.alt);
        let cards = [], hit = null, usedKw = co.kw, lastErr = '';
        for (const kw of kws) {
          let got = null;
          try { got = await loadCards(kw); } catch (e) { lastErr = String(e.message || e); }
          if (got && got.length) { cards = got; usedKw = kw; hit = matchCompany(cards, co.n, co.must); }
          if (hit) break;
        }
        if (!cards.length) {
          rec.notFound = 1; miss++;
          if (lastErr) rec.err = lastErr.slice(0, 90);
        } else if (!hit) {
          rec.notFound = 1;
          rec.candidates = [...new Set(cards.map(x => x.company).filter(Boolean))].slice(0, 8);
          miss++;
        } else {
          const key = hit.key;
          const pool = scopeOf(cards, co.n, co.must, hit);
          const seen = new Set();
          const uniq = pool.filter(x => { if (!x.jobName || seen.has(x.jobName)) return false; seen.add(x.jobName); return true; });
          let list = uniq.filter(j => !HARD_BAD.test(j.jobName));
          if (list.length < 2) list = uniq.slice();
          list.sort((a, b) => score(b.jobName, b.salary, b.city) - score(a.jobName, a.salary, a.city));
          const picked = list.slice(0, NJOBS);

          const jobs = [];
          for (const j of picked) {
            let d = {};
            if (j.jobId) { try { d = await fetchJD(j.jobId); } catch (e) { d = { jd: '', err: String(e.message).slice(0, 50) }; } }
            const skills = (j.tags || []).filter(t => !WF_RE.test(t));
            const wf = (j.tags || []).filter(t => WF_RE.test(t));
            const welfare = (d.welfare && d.welfare.length ? d.welfare.filter(x => !/职位描述|竞争力分析|微信分享/.test(x)).join('、') : wf.join('、'));
            jobs.push({
              jobName: j.jobName, salary: j.salary, city: j.city, exp: j.exp, edu: j.edu,
              skillTags: skills, welfare: welfare,
              jd: (d.jd && d.jd.length > 20) ? d.jd : '',
              companyIntro: d.corp || '',
              detailUrl: j.jobId ? ('https://jobs.51job.com/all/' + j.jobId + '.html') : '',
              publish: j.publish
            });
            await sleep(900 + Math.random() * 700);
          }
          const com = pool.filter(x => x.company);
          const freq = {};
          com.forEach(x => { freq[x.company] = (freq[x.company] || 0) + 1; });
          rec.target = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || hit.card.company;
          rec.industry = hit.card.industry || '';
          rec.property = hit.card.property || '';
          rec.scale = hit.card.scale || '';
          rec.matchKey = key;
          rec.nJobs = uniq.length;
          rec.allJobs = uniq.map(j => j.jobName + '|' + j.salary + '|' + j.city);
          rec.jobs = jobs;
          if (jobs.length) { rec.ok = 1; ok++; } else { rec.err = 'no jobs picked'; err++; }
        }
      } catch (e) {
        rec.err = String(e.message || e).slice(0, 120); err++;
      }
      fs.writeSync(fd, JSON.stringify(rec) + '\n');
      const tag = rec.ok ? 'OK  ' : rec.notFound ? 'MISS' : 'ERR ';
      const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      log(`  [${i + 1}/${todo.length}] ${ts} ${tag} ${co.n} => ${rec.target || '-'} | 岗位${(rec.jobs || []).length}${(rec.jobs && rec.jobs[0]) ? ' | JD' + ((rec.jobs[0].jd || '').length) + '字' : ''}${rec.scale ? ' | ' + rec.scale : ''}${rec.err ? ' | ' + rec.err : ''}${!rec.target && rec.candidates ? ' | 候选:' + rec.candidates.slice(0, 3).join(' / ') : ''}`);
      try { fs.writeFileSync(PROG, JSON.stringify({ done: i + 1, total: todo.length, ok, miss, err, last: co.n, ts })); } catch {}
      if ((i + 1) % 12 === 0) { await connS(true).catch(() => {}); await connD(true).catch(() => {}); }
      await sleep(P.paceMs(CFG, 'job51'));
    }
    log(`\n完成：OK ${ok} / MISS ${miss} / ERR ${err}`);
  } finally {
    try { fs.closeSync(fd); } catch {}
    try { Cs.close(); } catch {}
    try { Cd.close(); } catch {}
  }
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });
