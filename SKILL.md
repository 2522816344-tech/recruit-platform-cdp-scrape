---
name: recruit-platform-cdp-scrape
description: 复用用户已登录的 Chrome 会话（CDP），从猎聘/前程无忧/智联/BOSS直聘批量抓取公司岗位数据并汇总成 Excel。当需要"从招聘网站按公司名单抓岗位""爬招聘平台的岗位信息""复用登录态抓取招聘网站"时使用。自带可直接运行的工具包（scripts/，一条命令 node run.js 即可跑完启动→体检→抓取→出表），并含各平台提取配方、薪资口径坑、公司名严格匹配、断点续抓、JD 补抓与诊断手法。
agent_created: true
---

# 招聘平台批量抓取（CDP 复用登录态）

适用场景：给一份公司名单，去招聘平台批量抓「公司规模 / 性质·融资阶段 / 行业 / 岗位名 / 城市 /
经验 / 学历 / 薪资 / 年薪结构 / JD / 福利」，汇总成 Excel。

## 快速上手（工具包，先看这节）

**本技能自带一套可直接运行的工具包**，不必从零写脚本。全部代码在技能目录的 `scripts/`
下（`<SKILL_DIR>/scripts/`），零 npm 依赖（用 Node 22 内置能力 + Python `openpyxl`）。

只需准备**一个工作目录**，放两个文件：

```text
<工作目录>/
  companies.json     # 公司名单（必需）
  config.json        # 站点/城市/节奏等参数（可选，缺省走默认值）
  data/              # 脚本自动创建，存放 <platform>_all.jsonl 与断点进度
  chrome-profile/    # 脚本自动创建，带登录态的抓取专用浏览器配置
```

`companies.json` 两种写法都支持（下面为便于说明加了注释，实际文件不要带注释）：

```jsonc
["海岳智能", "云智动力", "星辰传动"]                    // 简写：纯公司名数组
[{ "n": "海岳智能", "kw": "海岳", "alt": "海岳智能", "must": "机电" }]   // 完整：备选检索词 + 必含词
```

`config.json` 全部键见 `scripts/config.example.json`，常用：

| 键 | 作用 | 默认 |
|---|---|---|
| `title` | 输出 Excel 文件名（`<title>.xlsx`） | `招聘岗位调研汇总` |
| `localCityRe` | 判定「本地岗位」的正则 | `北京`（示例值，请改） |
| `localLabel` / `localSheetName` | 本地页签的标签与表名 | `本地` / `本地岗位` |
| `localCityParam` | 城市码 `{zhilian, boss}` | `749` / `101250100` |
| `platforms` | 启用平台 | `["liepin","job51","zhilian"]` |
| `nJobsPerCompany` | 每家公司取几个代表岗位 | `4` |
| `pace` | 各平台每家公司间隔毫秒 `[min,max]` | 见示例 |
| `rejectTarget` | 人工复核剔除映射 `{公司: [剔除关键词]}` | `{}` |

### 一条命令跑完

```bash
cd <工作目录>
node "<SKILL_DIR>/scripts/run.js"
```

`run.js` 会依次：**启动 Chrome（带调试端口）→ 体检四平台登录态 → 逐平台抓取 → 汇总出 Excel**。
常用参数：

| 参数 | 说明 |
|---|---|
| `--platforms liepin,job51` | 只跑指定平台 |
| `--only 公司A,公司B` | 只定点重跑这几家（配合断点续抓） |
| `--jobs 6` | 每家取几个岗位 |
| `--limit 10` | 只跑名单前 N 家（试跑用） |
| `--pace 9000` | 覆盖间隔（毫秒，写死不用随机区间） |
| `--parallel` | 多平台并行（各自 lock 自己的标签页） |
| `--skip-chrome` | 浏览器已在跑，不再拉起 |
| `--no-verify` / `--no-build` | 跳过登录体检 / 跳过出表 |

### 工具包文件一览

