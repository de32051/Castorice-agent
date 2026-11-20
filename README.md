# 星穹铁道：遐蝶 DSH 专属智能体预设

把《崩坏：星穹铁道》的**遐蝶**做成一个能长期相处的 DSH 智能体：一个只聊天的模式，一个能干活的模式，外加 84 万字的本地剧情库。

---

## 这是什么

不是微调模型，也不是提示词包 —— 而是一个 **DSH 预设组合包（bundle）**。装上之后，你的「新建对话」里会多出两个模式：

| 模式 | 预设 id | 定位 | 给她什么 |
| --- | --- | --- | --- |
| **遐蝶-聊天** | `xiadie-chat` | 沉浸式角色扮演，纯文字 | 内联人设 + 风格硬限制 + 本地剧情库检索 + 一层工具闸门（对话、联网、上下文压缩、插件市场查询、运行时内省、影音分析） |
| **遐蝶-工作** | `xiadie-work` | 同一个角色，换成干活的脑子 | 精简人设 + 完整工具面：文件读写与检索、Shell、后台任务、Skills、Plan / Goal / Todo、子代理（含 Codex / Claude Code 委派）、Workflow、交付物 |

两个模式共用同一份「影音材料」说明，所以工作模式同样能看视频、听音频、转码剪辑。

---

## 两种模式分别能干什么

### 遐蝶-聊天（`xiadie-chat`）

- **只说话，不动你的电脑。** 工具面被两层闸门收窄：`tools.restrict` 决定她**看得见**什么，`tools.guard` 在执行期**硬拦**白名单外的调用 —— 所以就算某个插件偷偷注册了新工具，她也调不动。
- **能做的**：联网搜索 / 抓网页、读你贴的链接、分析你给的视频音频（抽帧看画面、转录音、量节拍和调性）、用 ffmpeg 转码剪辑、压缩上下文、查插件市场（只查不装）。
- **不能做的**：读写任意文件、跑命令、开子代理、装/卸插件。
- **每轮自动挂资料**：中文双字切词 + BM25，从 `data/lore_full.md` 里挑最相关的几段塞在这轮消息后面。纯本地、零依赖、不联网、不建向量库。
- **风格被按住**：50–150 字、不排版、不用 Markdown、不写客服话、不做总结陈词、动作最多一两笔。

### 遐蝶-工作（`xiadie-work`）

- **完整工具面**，和标准预设基本一致：`tool-fs` / `tool-fs-search` / `tool-bash` / `tool-pwsh` / `tool-jobs` / `tool-skill` / `plan-mode` / `tool-goal` / `tool-todo` / `delegation`（`tool-subagent`、`tool-subagent-fork`、Codex、Claude Code）/ `tool-workflow` / `tool-ralph` / `present` / `tool-web` / 影音全套。
- **人设换成执行版**：`presets/work-prompt.md` —— 还是遐蝶的语气和底线，但不再受聊天那套篇幅限制约束，该列清单列清单、该写代码写代码。
- **刻意不挂** lore 检索和闸门：工作模式省 token，也要完整的工具面，不需要收窄白名单。

### 两个模式都能用到的宿主能力

装了这个包，她还能顺手用上你 profile 里已经有的宿主插件 —— 只要那些工具在聊天白名单里：

| 能力 | 来自哪个插件 | 聊天 | 工作 |
| --- | --- | --- | --- |
| 看视频（抽帧 / 分镜 / 硬字幕 / 定点放大 / 按台词定位） | `dsh-video-storyboard` | ✅ | ✅ |
| 听音频（转录、节拍、调性、和弦、段落、旋律） | `dsh-cixisound` | ✅ | ✅ |
| 转码 / 剪辑 / 抽帧 / 变速 / GIF / 烧字幕 | `dsh-ffmpeg` | ✅ | ✅ |
| 上下文压缩 | DSH 内置（装了 `billion-context` 就由它接管） | ✅ | ✅ |
| 联网搜索 / 抓网页 | `@deepseek-ai/dsh-tool-web` | ✅ | ✅ |
| 插件市场查询（只读） | `dsh-m` | ✅ | ✅ |
| 文件、终端、子代理、Workflow | DSH 内置 | ❌ | ✅ |

