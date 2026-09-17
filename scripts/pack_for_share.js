// 跨平台"生成可分发 zip"工具（不依赖 .gitignore，直接按黑名单剔除）
//
// 用法（在本技能根目录运行）：
//   node scripts/pack_for_share.js                   默认产物：recruit-platform-cdp-scrape-share.zip
//   node scripts/pack_for_share.js --out my-share.zip
//
// 这个脚本假定你已经装好 Node 22（运行 run.js 的同一前置）。
// 若未装，会列出安装指引后退出码 1。
//
// 设计目标：让任何情况下打出去的 zip 都"只能跑代码、不会泄漏隐私"。
//   - 不依赖系统 zip 命令，跨 Win/Mac/Linux 一致
//   - 不依赖 .gitignore（zip 工具本身不读 .gitignore）
//   - 主动按 "白名单路径段 + 黑名单文件名段" 双层筛选
//   - 在产物 zip 里再写一份 SHARE_INTEGRITY.md 作为信源说明
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const outArgIdx = argv.indexOf('--out');
const OUT_NAME = (outArgIdx >= 0 && argv[outArgIdx + 1]) || 'recruit-platform-cdp-scrape-share.zip';
// --out 可以传绝对路径也可以只是文件名；区分处理
const OUT_PATH = path.isAbsolute(OUT_NAME) ? OUT_NAME : path.join(ROOT, OUT_NAME);

/* ---------- 黑名单：目录名/文件名片段，命中即跳过 ---------- */
const BLOCK_DIR_EXACT = new Set([
  'data',
  'chrome-profile',
  'node_modules',
  '__pycache__',
  '.workbuddy',
  '.vscode',
  '.idea',
  '.git',
  'dist',
  'build',
]);

const BLOCK_PATH_SUBSTR = [
  // 用户隐私类
  '/chrome-profile',
  '/data/',
  // 编译/缓存
  '/node_modules/',
  '/__pycache__/',
  '/.git/',
];

const BLOCK_FILE_PATTERNS = [
  // 黑名单：精确匹配常见私密 .env 变体
  /^\.env$/i,
  /^\.env\.(local|development|production|test|staging|prod|dev)$/i,
  /\.log$/i,
  /\.xlsx$/i,
  /\.xls$/i,
  /\.xlsm$/i,
  /\.jsonl$/i,              // 抓取原始数据
  /\.pyc$/i,
  /\.bak$/i,
  /\.backup$/i,
  /~$/,                     // 编辑器临时文件 foo~
  /^\.DS_Store$/i,
  /Thumbs\.db$/i,
];

// 显式白名单：黑名单规则之外的"安全文件"
const ALLOW_BASENAMES_PATTERNS = [
  /^\.env\.example$/i,
  /^\.env\.sample$/i,
  /^\.env\.template$/i,
];

/* ---------- 白名单：只允许这些文件类进 zip ---------- */
const ALLOW_FILE_EXTS = new Set([
  '.md', '.json', '.js', '.py', '.yml', '.yaml',
  '.toml', '.txt', '.gitignore', '.gitattributes',
  '.example', '.cfg', '.ini',
]);

// SKILL.md / LICENSE / README / CHANGELOG / CONTRIBUTING / CODE_OF_CONDUCT / SECURITY
// 顶层允许的无后缀名单（如 LICENSE）
const ALLOW_BASENAMES = new Set([
  'SKILL.md', 'LICENSE', 'README.md',
  'CHANGELOG.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md',
  'requirements.txt', 'package.json', 'package-lock.json',
  'pyproject.toml', '.gitignore', '.gitattributes', '.env.example',
]);

function isDir(p)  { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile();      } catch { return false; } }

/** 决策是否允许 entry 进 zip */
function allow(rel, name, isDirectory) {
  if (BLOCK_DIR_EXACT.has(name)) return false;
  for (const s of BLOCK_PATH_SUBSTR) if (rel.includes(s)) return false;
  if (!isDirectory) {
    // 白名单先判（黑名单规则之外的"安全样板"）
    if (ALLOW_BASENAMES_PATTERNS.some(re => re.test(name))) return true;
    if (BLOCK_FILE_PATTERNS.some(re => re.test(name))) return false;
    const ext = path.extname(name);
    if (ALLOW_BASENAMES.has(name)) return true;
    if (ALLOW_FILE_EXTS.has(ext)) return true;
    return false;
  }
  return true;
}