| 文件 | 用途 |
|---|---|
| `run.js` | **总入口**：编排 启动→体检→抓取→出表 |
| `chrome.js` | 跨平台浏览器定位与启动；`--init-profile` 复制真实 profile 带登录态 |
| `verify.js` | 四平台登录态体检（未登录时退出码 2） |
| `paths.js` | 可移植层：`SCRAPE_DIR` 等环境变量 → 统一路径与配置解析 |
| `cdp.js` | CDP 驱动（Node 内置 WebSocket，无依赖） |
| `cdpx.js` | 定点连接指定标签页调试：`node cdpx.js <host关键词> info\|eval\|nav "<arg>"` |
| `common.js` | 公司名匹配 / 岗位筛选 / 薪资归一化 等共用逻辑 |
| `liepin.js` `j51.js` `zp.js` `boss.js` | 四个平台的抓取脚本 |
| `patch_jd.js` | 补抓缺失 JD：`node patch_jd.js [job51\|liepin\|all] [--dry]` |
| `probe.js` | **详情抓取体检**：`node probe.js j51\|liepin [id]` 判断「JD 全空」是过载还是被限频（§7.2） |
| `close_tabs.js` | 清理堆积标签页：`node close_tabs.js <站点\|all> [--keep]` |
| `open_tab.js` | 在调试端口新开标签页：`node open_tab.js <url>` |
| `build_xlsx.py` | 汇总出多 Sheet Excel（需 `openpyxl`） |
| `config.example.json` / `companies.example.json` | 配置与名单模板 |
| `README.md` | 完整快速上手文档（含各组件单独调用、环境变量表、6 条坑） |

### 环境变量（不写进命令行也能覆盖）

`SCRAPE_DIR`（工作目录）、`SCRAPE_DATA`、`SCRAPE_CONFIG`、`SCRAPE_COMPANIES`、
`CDP_PORT`（默认 9222）、`BROWSER_EXE`、`CHROME_PROFILE`（默认自动找）、
`SCRAPE_USER`、`LOCAL_CITY_RE`、`CHROME_PROXY`、`PYTHON`。

> 与旧手写脚本的对应：`build_final.py` → **`build_xlsx.py`**；`verify_login.js` → **`verify.js`**；
> `start_chrome.js` → **`chrome.js`**。旧脚本散落在项目里且写死路径，已统一收进本工具包。

### 首次使用三步

```bash
# 1) 复制真实 Chrome 配置（带登录 Cookie）到抓取专用 profile —— 需先完全关闭 Chrome
node "<SKILL_DIR>/scripts/chrome.js" --init-profile
# 2) 启动带调试端口的 Chrome，并把四平台首页开出来
node "<SKILL_DIR>/scripts/chrome.js"
# 3) 体检登录态；若有平台未登录，在弹出的窗口里登录一次再重跑
node "<SKILL_DIR>/scripts/verify.js"
```

> 若只想知道「现在能不能抓」，先跑 `verify.js`；端口不通再走第 1、2 步（见 §0.1 的 Chrome 136+ 坑）。

---

## 0. 前置：确认登录态通道

用户已登录的 Chrome 必须带远程调试端口启动：

```bash
# 确认端口存活
node -e "require('http').get('http://127.0.0.1:9222/json/version',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(d))})"
```

**先列标签页，确认目标平台是否已登录**，不要急着折腾其它浏览器：

```bash
node -e "require('http').get('http://127.0.0.1:9222/json/list',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>JSON.parse(d).filter(t=>t.type==='page').forEach(t=>console.log(t.url)))})"
```

> 经验：曾为「Edge 里登录了 51job/智联」折腾很久（Edge profile 被 30 个运行进程锁定，
> `esenttutl /y /vss` 影子副本需管理员权限，`[System.IO.File]::Open` 共享读被安全策略拦截），
> 最后发现 **Chrome 里两个平台本来就已登录**。先查现有通道，省一小时。

### 0.1 端口丢了怎么办（Chrome 136+ 的坑）

会话结束 / 浏览器重启后调试端口会丢。**不能**直接对默认配置目录加 `--remote-debugging-port`：
Chrome 136+ 起明确拒绝在默认 user-data-dir 上开调试端口（进程起来了但 9222 不通）。

正确做法 —— **复制一份用户真实配置当抓取专用 profile**，登录 Cookie 一并带过来。
**工具包里已脚本化**，一条命令即可（Chrome 需先完全关闭）：

```bash
node "<SKILL_DIR>/scripts/chrome.js" --init-profile   # 自动找真实 profile 并只复制必要文件
node "<SKILL_DIR>/scripts/chrome.js"                  # 以复制出的 profile 启动 9222
```