> 那三个影音插件是**可选依赖**：没装也不会报错，只是 `video_*` / `sound_*` / `ffmpeg_*` 这些名字自然不存在。

---

## 安装

**前置**：DSH Desktop 0.2.x（由 `@deepseek-ai/dsh-agent-preset` 提供预设行）。CLI 版同样可用。

**不需要额外装什么**：两个预设里没有写 `inject`，装完就能出现在模式列表里。上下文压缩走宿主自带的 `compaction`；如果你 profile 里装了 `billion-context`，它的 `bili-compaction-gate` 会用全局钩子把预设内的 `compaction-basic` 关掉、改由自己接管 —— 两种情况都不需要你手动配。

> 反过来说，这也是为什么本包**不**注入 `biliBasicCompactionPolicy`：那个服务只有 `billion-context` 提供，而 `inject` 是必需依赖 —— 缺了它预设会一直 pending，表现为「装好了却在模式列表里找不到遐蝶」。

### 方式一：插件页（Desktop 推荐）

1. 打开侧边栏 **插件** → **安装**；
2. 填 GitHub 地址（下面两种写法等价，把 `你的名字` 换成你的 GitHub 用户名）：

   ```
   github:你的名字/Castorice-agent
   ```

   ```
   https://github.com/你的名字/Castorice-agent
   ```

3. 安装完成后**完全退出并重开 Desktop**（只关窗口是隐藏，进程还在 —— 必要时在任务管理器里确认 `DeepSeek Harness` 已结束）；
4. 重开后新建对话，模式里就能选到 **遐蝶-聊天** / **遐蝶-工作**。

### 方式二：命令行

`dsh` 在 PATH 上时：

```bash
dsh plugin add github:你的名字/Castorice-agent
```

子命令与参数以你本机 `dsh plugin --help` 为准。

### ⚠️ 装之前请先卸掉旧包

如果你之前装过 id 同为 `xiadie-chat` 的旧 bundle，请先在插件页卸载 —— 两个包会注册同一个预设 id，后装的会被前一个挡住。

### 可选依赖（想要影音能力再装）

```bash
dsh plugin add dsh-video-storyboard
dsh plugin add dsh-ffmpeg
dsh plugin add dsh-cixisound
```

`dsh-cixisound` 首次调用会自己装 Python 依赖：本机已有 `torch` 就借用（约 110 MB），没有则拉一份独立环境（约 7 GB）。

### 装完看不到「遐蝶-聊天 / 遐蝶-工作」？

按这个顺序排：

1. **有没有真的重启**：Desktop 关窗口只是隐藏，要完整退出（任务管理器里 `DeepSeek Harness` 不再有进程）再打开。
2. **插件页里有没有这个包**：没出现就是安装没成功，看插件页的报错（git 地址写错、`git ls-remote` 超时、包里 `package.json` 的 `dsh.bundle.patch` 路径不对）。
3. **有没有同 id 的旧包**：`xiadie-chat` / `xiadie-work` 这两个 id 全局唯一，旧 bundle 还在就会挡住新的。
4. **看启动日志**：预设挂载失败通常会在日志里留一行 `pending`（等一个永远不来的服务）。本包不依赖任何第三方服务，正常不会出现这条。

---

## 使用

- **新建对话** → 选模式。选 `遐蝶-聊天` 是第一人称沉浸扮演，选 `遐蝶-工作` 是同一个角色替你干活。
- **聊天模式第一轮会慢 1–2 秒**：她在后台给 84 万字语料建索引（一次性，之后常驻内存）。
- **想让她看视频**：把文件拖进对话，或者直接发路径 `@C:\...\xxx.mp4 能看得到吗`。她会先 `video_probe` 看元信息，再 `sound_read` 一次拿转录+节拍+调性，然后 `video_storyboard` 出分镜图。**不会假装看见** —— 读不到会直说。
- **想让她更黏人 / 更克制 / 换个说话方式**：改 `presets/chat-prompt.md`（人设）或 `presets/chat-style-limits.md`（篇幅与格式红线），然后重建（见下）。
- **清空记忆**：预设本身不带记忆，记忆在会话里，新建对话就是干净的一次。