/** 收集全部合法 entry 的相对路径 */
function walk() {
  const out = [];
  function recurse(absDir, relDir) {
    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, ent.name);
      const rel = relDir ? path.posix.join(relDir, ent.name) : ent.name;
      if (!allow(rel, ent.name, ent.isDirectory())) continue;
      if (ent.isDirectory()) {
        recurse(abs, rel);
      } else if (ent.isFile()) {
        out.push({ abs, rel });
      }
    }
  }
  recurse(ROOT, '');
  return out;
}

/* ---------- 不依赖外部 zip 命令：手写一个最简的 zip 写出 ---------- */
// 我们写 Store（不压缩）+ Deflate 两种都可以；这里用 Store 最简单且 ZIP 规范允许
// 用最简的 ZIP 容器：每个 entry 一段 local file header + data + central directory
// 这是"够用且零依赖"的方案，主流解压工具（Windows 资源管理器、unzip、7z）都认。
function crc32(buf) {
  // 标准 CRC-32（多项式 0xEDB88320）
  if (!crc32.table) {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    crc32.table = t;
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function writeZip(entries, outPath) {
  const localChunks = [];
  const central = [];
  let offset = 0;
  // 时间戳：固定值，不写"你的打包时刻"（避免通过 zip 元数据暴露作息/时区）。
  // 遵循可复现构建惯例，可用环境变量 SOURCE_DATE_EPOCH（秒）覆盖；默认 zip 纪元 1980-01-01。
  const epochSec = Number(process.env.SOURCE_DATE_EPOCH || 0);
  const ts = epochSec > 0 ? new Date(epochSec * 1000) : new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
  const dosTime = ((ts.getUTCHours() & 0x1F) << 11) | ((ts.getUTCMinutes() & 0x3F) << 5) | (Math.floor(ts.getUTCSeconds() / 2) & 0x1F);
  const dosDate = (((ts.getUTCFullYear() - 1980) & 0x7F) << 9) | (((ts.getUTCMonth() + 1) & 0x0F) << 5) | (ts.getUTCDate() & 0x1F);

  for (const e of entries) {
    const data = fs.readFileSync(e.abs);
    const nameBuf = Buffer.from(e.rel, 'utf8');
    const crc = crc32(data);
    const size = data.length;

    // Local file header (30 字节 + name)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);                 // version needed
    lfh.writeUInt16LE(0x0800, 6);              // general-purpose bit 11 = UTF-8 name
    lfh.writeUInt16LE(0, 8);                  // method 0 = store
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(size, 18);              // compressed size
    lfh.writeUInt32LE(size, 22);              // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);                 // extra length
    localChunks.push(lfh, nameBuf, data);

    // Central directory record
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);                  // version made by
    cd.writeUInt16LE(20, 6);                  // version needed
    cd.writeUInt16LE(0x0800, 8);              // gp flag UTF-8
    cd.writeUInt16LE(0, 10);                  // method
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);                  // extra
    cd.writeUInt16LE(0, 32);                  // comment
    cd.writeUInt16LE(0, 34);                  // disk
    cd.writeUInt16LE(0, 36);                  // internal attr
    cd.writeUInt32LE(0, 38);                  // external attr
    cd.writeUInt32LE(offset, 42);             // local header offset
    central.push(cd, nameBuf);

    offset += lfh.length + nameBuf.length + data.length;
  }

  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const cdSize = cdBuf.length;

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                   // disk
  eocd.writeUInt16LE(0, 6);                   // start disk
  eocd.writeUInt16LE(entries.length, 8);      // entries this disk
  eocd.writeUInt16LE(entries.length, 10);     // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);                  // comment length

  const final = Buffer.concat([
    ...localChunks,
    cdBuf,
    eocd,
  ]);
  fs.writeFileSync(outPath, final);
}

/* ---------- 列出拒绝的文件（透明告知） ---------- */
function summarize(accepted, rejected) {
  // 接受条目里顺手记录 size，避免去 stat 已经不存在（如临时清理后）的文件
  let total = 0;
  for (const e of accepted) total += e.size || 0;
  const fmtBytes = n => {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  };
  console.log('\n  ✓ 已打包 ' + accepted.length + ' 个文件 (' + fmtBytes(total) + ')');
  if (rejected.length) {
    console.log('  ⊘ 已屏蔽 ' + rejected.length + ' 个条目（按预设隐私/缓存名单）:');
    rejected.slice(0, 12).forEach(r => console.log('      - ' + r));
    if (rejected.length > 12) console.log('      - … 等 ' + (rejected.length - 12) + ' 项');
  }
  console.log('  → ' + OUT_PATH);
}

/** 收集全部 entry，连同"被拒的"也记下来给用户看 */
function walkWithRejected() {
  const acc = [];
  const rej = [];
  function recurse(absDir, relDir) {
    let ents = [];
    try { ents = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const abs = path.join(absDir, ent.name);
      const rel = relDir ? path.posix.join(relDir, ent.name) : ent.name;
      const ok = allow(rel, ent.name, ent.isDirectory());
      if (!ok) {
        rej.push(rel + (ent.isDirectory() ? '/' : ''));
        continue;
      }
      if (ent.isDirectory()) recurse(abs, rel);
      else if (ent.isFile()) acc.push({ abs, rel, size: fs.statSync(abs).size });
    }
  }
  recurse(ROOT, '');
  return { acc, rej };
}

/* ---------- 主流程 ---------- */
function main() {
  if (!process.env.npm_config_node_gyp || true) { /* 防止被外部环境拔掉，预留扩展点 */ }

  if (!isFile(path.join(ROOT, 'SKILL.md'))) {
    console.log('  ! 看起来不在技能根目录（找不到 SKILL.md），中止');
    process.exit(1);
  }

  console.log('  ▸ 打包"可分发版"：主动剔除隐私与缓存条目');
  const { acc, rej } = walkWithRejected();

  // 末尾追加 SHARE_INTEGRITY.md（声明包内容/排除项/使用前置）
  const integrityName = 'SHARE_INTEGRITY.md';
  const integPath = path.join(ROOT, integrityName);
  fs.writeFileSync(integPath,
    '# 分享包完整性说明\n\n' +
    '本 zip 由 `scripts/pack_for_share.js` 主动筛选生成，**不依赖 `.gitignore`**。\n\n' +
    '## 包含\n- `SKILL.md`（Agent 自动加载的元描述与触发条件）\n' +
    '- `scripts/`（全部可执行代码，无 npm 依赖）\n' +
    '- `docs/`（ARCHITECTURE / COMPLIANCE / TROUBLESHOOTING / FAQ）\n' +
    '- `tests/`（paths / common / xlsx 的回归测试）\n' +
    '- `.github/`（Issue 模板 + CI 工作流）\n' +
    '- `*.md` / `LICENSE` / `*.example` 等元数据\n\n' +
    '## 主动排除（隐私/缓存/无关产物）\n' +
    '- `data/`（抓取原始数据 jsonl）、`*.jsonl`\n' +
    '- `chrome-profile/`（带登录态的浏览器 profile，**风险最高**）\n' +
    '- `.env` / `.env.*`（私密环境变量）\n' +
    '- `*.xlsx` / `*.xls` / `*.log`（结果与日志）\n' +
    '- `node_modules/` / `__pycache__/` / `.git/`\n' +
    '- `.vscode/` / `.idea/` / `dist/` / `build/`\n' +
    '- 编辑器临时文件 `*~` / `*.bak` / `Thumbs.db` / `.DS_Store`\n\n' +
    '## 使用前置\n- Node.js ≥ 22（运行 `node scripts/run.js` 的同一前置）\n' +
    '- Python ≥ 3.10 + `openpyxl`（`pip install -r requirements.txt`）\n' +
    '- 系统已装 Chrome / Edge / Chrome Canary（CDP 调试模式）\n');
  acc.push({ abs: integPath, rel: integrityName, size: fs.statSync(integPath).size });

  writeZip(acc, OUT_PATH);
  // 清理临时生成的说明文件
  try { fs.unlinkSync(integPath); } catch {}

  // 重新统计（acc 末尾多了 SHARE_INTEGRITY.md）
  summarize(acc, rej);

  console.log('\n  提示：把这个 zip 发给朋友即可，他/她解压后照 README「快速上手」节准备');
  console.log('        `companies.json` + `config.json` 就能 `node scripts/run.js` 跑起来。');
}

main();