它等价于手写流程（了解原理时看这里）：

```text
1. taskkill /IM chrome.exe /F        # 必须先全关，否则 Cookies 文件被锁
2. 复制 <LOCALAPPDATA>/Google/Chrome/User Data → <工作目录>/chrome-profile/User Data
   （只复制必要项：Default/Network/Cookies、Default/Preferences、Local State，
     跳过 Cache/Code Cache/GPUCache 等大目录）
3. chrome.exe --remote-debugging-port=9222 --remote-allow-origins=*
   --user-data-dir="<工作目录>/chrome-profile/User Data"
```

⚠️ 复制来的 Cookie 里 `encrypted_value` 绑定 **DPAPI 用户密钥**，同机同用户可用；
但有效期短的会话 Cookie（`expires_utc=0`）可能已失效 —— **复制完必须跑一次登录态校验**
（`verify.js`），失效就请用户在该窗口重新登录一次。
（本次实测：Chrome→Chrome profile 副本登录态完整保留，无需重新登录。）

### 0.2 后台任务会随会话结束而终止

`node xxx.js` 以后台任务方式跑，会话/进程一结束就停。恢复时**不需要重抓**：
脚本的「只把 `ok` 算完成」逻辑会自动续跑（见 §7）。先 `cat data/.progress_*` 看断点，再直接重跑。

## 1. 通用 CDP 驱动（`cdp.js`）

- 用 Node 22 内置 `WebSocket`，无需 npm 依赖
- `CDP` 类带 `kill()/dead` 自愈；`send(method, params, timeout)`
- `navigate(c, url, timeout)` 必须做**落点校验**：比对 `origin`/`pathname` + 关心的查询参数
  （`key`/`city`/`query`），并二次确认 `readyState==='complete'`。
  否则会读到上一个关键词残留的 DOM → 大量假 MISS
- `evaluate(c, expr)` 开 `awaitPromise: true` + `userGesture: true`，可直接执行 `fetch` 异步表达式
- 同一浏览器可多平台并行：**每个平台各自 `pick(host)` 锁定自己的标签页**，互不干扰
  （但并发别超过 2 个平台，见 §7.2）
- **标签页一律用 `pickOrCreate(host, url)`，不要只用 `pick(host)`**：
  用户随手关掉标签页（或用 `close_tabs.js` 清理）后，`pick` 找不到就会 `NO_*_TAB` 直接中断整轮抓取。
  `pickOrCreate` 找不到就自己 `PUT /json/new?<url>` 建一个 —— 搜索页和详情页都要这样。

## 2. 数据来源对象清单

抓取前把公司名单固化成一个 `companies.json`：`{n: 公司名, kw: 主检索词, alt: 备选词}`。
检索词用**公司简称**（如 `海岳智能`）比全称命中率高。

### 2.1 列表卡片里本来就有经验/学历 —— 别丢（实测踩过）

三个平台的搜索卡片都直接带经验与学历，**零额外请求**即可拿到：

| 平台 | 经验字段 | 学历字段 |
|---|---|---|
| 猎聘 | 卡片 `exp`（如 `3年以上`） | 卡片 `edu`（如 `统招本科`） |
| 智联 | `positionList[].workingExp` | `positionList[].eduLevel` |
| 前程无忧 | `[sensorsdata]` 的 `jobYear` | 同上的 `jobDegree` |

`allJobs`（全量在招岗位）早期只存了 `岗位名|薪资|城市` 三字段，导致出表时经验/学历覆盖率
只有约 30%（只剩每公司精选 4 条有详情）。**正确做法是存五字段**：

```js
rec.allJobs = uniq.map(j => j.jobName + '|' + j.salary + '|' + j.city
  + '|' + (j.exp || '') + '|' + (j.edu || ''));
```

改这一行后经验/学历覆盖率 ⇒ **100%**（实测猎聘 3061/3061、智联 780/780）。
出表脚本按 `parts[3] / parts[4]` 读取，旧的三字段数据可平滑兼容（缺失即留空）。

> 教训：**先把卡片解析出来的字段全部留下，再决定出表时用哪些** —— 丢掉容易，回补要重跑。

## 3. 各平台提取配方

