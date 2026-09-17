// 用「抓取专用 profile」启动 Chromium 系浏览器，并开好 CDP 调试端口
//
// 为什么不用默认配置目录：Chrome 136+ 明确拒绝在默认 user-data-dir 上开调试端口
// （进程能起来，但 9222 永远不通），所以必须用一份独立的 profile 副本。
//
// 用法：
//   node chrome.js                      启动（profile 不存在则自动从本机默认配置复制）
//   node chrome.js --init-profile       只复制 profile，不启动
//   node chrome.js --open <url> [...]   启动并打开指定页面
//
// 环境变量：
//   BROWSER_EXE      指定浏览器可执行文件（自动探测失败时用）
//   SCRAPE_DIR       工作目录（默认进程当前目录）
//   CHROME_PROFILE   抓取专用 profile 目录（默认 <SCRAPE_DIR>/chrome-profile/User Data）
//   CDP_PORT         调试端口（默认 9222）
//   CHROME_PROXY     需要走代理时填，如 http://127.0.0.1:7890；不填则直连
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const PORT = +(process.env.CDP_PORT || 9222);
const DIR = process.env.SCRAPE_DIR || process.cwd();
const UD = process.env.CHROME_PROFILE || path.join(DIR, 'chrome-profile', 'User Data');
const PROXY = process.env.CHROME_PROXY || '';

/* ---------- 浏览器可执行文件探测 ---------- */
function candidates() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  if (process.platform === 'win32') {
    return [
      path.join(pf, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
      path.join(local, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(local, 'Microsoft/Edge/Application/msedge.exe'),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ];
}

function findBrowser() {
  if (process.env.BROWSER_EXE) {
    if (fs.existsSync(process.env.BROWSER_EXE)) return process.env.BROWSER_EXE;
    console.log('  ! BROWSER_EXE 指向的文件不存在：' + process.env.BROWSER_EXE);
  }
  for (const p of candidates()) if (fs.existsSync(p)) return p;
  return null;
}

/* ---------- 本机默认配置目录（复制来源） ---------- */
function defaultProfile() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const mac = path.join(home, 'Library', 'Application Support');
  const list = [];
  if (process.platform === 'win32') {
    list.push(path.join(local, 'Google/Chrome/User Data'));
    list.push(path.join(local, 'Microsoft/Edge/User Data'));
  } else if (process.platform === 'darwin') {
    list.push(path.join(mac, 'Google/Chrome'));
    list.push(path.join(mac, 'Microsoft Edge'));
  } else {
    list.push(path.join(home, '.config/google-chrome'));
    list.push(path.join(home, '.config/chromium'));
    list.push(path.join(home, '.config/microsoft-edge'));
  }
  return list.find(p => fs.existsSync(p)) || null;
}

// 只复制登录态必需的少量文件，跳过 Cache 等大目录（动辄几百 MB）
const KEEP = [
  'Default/Network/Cookies',
  'Default/Network/Cookies-journal',
  'Default/Preferences',
  'Default/Login Data',
  'Default/Web Data',
  'Local State',
];

function initProfile() {
  if (fs.existsSync(UD)) {
    console.log('profile 已存在，跳过复制：' + UD);
    return true;
  }
  const src = defaultProfile();
  if (!src) {
    console.log('  ! 找不到本机默认浏览器配置目录，请手动指定；将改用空 profile（需重新登录）');
    fs.mkdirSync(UD, { recursive: true });
    return false;
  }
  console.log('从本机配置复制登录态：' + src);
  fs.mkdirSync(UD, { recursive: true });
  let n = 0;
  for (const rel of KEEP) {
    const a = path.join(src, rel), b = path.join(UD, rel);
    try {
      if (!fs.existsSync(a)) continue;
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.copyFileSync(a, b);
      n++;
    } catch (e) {
      console.log('  ! 复制失败 ' + rel + '：' + e.message);
    }
  }
  console.log('已复制 ' + n + ' 个文件');
  console.log('提示：Cookie 里的 encrypted_value 绑定当前系统用户密钥，同机同用户可直接用；');
  console.log('      若启动后提示未登录，在该窗口里重新登录一次即可。');
  return n > 0;
}

/* ---------- 端口存活探测 ---------- */
function cdpAlive() {
  return new Promise(res => {
    const req = http.get('http://127.0.0.1:' + PORT + '/json/version', r => {
      let d = '';
      r.on('data', c => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    });
    req.on('error', () => res(null));
    req.setTimeout(3000, () => { req.destroy(); res(null); });
  });
}

async function launch(openUrls) {
  const alive = await cdpAlive();
  if (alive) {
    console.log('CDP 已在运行：' + (alive.Browser || '') + '  (端口 ' + PORT + ')');
    return true;
  }
  const exe = findBrowser();
  if (!exe) {
    console.log('  ! 找不到 Chrome/Edge，请用 BROWSER_EXE 环境变量指定路径');
    return false;
  }
  console.log('浏览器 =', exe);
  console.log('profile =', UD);

  const args = [
    '--user-data-dir=' + UD,
    '--remote-debugging-port=' + PORT,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
  ];
  // 默认直连：避免沙箱/本机代理把 CDP 之外的请求也劫持走（原项目实测代理会干扰抓取）
  if (PROXY) args.push('--proxy-server=' + PROXY);
  else args.push('--no-proxy-server', '--proxy-server=direct://');
  args.push(...openUrls);

  const p = spawn(exe, args, { detached: true, stdio: 'ignore' });
  p.on('error', e => console.log('SPAWN_ERR: ' + e.message));
  p.unref();

  for (let i = 0; i < 16; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const a = await cdpAlive();
    if (a) { console.log('CDP-OK: ' + (a.Browser || '')); return true; }
  }
  console.log('CDP-TIMEOUT：端口 ' + PORT + ' 没起来。常见原因是浏览器已在用「默认配置目录」运行 —— ' +
    '请先完全退出所有浏览器窗口再试。');
  return false;
}

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    if (argv.includes('--init-profile')) { initProfile(); return; }
    if (!fs.existsSync(UD)) initProfile();
    const i = argv.indexOf('--open');
    const urls = i >= 0 ? argv.slice(i + 1) : [];
    const ok = await launch(urls);
    process.exit(ok ? 0 : 1);
  })();
}

module.exports = { findBrowser, initProfile, launch, cdpAlive, PORT, UD };
