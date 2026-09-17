// 智联招聘批量抓取：搜索页 __INITIAL_STATE__ → 严格匹配 → 精选技术岗 → fetch 详情页取完整 JD
const fs = require('fs');
const path = require('path');
const { CDP, navigate, evaluate, sleep } = require('./cdp.js');
const { pick, pickOrCreate } = require('./cdpx.js');
const { normName, matchCompany, scopeOf, HARD_BAD, score, LOCAL: LOCAL_CITY } = require('./common.js');

const P = require('./paths.js');
const CFG = P.loadConfig();

// 名单与输出目录跟随工作目录（环境变量 SCRAPE_DIR），不写死在脚本旁边
const ALL = P.loadCompanies();
const OUT = P.out('zhilian_all.jsonl');
const PROG = P.progress('zp');

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? +args[i + 1] : 999; })();
const ONLY = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const NJOBS = (() => { const i = args.indexOf('--jobs'); return i >= 0 ? +args[i + 1] : (CFG.nJobsPerCompany || 4); })();
const ZP_TAB = (() => { const i = args.indexOf('--tab'); return i >= 0 ? args[i + 1] : 'zhaopin.com'; })();

const doneKeys = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const d = JSON.parse(line); if (d && d.n && d.ok) doneKeys.add(d.n); } catch {}
  }
}

/* 页面内：从 __INITIAL_STATE__ 取搜索结果 */
const GRAB = `(function(){
  const s=window.__INITIAL_STATE__;
  if(!s) return JSON.stringify({err:'NO_STATE'});
  if(!s.positionList) return JSON.stringify({n:0,listEmpty:(s.listEmptyReason||'')});
  return JSON.stringify({
    kw:(s.queryParams&&s.queryParams.kw)||'',
    count:s.positionCount||s.positionList.length,
    list:s.positionList.map(function(p){
      const cj=(function(){try{return JSON.parse(p.cardCustomJson||'{}')}catch(e){return{}}})();
      return {
        jobName:p.name||'',
        company:p.companyName||'',
        companyNo:p.companyNumber||'',
        salary:p.salary60||(p.salaryReal?(p.salaryReal+'元'):'')||'',
        city:p.workCity||'',
        district:cj.address||p.cityDistrict||'',
        exp:p.workingExp||'',
        edu:p.education||'',
        size:p.companySize||'',
        tags:p.companyScaleTypeTagsNew||[],
        industry:p.industryName||'',
        property:p.property||'',
        financing:p.financingStage||'',
        skills:(p.skillLabel||[]).map(function(x){return x.value||x}).slice(0,8),
        welfare:(p.welfareLabel||[]).slice(0,10),
        url:(p.positionUrl||p.positionURL||'').replace(/^http:/,'https:'),
        summary:(p.jobDescription||'').slice(0,150),
        publish:p.publishTime||'',
        jobId:p.jobId
      };
    })
  });
})()`;

/* 页面内：fetch 详情页取完整 JD + 技能标签 + 福利 */
const JD_FN = `(async function(url){
  try{
    const r=await fetch(url,{headers:{'Accept':'text/html'}});
    if(r.status!==200) return JSON.stringify({err:'HTTP'+r.status});
    const t=await r.text();
    const doc=new DOMParser().parseFromString(t,'text/html');
    let jd='';
    const el=doc.querySelector('.describtion-card__detail-content');
    if(el){
      jd=Array.prototype.map.call(el.childNodes,function(n){
        return (n.textContent||'').replace(/\\u00a0/g,' ').replace(/[ \\t]+/g,' ').trim();
      }).filter(Boolean).join('\\n');
    }
    const skills=Array.prototype.map.call(doc.querySelectorAll('.describtion-card__skills-item'),function(x){return x.textContent.trim()}).filter(Boolean);
    const wf=Array.prototype.map.call(doc.querySelectorAll('.job-features__value'),function(x){return x.textContent.trim()}).filter(Boolean);
    const comp=(doc.querySelector('h1')||{}).textContent||'';
    return JSON.stringify({jd:jd, skills:skills, welfare2:wf, compTitle:comp.trim().slice(0,80)});
  }catch(e){ return JSON.stringify({err:String(e.message||e).slice(0,80)}); }
})`;

const searchUrl = (kw, city) => 'https://www.zhaopin.com/jobs?kw=' + encodeURIComponent(kw) + (city ? '&jl=' + city : '');

let T = null, C = null;
async function conn(force = false) {
  if (!force && C && !C.dead) return C;
  try { if (C) C.close(); } catch {}
  if (!T) { T = await pickOrCreate(ZP_TAB, 'https://www.zhaopin.com/jobs'); if (!T) throw new Error('NO_ZP_TAB'); }
  C = await CDP.connect(T.webSocketDebuggerUrl);
  await C.send('Runtime.enable');
  return C;
}
async function withConn(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(await conn(i > 0)); }
    catch (e) { last = e; C = null; await sleep(1500); }
  }
  throw last;
}

