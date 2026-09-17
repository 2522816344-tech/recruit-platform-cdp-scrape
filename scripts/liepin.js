// 猎聘批量抓取：搜索结果页 → 严格公司名匹配 → 精选技术岗 → 抓详情JD
const fs = require('fs');
const path = require('path');
const { CDP, navigate, evaluate, sleep } = require('./cdp.js');
const { pick, pickOrCreate } = require('./cdpx.js');

const P = require('./paths.js');
const CFG = P.loadConfig();

const FUNC_SRC = fs.readFileSync(path.join(__dirname, 'liepin_func.js'), 'utf8');
// 名单与输出目录跟随工作目录（环境变量 SCRAPE_DIR），不写死在脚本旁边
const ALL = P.loadCompanies();
const OUT = P.out('liepin_all.jsonl');

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

/* ---------- 公司名匹配（统一使用 common.js 的加固版逻辑） ---------- */
const { normName, matchCompany, scopeOf } = require('./common.js');

/* ---------- 岗位筛选 ---------- */
const HARD_BAD = /销售|客户经理|招商|渠道|人力|人事|行政|财务|会计|出纳|税务|审计|法务|前台|客服|实习|校招|导购|店长|司机|保安|保洁|助理|文员|组长|班长|普工|操作工|操作员|作业员|学徒|兼职|主播|运营|地推|电话|后勤|仓管|业务员|外贸|跟单|报关|单证|翻译|美工|编辑|策划|顾问|中介|HRBP|行销|招聘专员|培训专员|员工关系|学习发展|打字员|市场专员|品牌|公关|薪酬|绩效|秘书|内勤|收银|促销|门店|客户代表|商务专员/i;
const K1 = /算法|控制|机器人|关节|执行器|减速|谐波|电机|驱动|伺服|嵌入式|软件|硬件|结构|仿真|导航|感知|SLAM|动力学|电控|电气|机械|电子|光学|芯片|材料|工艺|测试|研发|工程师|技术|架构|数据|AI|人工智能/;
const K2 = /经理|主管|总监|生产|质量|设备|项目|产品|品质|制程|工装|模具|调试|装配|设计|计划|PMC/;

const salaryNum = s => {
  const t = s || '';
  const k = /(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\s*k/i.exec(t);
  if (k) return (+k[1] + +k[2]) / 2;
  const w = /(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\s*万/.exec(t);
  if (w) return (+w[1] + +w[2]) / 2 * 10;   // 万/年 → 月薪近似（÷12 前先换算）
  const sk = /(\d+(?:\.\d+)?)\s*k/i.exec(t);
  return sk ? +sk[1] : 0;
};
const LOCAL = /北京|海淀|朝阳|东城|西城|丰台|通州/;
const score = j => (K1.test(j.jobName) ? 100000 : K2.test(j.jobName) ? 30000 : 0)
  + salaryNum(j.salary) * 10
  + (LOCAL.test(j.city || '') ? 5000 : 0);

const searchUrl = kw => 'https://www.liepin.com/zhaopin/?key=' + encodeURIComponent(kw);

/* ---------- 连接管理（自动重连） ---------- */
let T = null, C = null;
async function conn(force = false) {
  if (!force && C && !C.dead) return C;
  try { if (C) C.close(); } catch {}
  if (!T) { T = await pickOrCreate('liepin.com', 'https://www.liepin.com/zhaopin/'); if (!T) throw new Error('NO_LIEPIN_TAB'); }
  C = await CDP.connect(T.webSocketDebuggerUrl);
  await C.send('Runtime.enable');
  return C;
}
async function withConn(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(await conn(i > 0)); }
    catch (e) {
      last = e;
      C = null;
      await sleep(1500);
    }
  }
  throw last;
}

/* ---------- 取卡片 ---------- */
async function loadCards(kw) {
  return withConn(async c => {
    const nav = await navigate(c, searchUrl(kw));
    if (typeof nav === 'string' && nav === 'TIMEOUT') throw new Error('NAV_TIMEOUT');
    if (typeof nav === 'string' && nav.startsWith('ERROR')) throw new Error('NAV_ERROR');
    if (typeof nav === 'string' && /verifysms|intercept/.test(nav)) throw new Error('INTERCEPT');
    if (typeof nav === 'string' && /captcha|safe\.liepin/.test(nav)) throw new Error('CAPTCHA');
    await sleep(600);
    await evaluate(c, FUNC_SRC, false).catch(() => {});
    for (let w = 0; w < 14; w++) {
      await sleep(500);
      // 页面重载会清空注入的上下文，周期性重新注入
      if (w % 3 === 2) await evaluate(c, FUNC_SRC, false).catch(() => {});
      try {
        const raw = await evaluate(c, 'window.__lpCards ? window.__lpCards() : "[]"');
        const arr = JSON.parse(raw || '[]');
        if (arr.length) return arr;
      } catch {}
    }
    // 确认是真的没有结果，还是页面没加载好
    let txt = '', href = '';
    try { txt = await evaluate(c, 'document.body.innerText.slice(0,1500)'); } catch {}
    try { href = await evaluate(c, 'location.href'); } catch {}
    if (/captcha|safe\.liepin/.test(href || '')) throw new Error('INTERCEPT');
    if (/没有找到|暂无|换个|无相关/.test(txt || '')) return [];
    throw new Error('NO_CARDS ctxlen=' + (txt || '').length);
  });
}

