# AGY Worker for Codex

简体中文 · [English](README.md)

把范围明确、可以独立验收的编程杂活从 Codex 委派给 Google 官方 Antigravity CLI，完成后再由 Codex 检查实际文件、运行测试并交付结果。

这个项目由一个 Codex Skill 和一个确定性的 PowerShell 包装脚本组成。它**不是** OpenAI 兼容反向代理，也不会把 Gemini 添加到 Codex 的模型选择器中。

## V2.2：统一入口，统计不自嗨

现在用 `node scripts/agy-worker.mjs` 加 `prepare`、`run`、`retry`、`state`、`review` 或 `stats` 即可。旧脚本继续兼容，不额外安装全局命令或依赖，也不需要重新登录。只有 `run` 会启动 Gemini；`retry` 只是生成契约，`review --verdict retry` 只是记录决定，都不会自动执行重试。

```powershell
node scripts/agy-worker.mjs --help
node scripts/agy-worker.mjs stats --since 2026-09-01 --task-type documentation
```

统计直接读取现有本地遥测，分开显示机器检查结果、Codex 审核结果、审核覆盖情况、耗时、已报告的 token 样本和重试次数。缺数据就是未知，不按零处理。V2.2 执行记录增加回执哈希，审核记录必须匹配；旧记录缺少哈希则单列，不混进已核对的通过率。报告不打印 prompt、审稿备注或任务标识，不改设置，也不瞎算省了多少钱、多少 GPT token。筛选口径、重复/冲突处理和 32 MiB 读取上限详见[统一入口与统计说明](references/usage-and-stats.md)。

默认仍为 Flash High，权限和一次重试上限不变，Windows 进程监管也保持原链路。新增测试命令 `node --test scripts/test-v22.mjs`，与已有测试一起运行。

## V2.1 基础：故障说清楚，重试少填表

Runner 2.1 保留 `v1` 契约和 V2 执行协调。精简回执增加故障阶段、原因码、下一步建议和分段耗时，区分预检、worker、验收与文件核验的问题。完整预检日志和契约快照保存在本地 attempt 目录，不把原始长输出回灌给 Codex。登录或模型问题若来自错误文本匹配，只是诊断线索，不是假装拿到了上游的确定错误类型。

文稿或代码存在语义问题时，先把具体纠正意见存成 UTF-8 文本，再生成同范围重试契约：

```powershell
node scripts/prepare-retry.mjs --receipt "C:/tasks/attempt/receipt.json" --feedback-file "C:/tasks/correction.txt" --out "C:/tasks/retry.json"
```

