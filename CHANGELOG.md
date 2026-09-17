# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- 多账号隔离（每个公司单独子账号）
- 抓取速率自适应（基于 HTTP 状态码动态退避）
- 导出 JSON / CSV（除 xlsx 外）

## [1.0.0] - 2026-09-17

### Added
- 22 个首发文件：LICENSE / CHANGELOG / CONTRIBUTING / CODE_OF_CONDUCT / SECURITY
- `.gitignore` / `.env.example` / `package.json` / `pyproject.toml` / `requirements.txt`
- `docs/`：ARCHITECTURE / COMPLIANCE / TROUBLESHOOTING / FAQ
- `tests/`：test_paths.js（18）/ test_common.js（24）/ test_xlsx.py（9）
- `.github/workflows/`：lint.yml + test.yml（Ubuntu / Windows / macOS 矩阵）
- `.github/ISSUE_TEMPLATE/`：bug_report.md + feature_request.md
- `scripts/check_repo.py`：仓库卫生检查（必备文件 / 隐私硬编码 / .gitignore / 调试残留）
- **`scripts/pack_for_share.js`**：跨平台一键生成"可分发 zip"，主动按黑名单剔除 `data/` `chrome-profile/` `.env` `*.jsonl` `*.xlsx` 等（不依赖 .gitignore）
- README 「发布到 GitHub / 分享给朋友」节：5 步 git 发布 + `pack_for_share.js` 用法

### Fixed
- 薪资解析单位继承 bug（`1.5-2万` 之前误算为 10.75k → 正确 17.5k；新增 unit_inheritance_mixed 回归测试）

### Compliance（README / COMPLIANCE / SECURITY 同步声明）
- 个人使用、不得商用、不绕风控、拒绝用于绕过 ToS / 批量账号 / 撞库

## [0.2.0] - 2026-09-17

### Added
- `common.js` 公司名严格匹配（4 级排序 + 两级 scopeOf + DOMAIN_BAD 跨行业排除）
- `paths.js` 跨平台路径 / 配置解析（Win / macOS / Linux 一致）
- `chrome.js` 浏览器自动探测与 profile 复制（含 DPAPI 提示）
- `patch_jd.js` 慢速补抓缺失 JD（猎聘 / 前程无忧 / 智联）
- `probe.js` 详情抓取体检（区分「过载 vs 风控」）
- `build_xlsx.py` 多 Sheet Excel（汇总 / 本地 / 公司概览 / 全部在招 / 原始JD / 说明）
- 断点续抓（`data/<platform>_all.jsonl` + `data/.progress_<platform>`）
- 平台间相互隔离（每个平台独立标签页，并发≤2）
- 风控识别（猎聘短信验证 / 智联滑块 / 前程无忧卡 Loading / BOSS code 36）

### Fixed
- 智联「`jl=530` ≠ 全国，是北京」—— 不传 `jl` 才是全国超集
- 智联「残留 `positionList` 张冠李戴」—— 必须校验 `__INITIAL_STATE__.queryParams.kw`
- 51job「搜索页卡死 Loading...」—— 二次重试强制换标签页 + 硬刷新
- 公司名匹配「2 字核心词张冠李戴」—— 词长 + coverage + 跨行业 + 名称更短 4 级排序
- 「allJobs 只存 3 字段导致经验/学历覆盖率掉到 30%」—— 改为存 5 字段

## [0.1.0] - 2026-09-14

### Added
- 首次发布（基于 CDP 复用登录态）
- 猎聘 / 前程无忧 / 智联 / BOSS 四平台抓取
- 一条命令 `node run.js` 跑完启动→体检→抓取→出表