### 猎聘（`liepin.com`）
- 搜索页 `https://www.liepin.com/zhaopin/?key=<kw>`，卡片 `window.__lpCards()`
- 详情 `window.__lpDetail(url)` 取 JD / 福利 / 招聘人数
- 薪资：`15-25k·13薪`（`k` = 月薪千元）
- 风控：会跳 `safe.liepin.com/v/intercept/verifysms` 短信拦截页 → **识别到立即中止**请用户人工验证；
  节奏放慢到 8-13s/家

### 前程无忧（`51job.com`）—— 推荐做主力之一
- **双标签页架构（关键）**：`we.51job.com/pc/search?keyword=<kw>` 取卡片（解析
  `.joblist-item` 上的 `[sensorsdata]` JSON 拿 `jobId/jobSalary/jobYear/jobDegree`）；
  详情必须在 **`jobs.51job.com`** 域执行 `fetch('https://jobs.51job.com/all/<jobId>.html')`
  （跨子域 fetch 返回 405）
- JD 选择器：`.bmsg.job_msg`；公司简介 `.tmsg.inbox`；福利 `.jtag`
- 薪资单位混用：`1.2-2.2万·15薪`、`8千-1.1万`、`7-9千` —— **「万」= 月薪万**
- 拿到公司名卡片匹配度最好，适合补其它平台的缺口
- 偶发滑块验证（`拖动到最右边/访问验证`）→ 暂停 60s 后继续
- ⚠️ **标签页会卡死在 `Loading...`（曾导致整批 NO_CARDS 假 MISS）**：SPA 数据请求未回落时
  页面只剩页头页脚 + 一个 "Loading..." 方块，`.joblist-item` 数量为 0。
  此时**同一个标签页反复重试永远失败**，必须重置标签页引用让它重新挑/新建标签页：
  ```js
  if (i >= 2) { Ts = null; }   // 第 2 次重试起强制换页
  ```
  并在等待循环里检测 `document.body.innerText` 含 `Loading...` 时 `Page.reload({ignoreCache:true})`。
  等待上限放到约 20s（慢速首屏），不要只等 8s 就判 NO_CARDS。
- 标题里的「**<kw>,北京,上海招聘**」只是 SEO 文案，**不代表检索被限定在这两个城市**：
  实测 `keyword=宇树科技`（杭州）无任何城市参数即返回苏州/杭州岗位，检索本身就是全国。
  `&jobArea=000000` 与之等价；但 `&jobArea=000000&searchType=2` 会把标题变成「全国招聘」
  且结果清零 —— 不要加 `searchType`。

### 智联招聘（`zhaopin.com`）—— 覆盖有限，作补充
- 搜索页 `https://www.zhaopin.com/jobs?kw=<kw>`
- ⚠️ **城市参数（大坑，曾导致 58/122 家假 MISS）**：**不传 `jl` 才是全国检索**。
  实测 `kw=机器人` 不传 `jl` 返回杭州/青岛/深圳，已是全国超集。
  - `jl=530` = **北京**（页面标题会变「北京热门职位招聘」），不是全国！
  - `jl=<你所在城市码>` = 站点默认城市（与账号 / IP 绑定，需自行确认）
  - `jl=-1` / `jl=全国` 会让 POST body 里 `S_SOU_WORK_CITY` 字段缺失，**不等于全国**
  - 记忆法：**别传 jl，先全国捞，再单独补搜本地城市**
- ⚠️ **必须校验 `state.kw` 已刷新**（曾导致假 MISS + 张冠李戴）：搜索是 POST 到
  `fe-api.zhaopin.com/c/i/search/positions`（body 含 `S_SOU_FULL_INDEX` 关键词 /
  `S_SOU_WORK_CITY` 城市码），结果异步回填 `window.__INITIAL_STATE__.positionList`。
  同一标签页连续搜不同关键词时，`positionList` **会残留上一次的结果**。
  判定「已刷新」的唯一依据：`normName(state.queryParams.kw) === normName(本次kw)`；
  只有满足才采信 `positionList`（实测 3s 内刷新）。
  早期写成 `if (list.length) return list` → 把上一次的卡片当本次结果，
  候选里会出现润滑油/人力资源/阿胶等完全无关公司。
- **一次导航即可拿全字段**：读 `window.__INITIAL_STATE__.positionList`，
  字段 `name/companyName/salary60/workCity/workingExp/education/companySize/
  industryName/property/financingStage/skillLabel/welfareLabel/positionUrl/jobId`；
  详细地址在 `cardCustomJson.address`
- 详情 JD：`fetch('https://www.zhaopin.com/jobdetail/<...>.htm')`（服务端渲染，约 1.2s/个），
  选择器 `.describtion-card__detail-content` / `.describtion-card__skills-item` / `.job-features__value`
- 薪资：`1.5-2万`、`7000-9000元` —— **「万」= 月薪万**
- ⚠️ **`?kw=` 是全文检索（含 JD 正文），不是公司名检索**：会命中大量**人力资源中介**
  代发的岗位（候选里常见 外企德科 / 锐仕方达 / 苏州汇星诚 等），公司名字段是中介而非目标公司。
  同时确实有相当比例的公司真的 0 条（如 海岳智能 / 长风扬 / 意创科技，`positionList` 为空）。
  `window.__INITIAL_STATE__.positionCount` 常年为 0/缺失，**不能用它判断「是否无结果」**，
  要看 `positionList.length`。已验证 `keywordCompanySearchData` 为空、
  `cgate.zhaopin.com/.../getKeyWordCompanySearch` 返回 `statusCode 210`（异步 taskId），
  `/company/?kw=` 公司搜索页同样常返回 0。
  **这是平台索引特性，不要当 bug 修**；用前程无忧/猎聘补缺口即可
- 无法通过读取页面自身请求以外的方式取数：`fe-api` 直连会校验 `at`/`rt`/
  `x-zp-page-request-id`，自造请求一律 count=0 → 用 `Network.getResponseBody` 读页面自己的响应

### BOSS直聘（`zhipin.com`）
- 风控严格，未登录/高频易触发 code 36；需要登录态 + 保守节奏

## 4. 公司名严格匹配（最容易出错的一环）

**错误做法**：只取「命中最长的核心词」并与首个命中候选绑定。
2 字核心词会张冠李戴：`乐驰机器人 → 厦门乐驰食品`、`兴远电机 → 河北兴远集团`、
`微芯电子 → 广东派微芯显`。

**正确做法**：四级排序
1. 命中公司名的**词长**（先按 4/3/2 字前缀 + 去通用词后的核心词生成候选 token）
2. 目标名在候选公司名中**按顺序出现的字符数**（`coverage`）—— 这条把 乐驰**深圳**机器人 判赢
   厦门乐驰**食品**
3. 目标名不含跨行业词、候选却含（`食品|房地产|置业|集团|物流|投资|贸易|传媒|教育|医药…`）→ 降权
4. 名称更短者优先

且匹配键长度 < 2 直接判未命中。**最后再加一层人工复核兜底**：
平台池里确实没有正确主体的，用一个 `REJECT_TARGET` 映射剔除，
并在说明页列出「命中公司名 + 剔除原因」，绝不把错主体数据塞进结果表。

**命中之后仍要隔离岗位池（比匹配本身更容易漏的一环）**：匹配函数返回的 `hit` 正确，
不代表后面重建岗位池就安全。早期用 `hit.key`（2~4 字品牌词）做
`cards.filter(x => normName(x.company).includes(key))` 重建池子，会把检索结果里
**同名不同司**的公司一起捞进来（`星汉` → 浙江星汉博纳医药、`乐驰` → 厦门乐驰食品、
`天工` → 大连天工润滑油），再按出现频次选 `target` 就张冠李戴。
正确做法是两级严格口径的 `scopeOf(cards, target, must, hit)`：
- tier1：与「命中卡片」公司名等同 / 互为包含（含分公司后缀）
- tier2：必须过 `must` 正则 + `plausible()`，且与命中公司名有 ≥4 个连续公共字符
- `tier1.length >= 2` 取 tier1，否则 tier1 ∪ tier2

同时把跨行业词表（`DOMAIN_BAD`）补全到业务相关但绝不可能是机器人产业链主体的领域：
`医药|食品|矿业|**润滑油**|轮胎|橡胶|燃气|水务|地产|水产|包装|印刷|酒业|乳业|烟草` 等。
判定规则：目标公司名不含该词、命中公司名含该词 → 直接否决。
改完务必用正反例回归（正例：`天工精工→宁波天工精工股份有限公司`；
反例：`天工精工→大连天工润滑油有限公司`），并全库复跑一遍确认没有误伤已入库记录。

