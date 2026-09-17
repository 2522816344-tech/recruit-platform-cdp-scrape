// BOSS直聘批量抓取：/wapi/zpgeek 搜索 API → 品牌严格匹配 → card.json 取完整 JD
// 要点：请求节流 + code36/37 熔断退避（BOSS 对突发请求很敏感，宁可慢不可断）
const fs = require('fs');
const path = require('path');
const { CDP, navigate, evaluate, sleep } = require('./cdp.js');
const { pick, pickOrCreate } = require('./cdpx.js');
const { normName, matchCompany, HARD_BAD, score, LOCAL: LOCAL_CITY } = require('./common.js');

const P = require('./paths.js');
const CFG = P.loadConfig();

// 名单与输出目录跟随工作目录（环境变量 SCRAPE_DIR），不写死在脚本旁边
const ALL = P.loadCompanies();
const OUT = P.out('boss_all.jsonl');
const PROG = P.progress('boss');

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const LIMIT = +argOf('--limit', 999);
const ONLY = (() => { const v = argOf('--only', null); return v ? v.split(',') : null; })();
const NJOBS = +argOf('--jobs', CFG.nJobsPerCompany || 5);
const NPAGES = +argOf('--pages', 2);
const BOSS_TAB = argOf('--tab', 'zhipin.com');
const PACE = +argOf('--pace', 1);          // 节流倍率

const CITY_ALL = '100010000';   // 全国
// 本地城市编码从 config.json 读：BOSS 的城市码与智联(530)完全不同，切勿混用
const CITY_CS = (CFG.localCityParam && CFG.localCityParam.boss) || '101250100';

const doneKeys = new Set();
const doneSeen = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d && d.n) { doneSeen.add(d.n); if (d.ok) doneKeys.add(d.n); }
    } catch {}
  }
}

/* 页面内：单次搜索请求（重试与退避交由 Node 侧控制） */
const LIST_FN = `(async function(kw, city, pages){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const u = p => '/wapi/zpgeek/search/joblist.json?query=' + encodeURIComponent(kw) + '&city=' + city + '&page=' + p + '&pageSize=30';
  let all = [];
  for (let p = 1; p <= pages; p++) {
    let d = null;
    try {
      const r = await fetch(u(p), { credentials: 'include' });
      const txt = await r.text();
      if (txt.slice(0, 1) === '<') return JSON.stringify({ code: -1, msg: 'HTML页(风控/验证)', list: [] });
      d = JSON.parse(txt);
    } catch (e) { return JSON.stringify({ code: -2, msg: String(e).slice(0, 60), list: [] }); }
    if (d.code !== 0) return JSON.stringify({ code: d.code, msg: d.message || '', list: [] });
    const jl = (d.zpData && d.zpData.jobList) || [];
    all = all.concat(jl);
    if (jl.length < 15) break;
    await sleep(900);
  }
  const seen = new Set();
  const list = all.filter(j => { const k = j.securityId || (j.jobName + j.brandName); if (seen.has(k)) return false; seen.add(k); return true; });
  return JSON.stringify({ code: 0, kw: kw, city: city, n: list.length, list: list.map(function(j){
    return {
      jobName: j.jobName || '', brand: j.brandName || '', salary: j.salaryDesc || '',
      city: (j.cityName || '') + (j.areaDistrict ? '·' + j.areaDistrict : '') + (j.businessZones ? '·' + j.businessZones : ''),
      exp: j.jobExperience || '', deg: j.jobDegree || '',
      skills: (j.skills || []).slice(0, 8).join(' '),
      welfare: (j.welfareList || []).slice(0, 10).join('、'),
      scale: j.brandScaleName || '', stage: j.brandStageName || '', industry: j.brandIndustry || '',
      boss: (j.bossName || '') + '/' + (j.bossTitle || ''),
      sec: j.securityId || ''
    };
  }) });
})`;

/* 页面内：取职位详情（JD 等） */
const CARD_FN = `(async function(sec){
  try {
    const r = await fetch('/wapi/zpgeek/job/card.json?securityId=' + encodeURIComponent(sec), { credentials: 'include' });
    const txt = await r.text();
    if (txt.slice(0, 1) === '<') return JSON.stringify({ err: 'HTML页', code: -1 });
    const d = JSON.parse(txt);
    if (d.code !== 0) return JSON.stringify({ err: 'code ' + d.code + ' ' + (d.message || ''), code: d.code });
    const c = (d.zpData && d.zpData.jobCard) || {};
    const com = c.brandComInfo || null;
    return JSON.stringify({
      jd: c.postDescription || '',
      addr: c.address || '',
      comInfo: com ? { name: com.brandName, scale: com.scaleName, stage: com.stageName, industry: com.industryName, intro: (com.brandIntroduction || '').slice(0, 400) } : null
    });
  } catch (e) { return JSON.stringify({ err: String(e).slice(0, 80) }); }
})`;