async function loadCards(kw, city) {
  return withConn(async c => {
    const nav = await navigate(c, searchUrl(kw, city), 30000);
    if (typeof nav === 'string' && nav === 'TIMEOUT') throw new Error('NAV_TIMEOUT');
    if (typeof nav === 'string' && nav.startsWith('ERROR')) throw new Error('NAV_ERROR');
    await sleep(800);
    let emptyHits = 0;
    for (let w = 0; w < 22; w++) {
      await sleep(600);
      try {
        const raw = await evaluate(c, GRAB);
        const d = JSON.parse(raw || '{}');
        if (d.err) throw new Error(d.err);
        // 关键：必须等 __INITIAL_STATE__ 的 kw 刷新成本次关键词，才采信 positionList。
        // BUG 教训：早期直接 `if (d.list.length) return d.list`，会把上一次搜索残留的卡片
        // 当成本次结果返回，导致候选里出现润滑油/人力资源/阿胶等完全无关公司、匹配失败。
        const kwOk = d.kw && normName(d.kw) === normName(kw);
        if (kwOk) {
          if (d.list && d.list.length) return d.list;
          // kw 已刷新但列表为空 → 连读 2 次确认为「确无结果」，避免空转等多轮
          if (++emptyHits >= 2) return [];
        }
      } catch (e) {
        if (/NO_STATE/.test(e.message)) continue;
      }
    }
    // 最后确认：只在 kw 匹配时才采信
    try {
      const d = JSON.parse(await evaluate(c, GRAB) || '{}');
      if (d.kw && normName(d.kw) === normName(kw)) {
        if (d.list && d.list.length) return d.list;
        return [];
      }
    } catch {}
    return null;
  });
}

async function fetchJD(url) {
  if (!url) return {};
  return withConn(async c => {
    const raw = await evaluate(c, JD_FN + '(' + JSON.stringify(url) + ')');
    return JSON.parse(raw || '{}');
  }, 2);
}

(async () => {
  P.ensureData();
  await conn();
  console.log('target:', T.url);
  const fd = fs.openSync(OUT, 'a');
  const log = s => console.log(s);
  try {
    const todo = ALL.filter(x => !ONLY || ONLY.includes(x.n)).filter(x => !doneKeys.has(x.n)).slice(0, LIMIT);
    log(`=== ${new Date().toLocaleTimeString()} 智联待抓 ${todo.length} 家 / 总 ${ALL.length} 家 / 已完成 ${doneKeys.size} 家 ===`);

    let ok = 0, miss = 0, err = 0;
    for (let i = 0; i < todo.length; i++) {
      const co = todo[i];
      const rec = { n: co.n, kw: co.kw, src: '智联招聘' };
      try {
        const kws = [co.kw];
        if (co.alt) kws.push(co.alt);
        let cards = [], hit = null, usedKw = co.kw, lastErr = '';
        for (const kw of kws) {
          let got = null;
          // 关键：不传 jl = 全国搜索（POST 里 city 显示 489 但结果实为全国，实测「机器人」返回杭州/青岛/深圳）
          // 注意 530=北京、749=长株潭，都不是全国，之前误用导致大量 MISS。
          // ''（全国）已是超集，无需再并列搜 749；本地岗位由下方「补搜本地城市」分支覆盖。
          for (const city of ['']) {
            try {
              got = await loadCards(kw, city);
              if (got && got.length) { cards = got; usedKw = kw; break; }
            } catch (e) { lastErr = String(e.message || e); got = null; }
          }
          if (cards.length) hit = matchCompany(cards, co.n, co.must);
          if (hit) break;
        }
        // 命中但无本地岗位时，补搜一次本地城市，确保本地岗位不漏
        if (hit && !cards.some(x => LOCAL_CITY.test(x.city || ''))) {
          try {
            const extra = await loadCards(usedKw, (CFG.localCityParam && CFG.localCityParam.zhilian) || '749');
            if (extra && extra.length) {
              const ex = matchCompany(extra, co.n, co.must);
              if (ex) {
                const known = new Set(cards.map(x => x.jobName + '|' + x.city));
                for (const e of scopeOf(extra, co.n, co.must, ex)) {   // 只并入同一家公司的卡片
                  if (!known.has(e.jobName + '|' + e.city)) cards.push(e);
                }
              }
            }
          } catch {}
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
            try { d = await fetchJD(j.url); } catch (e) { d = { jdErr: String(e.message || e).slice(0, 60) }; }
            const jd = (d.jd && d.jd.length > 20) ? d.jd : (j.summary || '');
            jobs.push({
              jobName: j.jobName, salary: j.salary, city: j.city, district: j.district,
              exp: j.exp, edu: j.edu, skillTags: (d.skills && d.skills.length ? d.skills : j.skills) || [],
              welfare: (d.welfare2 && d.welfare2.length ? d.welfare2.join('、') : (j.welfare || []).join('、')),
              jd: jd, detailUrl: j.url, publish: j.publish
            });
            await sleep(700 + Math.random() * 500);
          }
          const com = pool.filter(x => x.company);
          const freq = {};
          com.forEach(x => { freq[x.company] = (freq[x.company] || 0) + 1; });
          rec.target = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || hit.card.company;
          rec.industry = hit.card.industry || '';
          rec.property = hit.card.property || '';
          rec.size = hit.card.size || '';
          rec.financing = hit.card.financing || '';
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
      log(`  [${i + 1}/${todo.length}] ${ts} ${tag} ${co.n} => ${rec.target || '-'} | 岗位${(rec.jobs || []).length}${rec.size ? ' | ' + rec.size : ''}${rec.err ? ' | ' + rec.err : ''}${!rec.target && rec.candidates ? ' | 候选:' + rec.candidates.slice(0, 3).join(' / ') : ''}`);
      try { fs.writeFileSync(PROG, JSON.stringify({ done: i + 1, total: todo.length, ok, miss, err, last: co.n, ts })); } catch {}
      if ((i + 1) % 12 === 0) await conn(true).catch(() => {});
      await sleep(P.paceMs(CFG, 'zhilian'));
    }
    log(`\n完成：OK ${ok} / MISS ${miss} / ERR ${err}`);
  } finally {
    try { fs.closeSync(fd); } catch {}
    try { C.close(); } catch {}
  }
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });
