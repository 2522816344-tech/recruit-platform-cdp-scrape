// 公共：公司名严格匹配 + 岗位筛选评分（供 智联/51job 抓取复用）
const GENERIC = /(股份有限公司|有限公司|智能科技|微电子|机器人|半导体|股份公司|责任公司|自动化|新材料|互联网|互联网科技|精密|传动|制造|装备|机电|电机|光电|光子|激光|传感|视觉|智能|科技|技术|电子|电气|控股|集团|实业|工业|机器|控制|驱动|材料|系统|软件|硬件|网络|信息|数据|光学|仪器|仪表|设备|机械|模具|精工|新材|高科|公司)/g;
const normName = s => (s || '').replace(/[\s（）()【】\[\]·、,，.。“”"']/g, '');

// 行业通用词：不可作为匹配键（单独出现说明不了是哪家公司）
const INDUSTRY_ONLY = new Set(['智能', '智造', '智慧', '制造', '精密', '传动', '机器', '自动化', '装备', '机电', '电机', '光电', '光子', '激光', '传感', '视觉', '软件', '硬件', '系统', '控制', '驱动', '材料', '新材', '科技', '技术', '电子', '电气', '工业', '实业', '集团', '控股', '股份', '有限', '公司', '数控', '模具', '机械', '设备', '仪器', '仪表', '光学', '网络', '信息', '数据', '半导体', '微电子', '高科', '创新', '精工', '新能', '能源', '环保', '物流', '贸易', '光电科技', '电子科技', '智能科技', '自动化科技']);
// 行政区划前缀：剥离后可露出品牌词；同时自身不可作为匹配键
const REGION = /^(北京|上海|天津|重庆|广州|深圳|苏州|无锡|常州|南京|杭州|宁波|青岛|济南|武汉|长沙|成都|西安|郑州|合肥|东莞|佛山|福州|厦门|大连|沈阳|哈尔滨|长春|石家庄|太原|南昌|南宁|贵阳|昆明|兰州|银川|西宁|乌鲁木齐|呼和浩特|海口|拉萨|香港|澳门|内蒙|新疆|西藏|宁夏|广西|江苏|浙江|广东|山东|安徽|福建|江西|湖南|湖北|河南|河北|四川|辽宁|吉林|黑龙江|山西|陕西|甘肃|云南|贵州|海南|台湾)(省|市)?/;
const REGION_ONLY = new Set(['北京', '上海', '天津', '重庆', '广州', '深圳', '苏州', '无锡', '常州', '南京', '杭州', '宁波', '青岛', '济南', '武汉', '长沙', '成都', '西安', '郑州', '合肥', '东莞', '佛山', '福州', '厦门', '大连', '沈阳', '哈尔滨', '长春', '石家庄', '太原', '南昌', '南宁', '贵阳', '昆明', '兰州', '银川', '西宁', '海口', '拉萨', '香港', '澳门', '内蒙', '新疆', '西藏', '宁夏', '广西', '江苏', '浙江', '广东', '山东', '安徽', '福建', '江西', '湖南', '湖北', '河南', '河北', '四川', '辽宁', '吉林', '黑龙江', '山西', '陕西', '甘肃', '云南', '贵州', '海南', '台湾', '中国']);

function usable(tk) {
  return tk && tk.length >= 2 && !INDUSTRY_ONLY.has(tk) && !REGION_ONLY.has(tk);
}

function tokens(name) {
  const t = normName(name);
  const out = new Set();
  for (const L of [4, 3, 2]) if (t.length >= L) out.add(t.slice(0, L));
  const core = t.replace(GENERIC, '');
  for (const L of [4, 3, 2]) if (core.length >= L) out.add(core.slice(0, L));
  const reg = core.replace(REGION, '');
  for (const L of [4, 3, 2]) if (reg.length >= L) out.add(reg.slice(0, L));
  // 品牌词常在尾部（如「江城雷力」→「雷力」、「Astra光达通」→「光达通」）
  for (const L of [4, 3, 2]) if (core.length >= L) out.add(core.slice(-L));
  for (const L of [4, 3, 2]) if (reg.length >= L) out.add(reg.slice(-L));
  return [...out].filter(usable).sort((a, b) => b.length - a.length);
}

// 最长公共子串：衡量候选名里包含多少目标名的连续字符
function lcsSubstr(a, b) {
  if (!a || !b) return 0;
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

// cards: [{company}]  target: 目标公司名 → {card,key} | null
// 排序优先级：匹配到的公司名词长 > 目标名有序覆盖字符数 > 排除跨行业候选 > 名称更短
// 跨行业公司：目标本身属于这些行业时才允许命中，否则一律否决（如「丰驰智能」不应命中「丰驰装饰」）
const DOMAIN_BAD = /食品|房地产|置业|地产|餐饮|酒店|住宿|服饰|服装|家具|建材|装饰|装修|传媒|影视|文化|教育|培训|学校|医药|药房|医疗|医院|口腔|银行|保险|证券|期货|投资|资管|基金|财富|贸易|商贸|物流|快递|运输|旅游|娱乐|广告|美容|美发|健身|农业|养殖|种植|水产|环保|能源|石油|石化|矿业|钢铁|水泥|建筑|建设|工程|设计院|人力资源|劳务|人才|猎头|派遣|外包|人力资源服务|招聘服务|润滑油|轮胎|橡胶|燃气|水务|快递|印刷|包装|纸业|酒业|乳业|饮料|烟草/;

// 公司名中的行政区划（用于判断目标与候选是否跨地区）
const REGION_LIST = '北京|上海|天津|重庆|广州|深圳|苏州|无锡|常州|南京|杭州|宁波|青岛|济南|武汉|长沙|成都|西安|郑州|合肥|东莞|佛山|福州|厦门|大连|沈阳|哈尔滨|长春|石家庄|太原|南昌|南宁|贵阳|昆明|兰州|银川|西宁|乌鲁木齐|呼和浩特|海口|拉萨|香港|澳门|内蒙|新疆|西藏|宁夏|广西|江苏|浙江|广东|山东|安徽|福建|江西|湖南|湖北|河南|河北|四川|辽宁|吉林|黑龙江|山西|陕西|甘肃|云南|贵州|海南|台湾';
const REGION_RE = new RegExp('^(' + REGION_LIST + ')(省|市|自治区)?');
function regionOf(name) {
  const m = REGION_RE.exec(normName(name));
  return m ? m[1] : '';
}

// 目标名与候选公司名的最长公共子串长度（连续匹配才算数，避免「工业」「智能」这类
// 泛词把无关公司拉进来；同时允许品牌词出现在候选名的任意位置）
function coverage(cn, target) {
  return lcsSubstr(normName(target), cn);
}

// 判定「候选公司是否可能就是目标公司」：跨行业否决 + 跨地区否决
// 用于抓取时的匹配，也用于事后审计已有数据
function plausible(target, candidate) {
  const tn = normName(target), cn = normName(candidate);
  if (!tn || !cn) return false;
  // 候选属于无关行业（目标本身不在该行业）→ 否决
  if (!DOMAIN_BAD.test(tn) && DOMAIN_BAD.test(cn)) return false;
  // 两者都带行政区划但不同 → 否决（湖北云峰 ≠ 浙江云峰设计集团）
  const rt = regionOf(target), rc = regionOf(candidate);
  if (rt && rc && rt !== rc) return false;
  return true;
}

function matchCompany(cards, target, must) {
  const toks = tokens(target);
  const mustRe = must ? new RegExp(must) : null;
  let best = null, bestSc = null, bestKey = '';
  for (const c of cards) {
    const cn = normName(c.company);
    if (!cn) continue;
    if (mustRe && !mustRe.test(c.company || '')) continue;   // 主体校验：命中公司名必须匹配 must
    if (!plausible(target, c.company)) continue;   // 跨行业 / 跨地区直接否决
    let tkLen = 0, tk = '';
    for (const t of toks) if (cn.includes(t) && t.length > tkLen) { tkLen = t.length; tk = t; }
    if (tkLen < 2) continue;
    const cov = coverage(cn, target);
    if (cov < 2) continue;
    const sc = [tkLen, cov, -cn.length];
    if (!bestSc || sc[0] > bestSc[0] ||
        (sc[0] === bestSc[0] && (sc[1] > bestSc[1] ||
        (sc[1] === bestSc[1] && sc[2] > bestSc[2])))) {
      bestSc = sc; best = c; bestKey = tk;
    }
  }
  return best ? { card: best, key: bestKey } : null;
}

// 命中后确定「属于同一家公司」的卡片集合。
// BUG 教训：早期直接用 hit.key（2~4 字品牌词）做 includes 过滤，会把检索结果里
// 同名不同司的公司一起捞进来（如「星汉」→浙江星汉博纳医药、「乐驰」→厦门乐驰食品），
// 再按出现频次选 target，就会张冠李戴。这里改为两级严格口径：
//   tier1 与命中卡片同公司名（含分公司后缀 / 简称包含关系）
//   tier2 必须通过 must + plausible 校验，且与命中公司名有 >=4 个连续公共字符
function scopeOf(cards, target, must, hit) {
  if (!hit || !hit.card) return [];
  const hitName = normName(hit.card.company);
  if (!hitName) return [];
  const mustRe = must ? new RegExp(must) : null;
  const t1 = [], t2 = [];
  for (const x of cards) {
    const cn = normName(x.company);
    if (!cn) continue;
    if (cn === hitName || cn.includes(hitName) || hitName.includes(cn)) { t1.push(x); continue; }
    if (mustRe && !mustRe.test(x.company || '')) continue;
    if (!plausible(target, x.company)) continue;
    if (lcsSubstr(cn, hitName) < 4) continue;
    t2.push(x);
  }
  return t1.length >= 2 ? t1 : t1.concat(t2);
}

/* ---------- 岗位筛选 ---------- */
const HARD_BAD = /销售|客户经理|招商|渠道|人力|人事|行政|财务|会计|出纳|税务|审计|法务|前台|客服|实习|校招|导购|店长|司机|保安|保洁|助理|文员|组长|班长|普工|操作工|操作员|作业员|学徒|兼职|主播|运营|地推|电话|后勤|仓管|业务员|外贸|跟单|报关|单证|翻译|美工|编辑|策划|顾问|中介|HRBP|行销|招聘专员|培训专员|员工关系|学习发展|打字员|市场专员|品牌|公关|薪酬|绩效|秘书|内勤|收银|促销|门店|客户代表|商务专员/i;
const K1 = /算法|控制|机器人|关节|执行器|减速|谐波|电机|驱动|伺服|嵌入式|软件|硬件|结构|仿真|导航|感知|SLAM|动力学|电控|电气|机械|电子|光学|芯片|材料|工艺|测试|研发|工程师|技术|架构|数据|AI|人工智能/;
const K2 = /经理|主管|总监|生产|质量|设备|项目|产品|品质|制程|工装|模具|调试|装配|设计|计划|PMC/;

// 统一薪资 → 月薪近似数值（k）
function salaryNum(s) {
  const t = s || '';
  const k = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*k/i.exec(t);
  if (k) return (+k[1] + +k[2]) / 2;
  const w = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*万/.exec(t);
  if (w) return (+w[1] + +w[2]) / 2 * 10;
  const sk = /(\d+(?:\.\d+)?)\s*k/i.exec(t);
  if (sk) return +sk[1];
  const y = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*元/.exec(t);
  if (y) return ((+y[1] + +y[2]) / 2) / 1000;
  return 0;
}
// 「本地城市」正则：默认从工作目录的 config.json 读，也可用环境变量覆盖
// 用途：岗位打分加权 + Excel 单独导出本地岗位 Sheet
let LOCAL = /北京/;
try {
  LOCAL = new RegExp(process.env.LOCAL_CITY_RE || require('./paths.js').loadConfig().localCityRe || '北京');
} catch (e) { console.log('  ! localCityRe 正则无效，回退为 /北京/：' + e.message); }
function score(name, salary, city) {
  let s = 0;
  if (K1.test(name || '')) s += 100000;
  else if (K2.test(name || '')) s += 30000;
  s += salaryNum(salary) * 10;
  if (LOCAL.test(city || '')) s += 6000;
  if (/本科|硕士|博士/.test(name || '')) s += 0;   // 占位
  return s;
}

// 从卡片池选出最终岗位
function pickJobs(pool, n) {
  const seen = new Set();
  const uniq = pool.filter(j => { const k = j.jobName; if (!k || seen.has(k)) return false; seen.add(k); return true; });
  let list = uniq.filter(j => !HARD_BAD.test(j.jobName));
  if (list.length < 2) list = uniq.slice();
  list.sort((a, b) => score(b.jobName, b.salary, b.city) - score(a.jobName, a.salary, a.city));
  return { all: uniq, picked: list.slice(0, n) };
}

module.exports = { normName, tokens, matchCompany, scopeOf, plausible, regionOf, lcsSubstr, INDUSTRY_ONLY, REGION_ONLY, DOMAIN_BAD, HARD_BAD, K1, K2, salaryNum, LOCAL, score, pickJobs };
