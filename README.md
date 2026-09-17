# recruit-platform-cdp-scrape

> **个人使用工具**：复用你**已登录的浏览器会话**（通过 CDP 远程调试端口），从猎聘 / 前程无忧 / 智联招聘 / BOSS直聘批量抓取公司岗位并汇总成 Excel。
> **仅供个人使用，不得商用。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522-339933)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-%E2%89%A53.8-3776AB)](https://www.python.org/)
[![Zero deps](https://img.shields.io/badge/dependencies-0-success)](./package.json)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](./tests/)

> ⚠️ **使用前必读**：[`docs/COMPLIANCE.md`](./docs/COMPLIANCE.md) — 个人使用边界 / 商业用途禁令 / ToS 风险
> 📖 **深入了解**：[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 系统架构 / 关键设计
> 🛠 **遇到问题**：[`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) — 故障排查清单
> ❓ **常见疑问**：[`docs/FAQ.md`](./docs/FAQ.md)

---

## 这是什么？

一个**开源**（MIT）**个人**调研工具。给一份公司名单，自动去 4 个招聘平台抓
**「公司规模 / 性质 / 行业 / 岗位 / 城市 / 经验 / 学历 / 薪资 / JD / 福利」**，汇总成多 Sheet 的 Excel。

### 核心特点

- ✅ **零 npm 依赖**：只用 Node 22 内置 `WebSocket` / `http` / `fs`
- ✅ **零 npm 依赖**：只用 Python `openpyxl`
- ✅ **复用你自己的浏览器**：不存 Cookie / Token；遇到验证码停下来，不硬撞
- ✅ **断点续抓**：中断后自动续跑，已成功的公司不重抓
- ✅ **慢速节奏**：每个平台 2.5-13 秒/家，避免触发风控
- ✅ **跨平台**：Windows / macOS / Linux 都能跑
- ✅ **CI 测试**：GitHub Actions 自动化 lint + 单元测试

---

## 快速上手

### 1. 安装

```bash
# 需要 Node 22+ 和 Python 3.8+
git clone https://github.com/yourname/recruit-platform-cdp-scrape.git
cd recruit-platform-cdp-scrape
pip install -r requirements.txt
```

### 2. 准备一个工作目录

```bash
mkdir my-research && cd my-research
# 复制名单模板
cp ../recruit-platform-cdp-scrape/scripts/companies.example.json ./companies.json
# 编辑 companies.json，把公司名单填进去
# 简写：["星辰传动", "云智动力"]
# 完整：[{ "n": "海岳智能", "kw": "海岳", "alt": "海岳智能", "must": "机电" }]
```

### 3. 复制你已登录的 Chrome profile

⚠️ **必须先完全关闭 Chrome**，否则 Cookies 文件被锁。

```bash
node ../recruit-platform-cdp-scrape/scripts/chrome.js --init-profile
```

### 4. 启动浏览器（带 CDP 调试端口）

```bash
node ../recruit-platform-cdp-scrape/scripts/chrome.js
```

### 5. 体检登录态

```bash
node ../recruit-platform-cdp-scrape/scripts/verify.js
```

任何一个平台提示未登录，就在自动打开的浏览器里手动登录一次。

### 6. 开始抓取

```bash
node ../recruit-platform-cdp-scrape/scripts/run.js
```

会依次：**启动浏览器 → 体检登录态 → 逐平台抓取 → 汇总出 Excel**。

### 7. 输出

`<config.title>.xlsx` 出现在你的工作目录里：

- **岗位汇总（主表）** — 按公司分组的岗位列表
- **本地岗位** — 命中本地城市的岗位（高亮）
- **公司概览** — 各平台命中的公司名（便于审计）
- **全部在招岗位** — 每家公司的全量清单
- **原始 JD 明细** — 完整 JD 原文（不做截断）
- **说明与未匹配** — 各平台覆盖统计、字段口径、剔除记录

---

## 常用参数

```bash
node scripts/run.js \
  --platforms liepin,job51,zhilian   # 只跑这些平台
  --only 星辰传动,云智动力           # 只抓这几家
  --jobs 6                            # 每家取 6 个代表岗位
  --limit 3                           # 只跑名单前 3 家（试水用）
  --pace 9000                         # 覆盖间隔（毫秒）
  --skip-chrome                       # 浏览器已在跑，不拉起
  --no-verify                         # 跳过登录态体检
```

更多参数见 [`docs/FAQ.md`](./docs/FAQ.md)。

---

## 环境变量（可选）

| 变量 | 说明 | 默认 |
|---|---|---|
| `SCRAPE_DIR` | 工作目录 | 进程当前目录 |
| `SCRAPE_DATA` | 数据目录 | `<SCRAPE_DIR>/data` |
| `SCRAPE_CONFIG` | 配置文件 | `<SCRAPE_DIR>/config.json` |
| `SCRAPE_COMPANIES` | 名单文件 | `<SCRAPE_DIR>/companies.json` |
| `CDP_PORT` | 调试端口 | 9222 |
| `BROWSER_EXE` | 浏览器可执行文件 | 自动探测 |
| `CHROME_PROFILE` | 抓取专用 profile 目录 | `<SCRAPE_DIR>/chrome-profile/User Data` |
| `CHROME_PROXY` | 代理（如 `http://127.0.0.1:7890`） | 直连 |
| `PYTHON` | Python 解释器 | `python3` / `py` |

完整模板：[`.env.example`](./.env.example)

---

## 项目结构

```
recruit-platform-cdp-scrape/
├── README.md                 ← 你正在看
├── SKILL.md                  ← WorkBuddy skill 入口（用 WorkBuddy 调用时）
├── LICENSE                   ← MIT
├── CHANGELOG.md              ← 版本变更
├── CONTRIBUTING.md           ← 贡献指南
├── CODE_OF_CONDUCT.md        ← 行为准则
├── SECURITY.md               ← 安全政策
├── .gitignore                ← 排除 data/ chrome-profile/ 等
├── .env.example              ← 环境变量模板
├── package.json              ← Node 项目元信息
├── pyproject.toml            ← Python 项目元信息
├── requirements.txt          ← Python 依赖（只 openpyxl）
│
├── docs/                     ← 详细文档
│   ├── ARCHITECTURE.md
│   ├── COMPLIANCE.md
│   ├── TROUBLESHOOTING.md
│   └── FAQ.md
│
├── scripts/                  ← 核心脚本
│   ├── run.js                ← 总入口
│   ├── chrome.js             ← 浏览器启动 + profile 复制
│   ├── verify.js             ← 登录态体检
│   ├── cdp.js                ← CDP 驱动（Node 22 内置 WebSocket）
│   ├── cdpx.js               ← 独立标签页快速探测
│   ├── common.js             ← 公司名匹配 + 岗位筛选
│   ├── paths.js              ← 跨平台路径解析
│   ├── liepin.js             ┐
│   ├── zhilian.js            ├─ 4 个平台抓取脚本
│   ├── job51.js              │
│   └── boss.js               ┘
│   ├── patch_jd.js           ← 慢速补抓缺失 JD
│   ├── probe.js              ← 详情抓取体检（区分过载 vs 风控）
│   ├── open_tab.js           ← 新建标签页
│   ├── close_tabs.js         ← 清理标签页
│   ├── build_xlsx.py         ← 出表（多 Sheet）
│   ├── check_repo.py         ← 仓库卫生校验（隐私硬编码扫描）
│   ├── companies.example.json
│   └── config.example.json
│
├── tests/                    ← 测试
│   ├── test_paths.js
│   ├── test_common.js
│   ├── test_xlsx.py
│   └── fixtures/
│
└── .github/
    ├── workflows/
    │   ├── lint.yml          ← 语法检查 + 隐私扫描
    │   └── test.yml          ← 单元测试（Ubuntu/Windows/macOS）
    └── ISSUE_TEMPLATE/
        ├── bug_report.md
        └── feature_request.md
```

---

## 踩过的坑（改脚本前先看）

1. **智联别传城市参数**。`jl=530` 是**北京**不是全国，不传 `jl` 才是全国超集。
2. **智联必须校验 `__INITIAL_STATE__.queryParams.kw` 已刷新**，否则会把上一次的残留卡片当本次结果。
3. **51job 搜索页会卡死在 `Loading...`**，同一个标签页重试永远失败，必须换标签页 + 硬刷新。
4. **公司名匹配不能只看最长公共词**。2 字核心词会张冠李戴（`乐驰机器人` → `厦门乐驰食品`）。
5. **各平台「万」的含义不同**：前程无忧/智联是月薪万，猎聘是年薪万。混用会让薪资差 10 倍。
6. **`nohup ... &` 会随工具调用结束被回收**——长跑要用带文件流的方案。
8. **不要让 3 个以上平台并发跑**，跨天长跑前先清标签页。
9. **列表卡片里就有经验/学历，一定要留下来**：`allJobs` 存 5 字段（岗位名/薪资/城市/经验/学历）。

详见 [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) 和 [`SKILL.md`](./SKILL.md) 的 §7。

---

## 安全 / 合规

- **不模拟登录** — 用你自己已登录的浏览器会话
- **不传播数据** — 所有数据保存在你的本地
- **不绕风控** — 遇到验证码停下来等人手动过
- **不商用** — 见 [`docs/COMPLIANCE.md`](./docs/COMPLIANCE.md)

详见 [`SECURITY.md`](./SECURITY.md)。

---

## 发布到 GitHub / 分享给朋友

### 发到 GitHub（开源）

```bash
git init -b main
git add .                          # .gitignore 会自动挡掉 data/ chrome-profile/ *.jsonl 等
git commit -m "release: v1.0.0 initial open-source release"
git tag -a v1.0.0 -m "first public release"
gh repo create recruit-platform-cdp-scrape --public --source=. --remote=origin --push
git push origin v1.0.0             # 触发 .github/workflows/ CI
```

### 分享给朋友（不经过 git）

不想走 git？想直接把干净的代码包发朋友？用 `scripts/pack_for_share.js`，
**主动按黑名单剔除隐私与缓存条目，不依赖 .gitignore**（普通 zip 工具不读 .gitignore）：

```bash
node scripts/pack_for_share.js
# → recruit-platform-cdp-scrape-share.zip
```

主动剔除清单：
- `data/` + 任何 `*.jsonl`（抓取原始数据）
- `chrome-profile/`（带登录态的浏览器 profile，**风险最高**）
- `.env` / `.env.local` / `.env.production`（私密环境变量）
- `*.xlsx` / `*.log`（结果与日志）
- `node_modules/` / `__pycache__/` / `.git/` / `.vscode/` / `.idea/`
- 编辑器临时文件 `*~` / `*.bak` / `Thumbs.db` / `.DS_Store`

> **保留**：`.env.example` / `.env.sample`（模板文件，需要分发出去）
>
> 朋友收到后只要 `pip install -r requirements.txt` 就能 `node scripts/run.js` 跑起来。

---

## 贡献

欢迎贡献！详见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

简短步骤：
1. Fork → 新建分支
2. 写测试（`tests/`）
3. 跑 `node tests/test_paths.js && node tests/test_common.js && python tests/test_xlsx.py`
4. 跑 `python scripts/check_repo.py`
5. 提 PR

---

## 许可证

[MIT](./LICENSE) — 但请遵守 [`docs/COMPLIANCE.md`](./docs/COMPLIANCE.md) 的使用边界。

---

## Star History

如果你觉得这个工具有用，欢迎 Star / Watch 以跟踪新版本。