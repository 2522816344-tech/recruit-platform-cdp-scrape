# FAQ

## 基础

### 这个工具能做什么？

给定公司名单，从猎聘 / 前程无忧 / 智联招聘 / BOSS直聘批量抓取它们公开可见的岗位信息，
汇总成多 Sheet 的 Excel。

### 为什么不直接用平台官方 API？

官方 API 通常不开放给个人 / 抓取报价；或者只能拿到部分字段（如不包含 JD 全文）。
本工具复用你自己的浏览器会话，相当于「把你在网页上能看到的都拿下来」。

### 数据保存在哪里？

全部保存在你的本地：
- `data/<platform>_all.jsonl`：每个平台一行一条结果
- `data/.progress_<platform>`：抓取心跳
- `<title>.xlsx`：最终 Excel（位置由 `config.json` 的 `title` 决定）

### 我的账号 / Cookie 会上传吗？

**不会**。本项目是本地工具，所有数据只在你的电脑上。

## 用法

### 怎么开始？

参见 [README.md](../README.md) 的「快速上手」。

### 怎么只跑某几个平台？

```bash
node scripts/run.js --platforms liepin,job51
```

### 怎么只抓名单里某几家公司？

```bash
node scripts/run.js --only 公司A,公司B
```

### 怎么只跑小样本试水？

```bash
node scripts/run.js --limit 3 --jobs 2
```

### 中途中断后能继续吗？

**可以**。`data/<platform>_all.jsonl` 是 append-only 的，已成功的公司会自动跳过。
直接重跑即可。

## 合规

### 这个工具合法吗？

参考 [COMPLIANCE.md](./COMPLIANCE.md)。个人使用、只抓自己已登录可见的数据、不绕风控——
这些边界条件下使用是合理的。但**每个用户对自身行为负责**。

### 我能把抓到的数据用于商业报告吗？

**不可以**。本项目明确禁止商业用途。如需商业报告，建议用官方 API 或人工整理。

### 平台 ToS 不同意怎么办？

由你自行决定是否使用本工具。本项目**不强制用户接受任何 ToS**，
也不对违反 ToS 的后果负责。

## 技术

### 为什么不引入 npm 依赖？

Node 22 内置 `WebSocket` / `http` / `fs` 已经覆盖全部需求，引入依赖反而增加：
- 依赖被劫持的风险
- 安装复杂度
- 包体积

而且 CDP 协议是文本 JSON，调起来很简单，不需要 axios / ws 之类的库。

### 为什么用 CDP 而不是 Puppeteer / Playwright？

| | CDP | Puppeteer / Playwright |
|---|---|---|
| 启动浏览器 | 用你**自己的** Chrome | 通常另开一个隔离的 Chromium |
| 登录态 | 直接复用 | 要手动传 Cookie / 注入 |
| 体积 | 0 依赖 | 几十 MB |
| 复杂度 | 协议层 | 框架层 |

复用你自己的 Chrome 是这个工具的核心卖点，CDP 是唯一的选择。

### 怎么加一个新平台？

参见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

简短步骤：
1. 在 `scripts/` 下加 `xxx.js`（参考现有平台的结构）
2. `xxx_func.js` 写卡片 / 详情提取函数
3. 在 `common.js` 加跨行业词
4. 在 `run.js` 加进 `PLATFORMS`
5. 在 `build_xlsx.py` 加字段映射
6. 写测试（`tests/`）
7. 跑 `scripts/check_repo.py`

### 怎么把 Excel 列对齐？

`scripts/build_xlsx.py` 里有一处硬校验：`len(row)+1 == HDR_N`。
如果新加了字段，必须同步改 `HDR_N` 和对应的 `append`。

### 跑多久能跑完？

大概 100 家公司 / 平台 / 1 小时（保守节奏）。
4 个平台 × 100 家公司 ≈ 4 小时。

## 故障

### 看到 `safe.liepin.com/v/intercept/verifysms`

猎聘风控拦截。手动过验证，然后把节奏调到 15-25 秒 / 家。

### 智联永远返回 0

1. 不传 `jl` 参数
2. 试 `kw=机器人` 或 `kw=普工` 看平台是否健康
3. 智联「全文检索」语义本身就容易返回 0——属平台索引特性，不是 bug

详见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。

### 数据不完整（很多公司是 0）

原因可能是：
- 智联是全文检索，公司名单上的公司可能本来就没在智联发岗位
- BOSS 风控严格，被风控了就别再试
- 公司名单本身有问题（用了错误的简称）

多平台通常能凑齐。