## 5. 岗位筛选（按 HR 视角取代表性样本）

- `HARD_BAD` 正则排除销售/人力/财务/行政/客服/普工/操作工等非目标岗
- 优先级：`K1`（算法/控制/机器人/电机/嵌入式/机械/工艺/测试/研发…）>
  `K2`（经理/主管/生产/质量/设备/项目/PMC）
- 薪资数值 + 本地城市加分
- 每家公司取 4 个代表性岗位（非全量），同时保留 `allJobs` 全量清单备查

## 6. 薪资口径（**大坑**）

各平台「万」含义不同，必须**按来源平台**区分归一化：

| 平台 | 格式 | 含义 |
|---|---|---|
| 猎聘 | `15-25k·13薪` | k = 月薪千元；「万」= 年薪（万×10÷12 折算） |
| 前程无忧 | `1.2-2.2万·15薪`、`8千-1.1万` | **「万」= 月薪万**（×10 → K） |
| 智联 | `1.5-2万`、`7000-9000元` | **「万」= 月薪万**；元 = 月薪元 |

解析要点：先剥掉 `·13薪` 尾巴，再用 `(\d+(?:\.\d+)?)\s*([kK千万元])?` 抓全部数字+单位，
**缺单位的数字继承本串里出现的单位**（否则 `8千-1.1万` 会被解析成 `8K`）。

## 7. 断点续抓

- 每条公司结果 append 到 `data/<platform>_all.jsonl`
- 启动时读文件收集「已完成」集合（**只把 `ok` 的算完成**，MISS/ERR 下次自动重试）
- 进度写 `data/.progress_<platform>`
- 支持 `--only 公司A,公司B` 定点重跑（配合备份 + 剔行 = 安全返工）

### 7.1 JD 缺失补救（`patch_jd.js`）

抓完后先做一次 JD 覆盖率体检（按平台分桶统计 `jd` 长度 < 20 的条数）。
本次实测：51job 有 17 家公司 **4/4 岗位全缺 JD**（成片失败，多是详情页限频/软拦截），
猎聘有 35 条（这些卡片的 `jobId` 本身就是空的，平台未暴露 → 无法补）。

**只要 `detailUrl` 在，就能补**：工具包内的 `patch_jd.js` 扫 jsonl 里 `jd` 为空的岗位，
按平台配方抠出参数（51job 用 `detailUrl` 里的 jobId、猎聘用 `detailUrl` 本身），
用同一个详情标签页重 fetch（慢速 1.2-3s + 最多 4 次退避重试，重试时换标签页），每 15 条阶段落盘。
本次 67/67 全部补齐，零失败 —— 说明**不是没数据，是当时节奏太快**。

```bash
node "<SKILL_DIR>/scripts/patch_jd.js" all          # 补 job51 + liepin
node "<SKILL_DIR>/scripts/patch_jd.js" job51 --dry  # 只统计待补条数，不抓
```

> 结论：抓取主流程的 JD 失败不要就地接受，单独慢速补抓一轮的成本很低、收益很高。
> 注意：补抓依赖 `data/<platform>_all.jsonl` 里的 `detailUrl`，主流程务必保留该字段。

### 7.2 「JD 全空 + 岗位数偏低」= 浏览器过载，不是反爬（实测踩过）

**症状**：`ok` 率正常，但每条都是 `JD0字`，且 `nJobs` 明显偏小（如只 1-4 条，
而同公司上一轮是 16-18 条）；单公司耗时从 ~20s 涨到 ~90s。

**误判风险**：很容易当成「51job 详情页限频」去写补抓脚本 —— 但补抓也会一样失败。

**真相**：详情页的 `fetch` 在浏览器过载时会整体卡住不返回。`fetchJD` 里有 3 次重试
× 25s CDP 超时 = 每公司白白耗 75s，而搜索页也因渲染慢只出少量卡片。
本次成因是**三平台并发 + 浏览器连开 23 个标签页 + 连续运行 24h 以上**。

**5 分钟确诊**：停掉抓取脚本，让标签页空闲，单独跑一次详情解析（本工具包可直接用）：

```bash
node probe.js j51 173602640     # 打印 __j51Detail 的 JD 长度与裸 fetch 的 HTTP 状态
node probe.js liepin            # 猎聘同理（用卡片里的 detailUrl）
```