(async () => {
  P.ensureData();
  await conn();
  console.log('target:', T.url, '| 待抓关键词组已就绪');
  const fd = fs.openSync(OUT, 'a');
  const log = s => console.log(s);
  try {
    const todo = ALL.filter(x => !ONLY || ONLY.includes(x.n)).filter(x => !doneKeys.has(x.n)).slice(0, LIMIT);
    log(`=== ${new Date().toLocaleTimeString()} 待抓 ${todo.length} 家 / 总 ${ALL.length} 家 / 已完成 ${doneKeys.size} 家 ===`);

    let ok = 0, miss = 0, err = 0, fatal = '';
    for (let i = 0; i < todo.length; i++) {
      if (fatal) break;
      const co = todo[i];
      const rec = { n: co.n, kw: co.kw, src: '猎聘' };
      try {
        // 依次尝试：主关键词 → 备选关键词 → 关键词+招聘
        const kws = [co.kw];
        if (co.alt) kws.push(co.alt);
        kws.push(co.kw + '招聘');
        let cards = [], hit = null, usedKw = co.kw, lastErr = '';
        for (const kw of kws) {
          let got = null;
          for (let t = 0; t < 2; t++) {
            try { got = await loadCards(kw); lastErr = ''; break; }
            catch (e) {
              lastErr = String(e.message || e);
              if (/INTERCEPT/.test(lastErr)) { fatal = 'INTERCEPT'; break; }
              if (/CAPTCHA/.test(lastErr)) {
                log('      ! 触发人机验证，暂停 90 秒…');
                await sleep(90000);
                continue;
              }
              break;
            }
          }
          if (fatal) break;
          if (got === null) continue;
          cards = got;
          if (cards.length) { hit = matchCompany(cards, co.n, co.must); usedKw = kw; }
          if (hit) break;
        }
        if (fatal) {
          // 风控拦截：本轮无法继续，记录后整体中止
          rec.err = '账号被猎聘风控拦截（需人工短信验证）';
          fs.writeSync(fd, JSON.stringify(rec) + '\n');
          log('\n!! 账号被猎聘风控拦截，需人工完成短信验证后重新运行（已完成数据已保存，将自动续抓）');
          break;
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
          if (list.length < 2) list = uniq;
          list.sort((a, b) => score(b) - score(a));
          const picked = list.slice(0, NJOBS);

          const jobs = [];
          for (const j of picked) {
            let d = { jd: '', companyIntro: '', industryReq: '' };
            if (j.detailUrl) {
              for (let a = 0; a < 3; a++) {
                try {
                  await evaluate(C, FUNC_SRC, false).catch(() => {});
                  const raw = await evaluate(C, 'window.__lpDetail(' + JSON.stringify(j.detailUrl) + ')');
                  d = JSON.parse(raw);
                } catch (e) { C = null; await conn(true).catch(() => {}); }
                if (d.jd) break;
                await sleep(1200);
              }
              await sleep(900);
            }
            jobs.push({ ...j, ...d });
          }
          const com = pool.filter(x => x.company);
          const freq = {};
          com.forEach(x => { freq[x.company] = (freq[x.company] || 0) + 1; });
          rec.target = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || hit.card.company;
          rec.industry = hit.card.industry || '';
          rec.stage = hit.card.stage || '';
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
      log(`  [${i + 1}/${todo.length}] ${ts} ${tag} ${co.n} => ${rec.target || '-'} | 岗位${(rec.jobs || []).length}${rec.scale ? ' | ' + rec.scale : ''}${rec.stage ? ' / ' + rec.stage : ''}${rec.err ? ' | ' + rec.err : ''}${!rec.target && rec.candidates ? ' | 候选:' + rec.candidates.slice(0, 3).join(' / ') : ''}`);
      // 进度心跳，便于外部监控
      try { fs.writeFileSync(P.progress('liepin'), JSON.stringify({ done: i + 1, total: todo.length, ok, miss, err, last: co.n, ts })); } catch {}
      if ((i + 1) % 12 === 0) await conn(true).catch(() => {});
      // 保守节奏：猎聘对高频搜索会触发风控短信验证
      await sleep(P.paceMs(CFG, 'liepin'));
    }
    log(`\n完成：OK ${ok} / MISS ${miss} / ERR ${err}`);
  } finally {
    try { fs.closeSync(fd); } catch {}
    try { C.close(); } catch {}
  }
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });
