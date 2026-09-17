// 详情抓取健康探针：判断「JD 全空」是浏览器过载还是真的被限频/风控（见 SKILL.md §7.2）
//
// 用法（抓取脚本必须先停掉，让标签页空闲，否则连不上）：
//   node probe.js j51            # 探测 51job：需 jobs.51job.com 标签页
//   node probe.js j51 173602640  # 指定 jobId
//   node probe.js liepin         # 探测猎聘：需 liepin.com 标签页
//   node probe.js liepin "https://www.liepin.com/job/xxxx.shtml"
//
// 判读：
//   jd 长度几百字 + 裸 fetch 200        → 配方正常，之前失败是浏览器过载 → 清标签页后独占重跑
//   err HTTP403/405/429 / CAPTCHA 页    → 真的限频或风控 → 走 patch_jd.js 慢速补抓 / 人工验证
const fs = require('fs');
const path = require('path');
const { CDP, httpJSON, evaluate } = require('./cdp.js');

const PLATFORMS = {
  j51: {
    host: 'jobs.51job.com',
    func: 'j51_func.js',
    sample: '173602640',
    call: id => `window.__j51Detail(${JSON.stringify(String(id))})`,
    rawFetch: id => `fetch('https://jobs.51job.com/all/${id}.html', {headers:{'Accept':'text/html'}})
      .then(r => r.status + ' | ct=' + (r.headers.get('content-type')||'?') + ' | len=' + (r.headers.get('content-length')||'?'))
      .catch(e => 'THROW ' + e.message)`,
  },
  liepin: {
    host: 'liepin.com',
    func: 'liepin_func.js',
    sample: '',
    call: id => `window.__lpDetail(${JSON.stringify(String(id))})`,
    rawFetch: null,
  },
};

(async () => {
  const key = process.argv[2];
  const pf = PLATFORMS[key];
  if (!pf) { console.log('用法: node probe.js <j51|liepin> [jobId|detailUrl]'); process.exit(1); }

  const list = await httpJSON('/json/list');
  const tabs = (Array.isArray(list) ? list : []).filter(t => t.type === 'page' && (t.url || '').includes(pf.host));
  console.log(`${pf.host} 标签页: ${tabs.length}`);
  if (!tabs.length) {
    console.log('→ 没有可用标签页。先让对应抓取脚本跑过一次，或用 open_tab.js 建一个。');
    process.exit(1);
  }

  const c = await CDP.connect(tabs[0].webSocketDebuggerUrl);
  try {
    const src = fs.readFileSync(path.join(__dirname, pf.func), 'utf8');
    await evaluate(c, src, false).catch(() => {});

    const arg = process.argv[3] || pf.sample;
    if (!arg) { console.log('→ 请给出 jobId 或 detailUrl（该平台没有默认样例）'); process.exit(1); }

    const raw = await evaluate(c, pf.call(arg), true);
    const d = JSON.parse(raw || '{}');
    console.log('--- 解析结果 ---');
    console.log('err:', d.err || '(无)');
    console.log('jd 长度:', (d.jd || '').length);
    console.log('jd 前 200:', (d.jd || '').slice(0, 200));

    if (pf.rawFetch) {
      console.log('--- 裸 fetch ---');
      console.log(await evaluate(c, pf.rawFetch(arg), true));
    }
  } finally { c.close(); }
  process.exit(0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
