# Troubleshooting

## 启动类

### `CDP port 9222 不通`

症状：`curl http://127.0.0.1:9222/json/version` 无响应。

Chrome 136+ 起明确拒绝在默认 user-data-dir 上开调试端口。修复：

```bash
node scripts/chrome.js --init-profile   # 复制你的真实 Chrome profile
node scripts/chrome.js                  # 用复制出的 profile 启动
```

### `NO_TARGET`

`scripts/cdpx.js info` 没有输出任何页面。

说明浏览器已启动但没有 page 类型标签。手动开一个：

```bash
node scripts/open_tab.js https://www.liepin.com/
```

### 浏览器是 Edge 不是 Chrome

`scripts/chrome.js` 会自动探测 Edge（`msedge.exe`）。如果你想强制 Chrome：

```bash
BROWSER_EXE="C:\Program Files\Google\Chrome\Application\chrome.exe" node scripts/chrome.js
```

## 登录类

### 某个平台 `verify.js` 提示未登录

在自动打开的浏览器里手动登录一次。**不要**在登录态失效的标签页里抓取。

如果所有平台登录态掉了（断电 / 浏览器重启后）：

```bash
node scripts/chrome.js --init-profile   # 重新复制 profile
node scripts/chrome.js
node scripts/verify.js
```

### Cookie 复制后立刻失效

DPAPI 绑定的用户密钥可能变化。处理：

1. 确认是同一台机器、同一用户
2. 用 `--init-profile` 重新复制
3. 在复制的浏览器里手动登录
4. 跑 `verify.js` 验证

## 抓取类

### 智联大面积 0 结果

检查清单：

1. **不传城市参数**：`kw=海岳智能` 而不是 `kw=海岳智能&jl=489`
2. **页面是否真的 0**：截图看 `暂未找到符合你要求的职位`
3. **平台是否健康**：试 `kw=机器人` 或 `kw=普工`，宽词有结果 = 平台健康
4. **账号是否限频**：换一个账号试

### 智联「张冠李戴」（结果里出现完全无关公司）

一定是 `__INITIAL_STATE__.queryParams.kw` 没刷新。已通过代码修复（`scripts/zhilian.js`），
如发现复发请开 issue。

### 51job 搜索页卡在 `Loading...`

- 标签页卡死在 SPA 渲染中
- 同一个标签页反复重试永远失败
- **处置**：第 2 次重试起强制换标签页 + 硬刷新（`Page.reload({ignoreCache:true})`）
- 等待上限 20s（不要只等 8s 就判 NO_CARDS）

### 51job 详情页返回 `Loading...` 或空 JD

1. 确认是限频还是过载：`node scripts/probe.js j51`
2. 空闲时能拿到几百字 JD → 过载 → 重启抓取
3. 空闲时仍失败、HTTP 403 / 405 / 429 → 真限频 → `node scripts/patch_jd.js job51` 慢速补

### 猎聘触发短信验证（`safe.liepin.com/v/intercept/verifysms`）

**停下来**，在浏览器里手动过验证，然后调整节奏：

```json
{
  "pace": { "liepin": [15000, 25000] }
}
```

### BOSS code 36

账号被临时风控。处理：

1. 暂停所有 BOSS 抓取（`--platforms liepin,job51,zhilian`）
2. 24-48 小时后再试
3. 或者换账号

## 浏览器类

### 浏览器过载（JD 全空 + 岗位数偏低 + 每家 90s）

典型症状：
- `ok` 率正常，但 `JD 0` 多
- 每家公司耗时从 ~20s 涨到 ~90s

**5 分钟确诊**：

```bash
node scripts/probe.js j51 173602640   # 打印详情页 JD 长度 + 裸 fetch HTTP 状态
```

- 空闲时 JD 几百字、HTTP 200 → 纯过载，重启即可
- 空闲时仍失败、HTTP 403 / 429 → 真限频

**处置**：

```bash
# 1) 停掉所有抓取
# 2) 清标签页
node scripts/close_tabs.js zhilian && node scripts/close_tabs.js liepin && node scripts/close_tabs.js 51job
# 3) 独占重跑（不要并发）
node scripts/job51.js
```

### 标签页堆积 20+ 个

通常是抓取脚本异常退出但没清理。`close_tabs.js` 清理：

```bash
node scripts/close_tabs.js zhilian   # 只清智联
node scripts/close_tabs.js all       # 清所有
```

## Excel 类

### 字段错位（公司名跑到岗位名）

`scripts/build_xlsx.py` 的表头列数变了。处理：

1. 同步 `build_xlsx.py` 里的 `HDR_N`
2. 重新出表：`python scripts/build_xlsx.py`

### Excel 打开后所有字段在同一格

多半是中文 / UTF-8 BOM 问题。处理：

```bash
# Excel 重新打开时选「数据 → 自文本 → UTF-8」
# 或在 build_xlsx.py 里显式指定 UTF-8
```

### 公司名匹配错（`乐驰机器人` → `厦门乐驰食品`）

是匹配算法不够严。处理：

1. `common.js` 的 `DOMAIN_BAD` 加上 `食品`
2. `config.json` 的 `rejectTarget` 加上 `{"乐驰机器人": ["食品"]}`

## 环境类

### `tasklist` / `wmic` / `cmd.exe` 被拦截

项目**已经全部走 Node 原生**（`http` / `fetch` / `fs`），不依赖这些系统命令。

### Node 版本不够

`require('WebSocket')` 需要 Node 22+。检查：`node -v`。

### Python `openpyxl` 没装

```bash
pip install -r requirements.txt
# 或
pip install openpyxl>=3.1.0
```