- 空闲时能拿到几百字 JD、裸 fetch 返回 200 → **纯过载**，重启抓取即可，配方没问题
- 空闲时仍失败、HTTP 403/405/429 → 才是真的限频/风控，走 §7.1 慢速补抓

**处置顺序**（照做即可恢复）：

```bash
# 1) 停掉正在跑的抓取（后台任务 + 残留 node 进程都要确认退出）
# 2) 关掉堆积的标签页（zhilian 一次抓取会漏十几个，这是主要内存压力源）
node close_tabs.js zhilian && node close_tabs.js liepin && node close_tabs.js 51job
# 3) 让脚本独占浏览器重跑：不要与其他平台并发
node j51.js
```

> 铁律：**平台之间不要并发超过 2 个**；跨过夜/跨天长跑一轮之后，先清标签页再开新轮。
> 判断"是否还有进程在跑"不要只信任务列表 —— 用 `wc -l data/<p>_all.jsonl` 隔 60s 对比两次更可靠。

## 8. 诊断手法（不干扰正在运行的任务）

主抓取脚本用 `pick(host)` 抢占目标标签页，所以诊断**不能**复用同一标签页。改为：

```bash
# 新建独立标签页（必须 PUT）
curl -X PUT "http://127.0.0.1:9222/json/new?https://..."
# 连它的 webSocketDebuggerUrl 做探测，用完关闭
curl "http://127.0.0.1:9222/json/close/<targetId>"
```

想看真实接口：连上后先 `Network.enable` + `Page.enable`，**再** `Page.navigate`，
轮询 `Network.requestWillBeSent` 事件收集 URL —— 比盲猜接口高效得多。

### 8.1 「大面积 0 结果」先截图，再谈限流（最重要的一条）

遇到整批 MISS / `count=0`，**不要先假设被限流去等冷却**（本次为此白等了半小时）。
按顺序做三步，5 分钟定位：

1. **截图看用户实际看到什么**（连现有标签页，别新开）：
   ```js
   const {data} = await c.send('Page.captureScreenshot', {format:'jpeg', quality:60});
   fs.writeFileSync('shot.jpg', Buffer.from(data,'base64'));
   ```
   页面若写「暂未找到符合你要求的职位」→ 就是检索无结果，不是风控。
2. **看页面标题**：标题里的城市（「北京热门职位招聘」「上海热门职位招聘」）直接暴露
   当前生效的城市参数 —— 本次就是靠标题发现 `jl=530` 其实是北京。
3. **同一个关键词做对照**：换一个**已知一定有结果**的宽词（如 `机器人`、`普工`）。
   宽词有结果 = 接口健康；只有目标公司为 0 = 该公司/参数问题。
   本次 `机器人`/`云智动力`/`星辰传动`/`普工` 全部返回 20 条 → 平台完全健康。

> 反例教训：曾判定「智联账号临时限流、需冷却」，实际是**自己传错了城市参数**。
> 平台侧限流的特征文案是滑块/访问验证/HTTP 429，**不是安静地返回 0 条**。

## 9. 沙箱环境限制

`tasklist` / `wmic` / `cmd.exe` / `stdbuf` / 从 Bash 调用 `powershell.exe` 常被安全策略拦截。
一律改用 **Node 原生能力**（`http` / `fetch`）实现进程/网络/文件操作。

**进程管理**：Bash 工具里 `nohup ... &` 会随该次调用结束被回收。要长跑就用
Bash 工具的 `run_in_background: true`；另外 Node 的 `console.log` 在**管道**下会缓冲
（`| tee` 看不到实时进度），改成 **文件重定向** `> data/xx.log 2>&1` 才能实时 `tail`。

## 10. 交付

`build_xlsx.py`（工具包内）生成多 Sheet Excel：
岗位汇总（主表，本地岗位加底色）/ 本地岗位 / 公司概览（各平台命中名）/ 全部在招岗位 /
原始JD明细 / 说明与未匹配（含各平台覆盖统计、字段口径、匹配逻辑、剔除记录）。

**表头列数硬校验**：`len(row)+1 == HDR_N`，防止字段增删导致整行错位。

单跑出表（已有 jsonl、只想重出表时）：

```bash
cd <工作目录> && python "<SKILL_DIR>/scripts/build_xlsx.py"
```