let T = null, C = null;
async function conn(force = false) {
  if (!force && C && !C.dead) return C;
  try { if (C) C.close(); } catch {}
  if (!T || force) { T = await pickOrCreate(BOSS_TAB, 'https://www.zhipin.com/web/geek/jobs'); if (!T) throw new Error('NO_BOSS_TAB'); }
  C = await CDP.connect(T.webSocketDebuggerUrl);
  await C.send('Runtime.enable');
  return C;
}
async function withConn(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(await conn(i > 0)); }
    catch (e) { last = e; C = null; await sleep(1200); }
  }
  throw last;
}
async function evalLong(c, expr, timeout = 90000) {
  const r = await c.send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true, userGesture: true,
  }, timeout);
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result ? r.result.value : undefined;
}

// 熔断：连续被风控时整轮冷却
let cooldownUntil = 0;
let riskHits = 0;
async function cool(reason, ms) {
  riskHits++;
  const wait = Math.round(ms * PACE);
  console.log(`      ⏸ 风控(${reason})，冷却 ${Math.round(wait / 1000)}s ...`);
  await sleep(wait);
}
function riskFree() { riskHits = 0; }

async function ensurePage() {
  return withConn(async c => {
    const href = await evaluate(c, 'location.href');
    if (typeof href === 'string' && href.includes('zhipin.com') && !/login|_security_check/.test(href)) return true;
    await navigate(c, 'https://www.zhipin.com/web/geek/job?query=' + encodeURIComponent('机器人') + '&city=' + CITY_ALL, 40000);
    await sleep(1200);
    return true;
  }, 2);
}

// 单次列表请求（带风控重试）
async function fetchList(kw, city) {
  for (let a = 0; a < 3; a++) {
    const got = await withConn(async c =>
      JSON.parse(await evalLong(c, LIST_FN + '(' + JSON.stringify(kw) + ',' + JSON.stringify(city) + ',' + NPAGES + ')', 90000) || '{}')
    ).catch(e => ({ code: -2, msg: String(e.message || e).slice(0, 60), list: [] }));
    if (got && got.code === 0) { riskFree(); return got; }
    const code = got ? got.code : -2;
    if (code === 36 || code === 37 || code === -1) {     // 风控
      await cool('code ' + code, a === 0 ? 50000 : 90000);
      await ensurePage().catch(() => {});
      continue;
    }
    if (a < 2) await sleep(2500);
  }
  return { code: 36, msg: '重试后仍被风控', list: [] };
}

async function fetchJD(sec) {
  if (!sec) return {};
  for (let a = 0; a < 3; a++) {
    const d = await withConn(async c =>
      JSON.parse(await evalLong(c, CARD_FN + '(' + JSON.stringify(sec) + ')', 40000) || '{}')
    ).catch(e => ({ err: String(e.message || e).slice(0, 60), code: -2 }));
    if (d && !d.err) { riskFree(); return d; }
    if (d && (d.code === 36 || d.code === 37 || d.code === -1)) {
      await cool('card code ' + d.code, a === 0 ? 45000 : 80000);
      continue;
    }
    if (d && /code 0/.test(d.err || '')) return d;   // 非风控的业务错误，直接返回
    if (a < 2) await sleep(2000);
  }
  return { err: '重试后失败' };
}

