// 登录态体检：逐个平台打开页面，判定是否已登录
//
// 用法：node verify.js
// 依据 config.json 里的 loginCheck（没有就用内置默认），或环境变量 SCRAPE_USER 指定用户名，
// 命中用户名 = 明确已登录；否则回退看是否被弹到登录页 / 页面是否有登录按钮。
const { CDP, httpJSON, pickTarget, navigate, evaluate, sleep, PORT } = require('./cdp.js');
const P = require('./paths.js');

const CFG = P.loadConfig();
const USER = process.env.SCRAPE_USER || CFG.userName || '';

const DEFAULT_CHECKS = [
  { name: '猎聘',     host: 'liepin.com',  url: 'https://www.liepin.com/zhaopin/?key=%E6%9C%BA%E5%99%A8%E4%BA%BA' },
  { name: '前程无忧', host: '51job.com',   url: 'https://we.51job.com/pc/search?keyword=%E6%9C%BA%E5%99%A8%E4%BA%BA' },
  { name: '智联招聘', host: 'zhaopin.com', url: 'https://www.zhaopin.com/jobs?kw=%E6%9C%BA%E5%99%A8%E4%BA%BA' },
  { name: 'BOSS直聘', host: 'zhipin.com',  url: 'https://www.zhipin.com/web/geek/job?query=%E6%9C%BA%E5%99%A8%E4%BA%BA&city=100010000' },
];
const CHECKS = (CFG.loginCheck || DEFAULT_CHECKS).map(c =>
  Object.assign({}, DEFAULT_CHECKS.find(d => d.name === c.name || d.host === c.host) || {}, c));

const PROBE = `(() => {
  const txt = document.body ? (document.body.innerText || '') : '';
  return {
    url: location.href.slice(0, 120),
    title: (document.title || '').slice(0, 80),
    head: txt.replace(/\\s+/g, ' ').slice(0, 240)
  };
})()`;

(async () => {
  const ver = await httpJSON('/json/version').catch(() => null);
  if (!ver) {
    console.log('  ! 端口 ' + PORT + ' 不通。先运行：node chrome.js');
    process.exit(1);
  }
  const list = await httpJSON('/json/list');
  const pages = (Array.isArray(list) ? list : []).filter(t => t.type === 'page');
  console.log('CDP 正常，当前 ' + pages.length + ' 个标签页');
  console.log(USER ? ('按用户名「' + USER + '」判定登录态') : '未配置用户名，按页面特征判定（建议在 config.json 里加 userName）');
  console.log('');

  const result = [];
  for (const chk of CHECKS) {
    let t = pages.find(p => (p.url || '').includes(chk.host)) || await pickTarget();
    if (!t) { console.log('=== ' + chk.name + ' === 找不到可用标签页'); continue; }
    const c = await CDP.connect(t.webSocketDebuggerUrl);
    try {
      await navigate(c, chk.url, 45000);
      await sleep(2500);
      const info = await evaluate(c, PROBE);
      const url = info.url || '', head = info.head || '';
      const onLoginPage = /login|signin|passport|_security_check|verify/i.test(url);
      const hasUser = USER ? head.includes(USER) : false;
      const hasLoginBtn = /(^|\s)(登录|立即登录|登 录)(\s|$)/.test(head.slice(0, 400));

      let verdict;
      if (hasUser) verdict = '已登录';
      else if (onLoginPage) verdict = '未登录（被重定向到登录页）';
      else if (USER) verdict = '疑似未登录（页面未出现用户名）';
      else verdict = hasLoginBtn ? '疑似未登录（页面有登录入口）' : '不确定（未配置用户名，无法确认）';

      console.log('=== ' + chk.name + ' === ' + verdict);
      console.log('  落地: ' + url);
      console.log('  标题: ' + info.title);
      console.log('  正文: ' + head);
      console.log('');
      result.push({ name: chk.name, ok: hasUser, verdict });
    } catch (e) {
      console.log('=== ' + chk.name + ' === ERR ' + e.message + '\n');
      result.push({ name: chk.name, ok: false, verdict: 'ERR ' + e.message });
    } finally { c.close(); }
  }

  const bad = result.filter(r => !r.ok);
  if (bad.length) {
    console.log('需要处理的平台：' + bad.map(r => r.name).join('、'));
    console.log('请在抓取专用浏览器窗口里手动登录一次，然后重新运行本脚本确认。');
  } else {
    console.log('全部平台登录态正常。');
  }
  process.exit(bad.length ? 2 : 0);
})();
