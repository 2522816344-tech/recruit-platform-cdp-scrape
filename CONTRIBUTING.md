# Contributing

感谢你愿意贡献。请先阅读本指南。

## 工作流程

1. Fork 仓库 → 新建分支（`feature/xxx` 或 `fix/xxx`）
2. 在 `tests/` 下为新增逻辑写测试
3. 运行完整测试套件（**这条命令是"提交 PR 前的强制自测"清单**）：

   ```bash
   # 1) 业务逻辑回归
   node tests/test_paths.js
   node tests/test_common.js
   python tests/test_xlsx.py

   # 2) 发布卫生（隐私硬编码 / 必备文件 / .gitignore / 调试残留）
   python scripts/check_repo.py

   # 3) 分发卫生（验证 zip 剔除清单不回归）
   node tests/test_pack_for_share.js
   ```

   **三项全绿才能进下一步**。任何一项失败都先修，不要 `--no-verify`。

4. **手动验证一次打包**：跑一次 `node scripts/pack_for_share.js`，打开生成的 zip 抽查：
   - `data/` / `chrome-profile/` / `*.jsonl` / `*.xlsx` 均不在内
   - `SKILL.md` / `scripts/` / `docs/` / `.github/` / `.env.example` 都在
5. 提交 PR，在说明里写清楚：
   - 改了什么 / 为什么改
   - 影响哪些平台（liepin / job51 / zhilian / boss）
   - 是否涉及风控边界（节奏、验证码、重试）
   - 兼容性：Win / macOS / Linux 是否都验证过

## 代码规范

- Node 22+：只用内置能力，**禁止引入 npm 依赖**
- Python：只用 `openpyxl`，不要引入额外的库
- 不要硬编码任何本地路径（必须走 `paths.js` 或环境变量）
- 不要写 `console.log` 调试残留（用文件日志或 `--verbose` 标志）
- 新增平台字段时同步更新 `scripts/build_xlsx.py` 的列定义

## 安全与隐私
- **不要**提交包含真实姓名、公司名单、Cookie、Token 的文件
- `data/`、`chrome-profile/`、`.env` 已在 `.gitignore` 内，但请主动确认
- 涉及登录态的 PR，请在描述里写明「已在本地验证，不含真实凭证」
- **分发 zip 给朋友**：必须用 `node scripts/pack_for_share.js` 生成，**不要**直接 `Compress-Archive` 整个目录——`.gitignore` 对 zip 工具不生效，主动剔除脚本才是可靠护栏

## 不接受的内容
- 任何绕过验证码 / 风控 / DRM 的实现
- 任何批量注册 / 暴力破解 / 撞库的实现
- 任何用于商业用途的功能（项目声明是个人使用）

## 行为准则

请遵循 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 版本号

遵循 SemVer：

| 级别 | 触发条件 |
|---|---|
| MAJOR | 破坏性变更（输出格式、配置文件结构、命令行参数） |
| MINOR | 新增平台 / 新增字段 / 新增功能 |
| PATCH | 修复 bug / 文案修正 / 内部重构 |