Codex 检查生成结果后，再交给原来的契约 runner 执行。助手保留模型、权限、范围、超时和验收命令；生成阶段不调用 Gemini，也不占用或预留重试名额。缺少 V2.1 快照、名额耗尽、登录/环境/模型故障及覆盖已有输出都会被拒绝。真正执行时仍检查一次重试上限，不增加自动修登录、改代理、换模型或浏览器委托。详见[诊断与重试说明](references/contract-runner.md#v21-diagnostics-and-retry-preparation)。新增测试命令为 `node --test scripts/test-v21.mjs`，与 V2、回归和加固测试一起运行。

## V2 基础：少写参数，补齐执行协调

Runner 升级为 2.0，但仍兼容 `version: "v1"` 契约。新任务可用 `scripts/prepare-task.mjs` 把简短 JSON 任务说明展开为完整契约，不调用 Gemini、不改项目设置、不覆盖已有契约。[SKILL.md](SKILL.md) 提供示例，[完整契约参考](references/contract-runner.md) 保留高级参数。

- 不自动扩大权限：项目写入仍需显式 `allowed_files`，目录或 glob 范围必须明确 `max_changed_files`。
- 共享 Git common directory 的托管任务互斥执行，包括子目录和关联 worktree。忙时立即报错，不排队；旧包装器/直接调用 CLI 不参与锁。
- 每个原始 attempt 只有一个持久重试名额。复制或反复引用旧回执不能再次重试。发起调用后中断也占用名额；本地预检失败不占用。
- V2 重试也绑定执行模式。旧完整契约仍能运行，但旧回执缺少模式证据，不能直接用于精确重试；须由 Codex 先审查结果，再决定是否启动新的独立任务。
- `node scripts/task-state.mjs --workspace <路径>` 查看锁信息和历史重试占用数，不调用模型。
- 状态位于 `~/.config/agy-worker/state`。测试可用 `AGY_STATE_DIR` 隔离，但正常使用不应反复切换，且必须放在仓库外。中断留下的锁需确认相关 worker 已停止后，才能删除那个锁文件，不自动抢占。

这是本 runner 的正确性保护，不是沙箱或调度平台。V2 不增加浏览器委托、自动 Git 操作、并行执行、自动修登录，也不改变默认模型或权限。托管 runner 仍仅支持 Windows。除原有测试外，新增 `node --test scripts/test-v2.mjs`。skill 首页缩短，旧契约和审稿命令继续兼容。

## 为什么做这个项目

不少编码任务并不需要主 Agent 全程亲自处理，例如机械性修改、测试脚手架、文档整理、窄范围代码搜索和小型迁移。AGY Worker 让 Codex 继续担任负责人，同时把这些工作交给 Antigravity 中可用的模型执行。

```text
你 → Codex → $agy-worker → 官方 agy CLI → Gemini/Antigravity
                         ← JSON 结果和工作区修改 ←
      Codex 检查 diff、运行测试，并只汇报经过验证的结果
```

关键不是“多调用一个模型”，而是保留验收边界：Antigravity 的文字总结不能直接作为最终交付，Codex 必须检查真实文件和测试结果。

## 功能特点

- 调用官方 `agy` CLI，使用其已缓存的 Google 登录状态。
- 默认使用 `gemini-3.8-flash-high`，也可选择 `agy models` 返回的其他模型 slug。
- 提供版本化任务契约 runner，机器检查文件范围、独立运行验收命令、按 attempt 保存证据，并输出紧凑回执和 review telemetry。
- 支持可编辑模式和只读规划模式。
- 返回机器可读 JSON；`agy` 非零退出时抛出清晰的 PowerShell 异常，但不会用 `exit` 终止调用方的宿主进程。
- 支持使用 `conversation_id` 精确续接任务。
- 分离 stdout JSON 与 stderr 诊断、权限提示。
- 终端没有代理变量时，可自动继承 Windows 当前手动代理。
- Antigravity 插件钩子需要 `node`、但宿主 PATH 未包含它时，会自动查找常见 Windows Node.js 安装并临时加入子进程 PATH。
- 支持显式代理、自定义 `agy` 路径、沙箱和 reasoning effort。
- 这套个人 worker 流程默认开放 Antigravity 全工具权限；可用 `-RestrictTools` 恢复审批限制。
- GitHub Actions 同时校验 Windows PowerShell 5.1 与 PowerShell 7。

## 已测试环境

- Windows 11
- Antigravity CLI 1.1.27（2026-09-08 真实契约冒烟）
- Codex 桌面端/CLI 的 Skill 发现机制
- `gemini-3.8-flash-high`
- Windows PowerShell 5.1 与 PowerShell 7 语法

受管理的任务 runner 需要 Windows Job Objects、Node.js 和 PowerShell。其他平台可以在安装 `pwsh` 后使用旧版自由 prompt 包装器，但没有进程树管理保证，CI 也未覆盖这些平台。

## 前置条件

- 支持本地 Skills 的 Codex 桌面端、Codex CLI 或 Codex IDE 扩展。
- Google 官方 Antigravity CLI。
- Google 账号，或 `agy` 支持的其他认证方式。
- Windows PowerShell 5.1+；其他平台需要 PowerShell 7（`pwsh`）。

可用模型和配额取决于登录的 Antigravity 账号。本项目不提供、不转发、也不销售任何模型访问权限。

## 一、安装并登录 `agy`

Windows 推荐使用官方 WinGet 包：

```powershell
winget install --exact --id Google.AntigravityCLI
```

如果刚安装后找不到 `agy`，重启终端，然后进入首次启动流程：

```powershell
agy
```

完成 Google 登录；服务条款和交互数据共享选项必须由你本人确认；只信任确实希望 Antigravity 访问的工作区。

确认登录状态，并查看当前账号真正可用的模型 slug：

```powershell
agy --version
agy models
```

其他安装方式请参考 [Antigravity CLI 官方安装文档](https://antigravity.google/docs/cli/install/)。

## 二、必要时配置代理

如果浏览器可以访问 Google，但 `agy` 报 `token exchange failed` 或 Token 端点超时，通常是终端没有使用浏览器的代理。

包装脚本按照以下优先级选择代理：

1. 调用时传入的 `-ProxyUrl`；
2. 当前进程已有的 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY`；
3. Windows Internet Settings 中启用的手动代理；
4. 直接连接。

只给本次调用指定代理：

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -ProxyUrl "http://127.0.0.1:7897" `
  -Prompt "只回复 OK"
```

也可以自行设置当前终端：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7897"
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:ALL_PROXY = "http://127.0.0.1:7897"
```

传入 `-NoSystemProxy` 可以禁止脚本读取 Windows 手动代理。脚本不会解析 PAC 文件；使用 PAC 的环境应显式传入 `-ProxyUrl` 或设置环境变量。

自动注入的代理只在 `agy` 子进程调用期间生效，不会修改用户级或系统级终端环境。

## 三、安装 Codex Skill

### 使用 Codex Skill Installer

直接告诉 Codex：

```text
使用 $skill-installer 安装 https://github.com/hqc135/agy-worker
```

### 手动安装

克隆到个人 Skills 目录：

```powershell
New-Item -ItemType Directory -Force "$HOME/.agents/skills" | Out-Null
git clone https://github.com/hqc135/agy-worker "$HOME/.agents/skills/agy-worker"
```

不要覆盖已有且包含未提交修改的目录。Codex 通常会自动发现新 Skill；如果 `$agy-worker` 没出现，重启 Codex。

也可以只在某个仓库中安装：

```powershell
git clone https://github.com/hqc135/agy-worker ".agents/skills/agy-worker"
```

## 四、在 Codex 中使用

显式调用最可控：

```text
使用 $agy-worker 给解析器补充针对性单元测试。只允许修改 tests/parser，
不要提交 Git；完成后由你自己检查 diff 并运行相关测试。
```

也支持自然语言隐式匹配：

```text
把这批机械性文档整理交给 agy，完成后你逐个检查修改文件。
```

适合的任务：

- 验收标准明确的机械重构；
- 给单个模块搭建单元测试；
- 整理文档、注释、类型和命名；
- 变更范围清楚的小型迁移；
- 使用 `plan` 模式进行窄范围仓库调查。

不适合的任务：

- 生产环境操作或破坏性清理；
- 密钥、凭据、令牌和敏感个人数据；
- 最终安全或合规判断；
- 大规模架构改造；
- 无法在本地测试或复查的修改；
- 多个 Agent 同时修改相同文件。
- 浏览器或网站操作：一次本地测试在协助配置后成功，后一次耗时 190 秒且未能取得浏览器工具，因此本项目把这类任务保留给 Codex；这不是对 Gemini 浏览器能力的通用评测结论。

## 推荐用法：V1 任务契约 runner

自由 prompt 包装器仍然保留，但日常委托建议统一使用 `scripts/invoke-agy-task.mjs`。契约会把范围和验收条件写死，并只把小型回执交回 Codex，避免把 Gemini 的完整长输出灌进主上下文。

```json
{
  "version": "v1",
  "task_id": "parser-tests-001",
  "task_type": "test_generation",
  "goal": "为空输入和错误格式补充解析器测试",
  "workspace": "C:/path/to/project",
  "allowed_files": ["tests/parser.test.ts"],
  "read_scope": ["src/parser.ts", "tests/parser.test.ts"],
  "acceptance_commands": [
    {
      "executable": "npm",
      "args": ["test", "--", "tests/parser.test.ts"],
      "timeout": "5m"
    }
  ],
  "forbidden_actions": ["修改 allowed_files 以外的文件"],
  "max_changed_files": 1,
  "artifact_dir": "C:/path/to/project/.agy-artifacts/parser-tests-001",
  "return_mode": "compact",
  "model": "gemini-3.8-flash-high",
  "mode": "accept-edits"
}
```

从 Codex 或终端执行：

```powershell
node "$HOME/.agents/skills/agy-worker/scripts/invoke-agy-task.mjs" `
  --contract "C:/path/to/contract.json"
```

支持 `implementation`、`test_generation`、`mechanical_edit`、`documentation` 和 `investigation` 五种任务类型。浏览器任务会被明确拒绝。

runner 会：

- 为 tracked 文件（含 assume-unchanged/skip-worktree）、可见改动和 ignored 文件计算哈希，在验收前及每条命令后检查；
- 拒绝越界改动、超出文件数量上限、Git 历史变化和验收失败；
- 遇到预先存在的脏文件、快照不完整等歧义状态时降级为 `NEEDS_REVIEW`；
- 把原始输出、命令日志、manifest 和完整 receipt 存到独立 `attempt-*` 目录；
- 单独检测旧 attempt 和 `latest.json` 是否被改动，再由 runner 更新最新指针；
- stdout 只输出不超过 16 KiB 的紧凑 JSON 回执；
- 使用 `conversation_id` 和 `retry_of`（上次 receipt 路径）精确重试一次，保持范围、模型、权限和验收条件一致。

`allowed_files` 会被机器检查，但 `read_scope` 和自由文本 `forbidden_actions` 仍是提示词约束，不是操作系统沙箱。Codex 仍需检查 diff 并做语义验收。

验收后记录结果：

```powershell
node "$HOME/.agents/skills/agy-worker/scripts/record-review.mjs" `
  --receipt "C:/path/to/current-attempt/receipt.json" `
  --verdict pass `
  --notes "已检查 diff 并通过针对性测试"
```

verdict 可选 `pass`、`retry` 或 `takeover`。

## 1.2 / 1.3：验收加固与委托效率

契约协议仍使用 `version: "v1"`，回执通过 `runner_version: "1.3.0"` 标明实现版本。

新增可选契约字段：

| 字段 | 用途 |
|---|---|
| `required_artifacts` | 本次 attempt 内必须存在的普通文件，例如 `["draft.md"]`，且必须列在 worker manifest 中。 |
| `task_details` | 读者、语气、来源事实、变换示例或测试行为，最多 12,000 字符。 |
| `restrict_tools` | 设为 `true` 时传入 `-RestrictTools`；默认仍开放全工具权限。 |
| `retry_of` | 上次 receipt 路径，须与 `conversation_id` 同时填写，最多同范围重试一次。 |

runner 会把 `references/task-templates.json` 中对应任务的轻量模板加入提示词。遇到环境、登录或模型错误，Gemini 应及时返回 blocked，由 Codex 处理；同一重试链不再重试此类错误，普通任务的第二次重试也会在调用模型前被拒绝。

调用前检查仅检查本地 CLI 和已配置代理端点是否可达。CLI 版本按可执行文件路径、大小和修改时间缓存 24 小时。它不会额外请求模型列表，也不表示登录已经确认；账号和模型访问由真正的 worker 调用验证。

worker 的范围和产物检查通过后才执行测试。每条验收命令后再次检查，若出现越界，后续命令跳过。旧 attempt 单独检查，manifest 产物需核验并计算哈希，因此只有总结却没有文稿的任务不会通过。子模块、链接/junction、硬链接、无法读取的文件或超出快照上限会阻止确定性通过。tracked 快照上限为 50,000 项 / 256 MiB，历史证据为 10,000 文件 / 256 MiB。

每次受管理的调用放在 Windows Job Object 内。超时或监督进程退出会结束包括 detached 子进程在内的后代进程；本次调用前就已运行的外部服务不在这棵进程树里。这是进程生命周期管理，不是文件系统或网络沙箱。

退出码：`0` 表示 `READY_FOR_REVIEW`，`2` 表示 `NEEDS_REVIEW`，`3` 表示 `REJECTED`，`1` 表示 runner / 契约错误。调用方即使看到非零退出码，也应读取 JSON 回执。退出码 0 仍需要 Codex 做语义验收。

review 命令现在必须传入 `--receipt`，记录具体 attempt ID 与 receipt 哈希；标记 `pass` 前会复查变更文件和产物是否仍与回执哈希一致。不含哈希的旧 receipt 需要重新运行，仅 task ID 的 review 不再接受。

`allowed_files`、快照和回执属于可观察状态检查，不是抵御同权限恶意进程的安全边界。检查前被还原的临时改动、检查仓库以外的写入，以及外部副作用，都不能由这些门禁证明没有发生。

## 直接调用包装脚本

普通编辑任务：

```powershell
$prompt = @'
只允许修改 src/parser.ts 和 tests/parser.test.ts。
为输入为空和格式错误的情况补充测试。
不要 commit、push、安装全局软件或修改无关文件。
最后列出修改文件、运行过的测试和剩余不确定性。
'@

& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -Workspace (Get-Location).Path `
  -Prompt $prompt
```

只读调查：

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -Workspace (Get-Location).Path `
  -Mode plan `
  -Prompt "找出重试退避策略在哪里配置，不要修改文件。"
```

换模型并延长超时：

```powershell
agy models

& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -Model "gemini-3.8-flash-high" `
  -Effort high `
  -Timeout 30m `
  -Prompt $prompt
```

精确续接同一个任务：

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -ConversationId "<首次调用返回的 conversation_id>" `
  -Prompt "只处理失败的边界测试，并汇报具体修改。"
```

如果续接请求返回了不同的 `conversation_id`，包装脚本会拒绝该结果。

## 参数说明

| 参数 | 默认值 | 用途 |
|---|---:|---|
| `-Prompt` | 必填 | 发送给 Antigravity 的任务。 |
| `-Workspace` | 当前目录 | 工作目录和 `--add-dir` 范围。 |
| `-Model` | `gemini-3.8-flash-high` | `agy models` 中的精确 slug。 |
| `-Mode` | `accept-edits` | `accept-edits` 或 `plan`。 |
| `-Effort` | 未设置 | 可选 `low`、`medium` 或 `high`。 |
| `-Timeout` | `15m` | Go 风格时长，例如 `90s`、`15m`、`1h30m`。 |
| `-ConversationId` | 未设置 | 精确续接一个会话。 |
| `-AgyPath` | 自动检测 | 官方 CLI 可执行文件路径。 |
| `-ProxyUrl` | 自动检测 | 只对本次子进程生效的 HTTP/HTTPS 代理。 |
| `-NoSystemProxy` | 关闭 | 禁止读取 Windows 手动代理。 |
| `-Sandbox` | 关闭 | 启用 Antigravity 终端沙箱限制。 |
| `-RestrictTools` | 关闭 | 禁用默认的 `--dangerously-skip-permissions`。 |
| `-AllowAllTools` | 兼容参数 | 为旧调用方保留；现在默认已经开放全工具权限。 |

## 权限配置

这套个人 worker 配置默认传入 `--dangerously-skip-permissions`。只应在可信工作区中配合范围严格的契约使用；面对敏感或陌生代码时传入 `-RestrictTools`。Antigravity 也支持在 `~/.gemini/antigravity-cli/settings.json` 中配置窄范围权限：

```json
{
  "permissions": {
    "allow": [
      "command(git)",
      "command(npm run (build|lint|test))",
      "write_file(src/)"
    ]
  }
}
```

显式使用受限模式：

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -RestrictTools `
  -Prompt $prompt
```

调整权限策略前请阅读 [官方 Headless 文档](https://antigravity.google/docs/cli/headless/) 和 [权限文档](https://antigravity.google/docs/cli/permissions/)。

## 输出约定

包装脚本向 stdout 输出一个 JSON 对象，进度、诊断和权限提示保留在 stderr：

```json
{
  "conversation_id": "178d54e6-2a79-4447-be44-0a83d7d30760",
  "status": "SUCCESS",
  "response": "AGY_OK\n",
  "duration_seconds": 2.2,
  "num_turns": 1,
  "usage": {
    "input_tokens": 17601,
    "output_tokens": 34,
    "thinking_tokens": 30,
    "cache_read_tokens": 0,
    "total_tokens": 17635
  }
}
```

`response` 不能证明代码已经正确修改。主 Agent 仍需检查工作区、diff、构建和测试。

## 常见问题

### `Please sign in to view available models`

先交互式运行一次 `agy` 并完成认证。

### `token exchange failed` 或 Google 端点超时

确认本地代理端口正在监听，然后使用 `-ProxyUrl` 或设置三个代理环境变量。浏览器使用代理不代表所有 CLI 会自动继承。

### 模型不存在或退出码非零

运行 `agy models`，复制当前账号可用的精确 slug。Headless 模式遇到未知模型时会直接失败，不会静默换模型。

### 命令被软拒绝

可以让 Codex 自己运行验收命令、增加窄范围 Antigravity 权限规则，或对本次调用显式授权 `-AllowAllTools`。

### 所有文件工具都因 `PreToolUse` 钩子找不到 `node` 而失败

包装脚本现在会查找常见的 Windows Node.js 安装，并只在子进程期间临时补入 PATH。如果失败钩子来自你不用的 Antigravity/Gemini 插件，应在该插件自己的配置中禁用或卸载它，而不是开启不受限工具权限。这个错误与所选 Gemini 模型无关。

### 状态是 `SUCCESS`，但 response 为空

先检查实际文件变化，再决定是否失败。最多用更小的提示词重试一次，不要无限重试。

### Codex 找不到 `$agy-worker`

确认 `SKILL.md` 位于 `$HOME/.agents/skills/agy-worker` 的直接下级，然后重启 Codex。Codex 官方 Skills 文档列出了用户级和仓库级发现路径。

## 验证与开发

静态校验不需要 Antigravity 账号：

```powershell
./tests/test-static.ps1
```

任务契约 runner 还带有确定性回归测试：

```powershell
node ./scripts/test-regression.mjs
node ./scripts/test-hardening.mjs
```

在线冒烟测试会使用已登录账号发出一次模型请求，但不会修改文件：

```powershell
./tests/test-live.ps1
```

GitHub Actions 会在 Windows PowerShell 5.1 和 PowerShell 7 下执行静态校验，再运行回归与加固测试。加固测试覆盖跳过危险验收、隐藏 tracked 改动、历史证据、产物、过期 review、重试上限，以及超时子进程的延迟写入。

## 更新与卸载

如果通过 Git 安装：

```powershell
git -C "$HOME/.agents/skills/agy-worker" pull --ff-only
```

卸载时，请在核对路径后仅删除特定的 `agy-worker` Skill 目录。删除 Skill 不会卸载 `agy`，也不会清除 Antigravity 登录凭据。

## 安全与隐私

- 提示词和 Antigravity 读取的文件受 Google 对应条款及账号设置约束。
- 不要委派密钥、令牌或敏感生产数据。
- 接受模型修改前必须进行代码审查。
- 当前默认开放全工具权限。请使用可信工作区和明确范围；需要审批限制时用契约的 `restrict_tools: true` 或旧包装器的 `-RestrictTools`。
- 本 Skill 不读取、保存或发布 Antigravity 凭据。

## 许可证与商标

项目采用 MIT 许可证。本项目与 Google 或 OpenAI 没有隶属、赞助或背书关系。Antigravity、Gemini、Codex、Google 和 OpenAI 均为各自权利人的商标。