---

## 目录结构

```
Castorice-agent/
├── package.json                 # name / version / dsh.bundle.patch
├── cordis.patch.yml             # 生成物：两个预设的完整挂载（含内联人设）
├── presets/
│   ├── chat-prompt.md           # 聊天人设（第一人称，含【互动拉扯与情感反馈】等区块）
│   ├── chat-style-limits.md     # 聊天风格硬限制（优先级最高，压 AI 味）
│   ├── work-prompt.md           # 工作模式人设（执行版）
│   ├── work-tools.yml           # 工作模式工具集（244 行，原样嵌进 YAML）
│   └── media-tools.md           # 影音材料说明（两个模式共用）
├── data/
│   └── lore_full.md             # 剧情与官方资料（880,576 字符）
├── lib/
│   ├── lore.js                  # 本地检索插件：中文 bigram + BM25
│   └── guard.js                 # 工具闸门插件：restrict + guard 双层
└── scripts/
    ├── build.mjs                # 从 presets/ 生成 cordis.patch.yml（逐字节往返校验）
    └── validate.mjs             # 安装前自检：块标量、重复 id、路径残留
```

---

## 自定义与再生成

人设正文是**内联**在 `cordis.patch.yml` 里的（不自带任何通用文件读取），所以改完 md 必须重建：

```bash
node scripts/build.mjs      # 重新生成 cordis.patch.yml
node scripts/validate.mjs   # 自检：内联正文与源文件是否逐字一致
```

`build.mjs` 会把每段正文缩进 16 格塞进 YAML 字面块，写完立刻读回来比对 —— 不一致直接抛错，不会留下半坏的配置文件。

语料路径的解析顺序：

1. 预设配置里的 `lorePath`（相对路径按**包根目录**解析）；
2. 环境变量 `XIADIE_LORE_PATH`；
3. 默认 `data/lore_full.md`。

也就是说整包可以随便搬家、可以挂到任何 profile，不用改代码。

---

## 数据来源与已知限制

- 语料 `data/lore_full.md`：抓自 bilibili wiki「遐蝶/资料」，50 个子页面、880,576 字符（2.1 MB），抓取时间 2026-11-19。含主线与活动剧情全文、角色对话、光锥文本、考据。
- 检索是 **BM25 + 中文双字切词**，不是向量检索：命中靠字面，同义改写会漏；每轮最多注入 3 段 / 2200 字，宁可少给不硬塞。
- 人设是「提示词级」的，不是微调：极端提问下仍可能出戏，`chat-style-limits.md` 就是拿来兜这个的。
- `cordis.patch.yml` 里的预设 id 固定为 `xiadie-chat` / `xiadie-work`，同时装两个来源相同的包会冲突。
- Desktop 的「重启」是完整退出再打开，`dsh-m` 的重启命令对 desktop profile 无效。

---

## 版权与免责

- 角色、剧情、台词、光锥文本版权归 **米哈游（miHoYo）** 所有；本项目与米哈游、HoYoverse 无任何关联。
- 仓库里的代码（`lib/`、`scripts/`、`cordis.patch.yml` 模板）以 MIT 授权；**`data/lore_full.md` 不在 MIT 授权范围内**，它是从公开 wiki 整理的剧情文本，仅供学习与个人研究使用，**禁止商业用途**。
- 如果你打算把本仓库公开，请自行评估语料的版权风险：更稳妥的做法是仓库里只放脚本、不放全文，让使用者自己导入（把文件放到 `data/lore_full.md` 即可，路径已支持）。若权利人提出要求，应删除相关内容。

---

## 致谢

- 剧情与资料：[bilibili wiki · 遐蝶](https://wiki.biligame.com/sr/%E9%81%90%E8%9D%B6)
- 宿主：DeepSeek Harness（DSH）
- 影音三件套：`dsh-video-storyboard`、`dsh-cixisound`、`dsh-ffmpeg`