(async () => {
  P.ensureData();
  await ensurePage();
  await conn();
  console.log('target:', (T && T.url || '').slice(0, 90));
  const fd = fs.openSync(OUT, 'a');
  const log = s => console.log(s);
  try {
    const todo = ALL.filter(x => !ONLY || ONLY.includes(x.n)).filter(x => !doneKeys.has(x.n)).slice(0, LIMIT);
    log(`=== ${new Date().toLocaleTimeString()} BOSS待抓 ${todo.length} 家 / 总 ${ALL.length} 家 / 已完成 ${doneKeys.size} 家 / 节流×${PACE} ===`);

    let ok = 0, miss = 0, err = 0;
    for (let i = 0; i < todo.length; i++) {
      const co = todo[i];
      const rec = { n: co.n, kw: co.kw, src: 'BOSS直聘' };
      try {
        const kws = [co.kw];
        if (co.alt) kws.push(co.alt);
        let list = [], hit = null, usedKw = co.kw, lastErr = '';
        for (const kw of kws) {
          let got = null;
          for (const city of [CITY_ALL, CITY_CS]) {
            got = await fetchList(kw, city);
            if (got.code && got.code !== 0) { lastErr = 'code ' + got.code + (got.msg ? ' ' + got.msg : ''); got = null; continue; }
            if (got.list.length) { list = got.list; usedKw = kw; break; }
          }
          if (list.length) hit = matchCompany(list.map(x => ({ company: x.brand, _: x })), co.n);
          if (hit) break;
          await sleep(1200 * PACE);
        }

        // 命中但无本地岗位 → 补搜本地城市，确保本地岗位不漏
        if (hit && !list.some(x => LOCAL_CITY.test(x.city || ''))) {
          const ex = await fetchList(usedKw, CITY_CS);
          if (ex && ex.list && ex.list.length) {
            const known = new Set(list.map(x => x.jobName + '|' + x.city));
            for (const e of ex.list) if (!known.has(e.jobName + '|' + e.city)) list.push(e);
          }
        }

        if (!list.length) {
          rec.notFound = 1; miss++;
          if (lastErr) rec.err = lastErr.slice(0, 90);
        } else if (!hit) {
          rec.notFound = 1;
          rec.candidates = [...new Set(list.map(x => x.brand).filter(Boolean))].slice(0, 8);
          miss++;
        } else {
          const key = hit.key;
          const pool = list.filter(x => normName(x.brand).includes(key));
          const seen = new Set();
          const uniq = pool.filter(x => { if (!x.jobName || seen.has(x.jobName)) return false; seen.add(x.jobName); return true; });
          let cand = uniq.filter(j => !HARD_BAD.test(j.jobName));
          if (cand.length < 2) cand = uniq.slice();
          cand.sort((a, b) => score(b.jobName, b.salary, b.city) - score(a.jobName, a.salary, a.city));
          const picked = cand.slice(0, NJOBS);

          const jobs = [];
          for (const j of picked) {
            const d = await fetchJD(j.sec);
            jobs.push({
              jobName: j.jobName, salary: j.salary, city: j.city,
              exp: j.exp, deg: j.deg, skills: j.skills, welfare: j.welfare,
              boss: j.boss, addr: d.addr || '',
              comInfo: d.comInfo || null, jd: d.jd || '',
              detailUrl: 'https://www.zhipin.com/job_detail/' + (j.sec || ''),
              err: d.err || ''
            });
            await sleep((1600 + Math.random() * 1200) * PACE);
          }
          const brands = list.filter(x => normName(x.brand).includes(key) && x.brand);
          const freq = {};
          brands.forEach(x => { freq[x.brand] = (freq[x.brand] || 0) + 1; });
          const hc = hit.card._ || {};
          const ci = (jobs.find(x => x.comInfo) || {}).comInfo || null;
          rec.target = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || hit.card.company;
          rec.industry = (hc.industry || '') || (ci ? ci.industry : '');
          rec.scale = (hc.scale || '') || (ci ? ci.scale : '');
          rec.stage = (hc.stage || '') || (ci ? ci.stage : '');
          rec.matchKey = key;
          rec.nJobs = uniq.length;
          rec.allJobs = uniq.map(j => j.jobName + '|' + j.salary + '|' + j.city);
          rec.jobs = jobs;
          if (jobs.length) {
            rec.ok = 1; ok++;
            const noJd = jobs.filter(j => (j.jd || '').length < 20).length;
            if (noJd === jobs.length) rec.warn = 'JD全空';
            else if (noJd) rec.warn = noJd + '/' + jobs.length + ' 条JD为空';
          } else { rec.err = 'no jobs picked'; err++; }
        }
      } catch (e) {
        rec.err = String(e.message || e).slice(0, 120); err++;
      }
      fs.writeSync(fd, JSON.stringify(rec) + '\n');
      const tag = rec.ok ? 'OK  ' : rec.notFound ? 'MISS' : 'ERR ';
      const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      log(`  [${i + 1}/${todo.length}] ${ts} ${tag} ${co.n} => ${rec.target || '-'} | 岗位${(rec.jobs || []).length}${rec.nJobs ? '/' + rec.nJobs : ''}${rec.scale ? ' | ' + rec.scale : ''}${rec.err ? ' | ' + rec.err : ''}${!rec.target && rec.candidates ? ' | 候选:' + rec.candidates.slice(0, 3).join(' / ') : ''}`);
      try { fs.writeFileSync(PROG, JSON.stringify({ done: i + 1, total: todo.length, ok, miss, err, last: co.n, ts })); } catch {}
      if ((i + 1) % 8 === 0) await conn(true).catch(() => {});
      // 命中较多时多歇一会，降低风控概率
      await sleep(P.paceMs(CFG, 'boss') * PACE);
      if (riskHits >= 3) { await cool('连续风控', 120000); await ensurePage().catch(() => {}); riskFree(); }
    }
    log(`\n完成：OK ${ok} / MISS ${miss} / ERR ${err}`);
  } finally {
    try { fs.closeSync(fd); } catch {}
    try { C.close(); } catch {}
  }
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });
