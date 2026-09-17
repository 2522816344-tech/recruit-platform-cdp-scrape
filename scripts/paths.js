// 统一路径 / 配置解析
// 工作目录优先取环境变量 SCRAPE_DIR，否则取进程当前目录（即你放 companies.json 的地方）
// 这样脚本本体可以常驻技能目录，数据跟着「项目目录」走，不会互相污染
const fs = require('fs');
const path = require('path');

const DIR = process.env.SCRAPE_DIR || process.cwd();
const DATA = process.env.SCRAPE_DATA || path.join(DIR, 'data');
const CONFIG = process.env.SCRAPE_CONFIG || path.join(DIR, 'config.json');
const COMPANIES = process.env.SCRAPE_COMPANIES || path.join(DIR, 'companies.json');

// 所有可调项都有默认值，没有 config.json 也能跑
const DEFAULTS = {
  // Excel 文件名（不含 .xlsx）
  title: '招聘岗位调研汇总',
  // 「本地城市」正则：用于岗位打分加权 + Excel 单独出一个本地岗位 Sheet
  // ⚠️ 这里只是「示例值」（北京），请按你自己的城市改（可在 config.json 里覆盖）
  localCityRe: '北京|海淀|朝阳|东城|西城|丰台|石景山|通州|昌平|大兴|顺义|房山|门头沟|平谷|密云|怀柔|延庆',
  // 各平台的本地城市参数（平台间编码完全不同，不要混用）
  localCityParam: {
    zhilian: '530',        // 智联：530 = 北京
    boss: '101010100',     // BOSS：101010100 = 北京
  },
  // 要抓的平台（顺序即执行顺序）
  platforms: ['liepin', 'job51', 'zhilian'],
  // 每家公司取几个代表性岗位
  nJobsPerCompany: 4,
  // 平台内搜索的节流区间（毫秒），查得太快会触发风控
  pace: {
    liepin: [8000, 13000],
    job51: [2500, 4000],
    zhilian: [3000, 5000],
    boss: [3000, 5500],
  },
  // 人工复核后需要剔除的「同名不同司」候选：{ 名单公司名: [正则, ...] }
  rejectTarget: {},
};

function ensureData() {
  fs.mkdirSync(DATA, { recursive: true });
  return DATA;
}

// 数据文件（每个平台一个 jsonl）
const out = name => path.join(DATA, name);
// 进度心跳文件
const progress = name => path.join(DATA, '.progress_' + name);

function loadConfig() {
  const cfg = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const user = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    // 深合并一层就够（值都是简单类型或单层对象）
    for (const k of Object.keys(user)) {
      if (user[k] && typeof user[k] === 'object' && !Array.isArray(user[k]) && cfg[k] && typeof cfg[k] === 'object') {
        Object.assign(cfg[k], user[k]);
      } else {
        cfg[k] = user[k];
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.log('  ! config.json 解析失败，使用默认配置：' + e.message);
  }
  return cfg;
}

// 名单格式兼容：["公司A", ...] 或 [{n, kw, alt, must}, ...]
function loadCompanies() {
  if (!fs.existsSync(COMPANIES)) {
    throw new Error('找不到公司名单：' + COMPANIES +
      '\n请把 companies.json 放到该目录（格式见同目录 companies.example.json）。' +
      '\n也可用环境变量 SCRAPE_DIR 指定工作目录。');
  }
  const raw = JSON.parse(fs.readFileSync(COMPANIES, 'utf8'));
  return raw.map(x => (typeof x === 'string' ? { n: x, kw: x } : x)).filter(x => x && x.n);
}

// 节流：pace 区间内随机取值
function paceMs(cfg, platform) {
  const p = (cfg.pace && cfg.pace[platform]) || [3000, 5000];
  return p[0] + Math.random() * Math.max(0, p[1] - p[0]);
}

module.exports = {
  DIR, DATA, CONFIG, COMPANIES,
  ensureData, out, progress,
  loadConfig, loadCompanies, paceMs,
  DEFAULTS,
};
