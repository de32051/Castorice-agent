#!/usr/bin/env node
/**
 * build.mjs —— 生成 dsh-xiadie-agent 的 cordis.patch.yml。
 *
 * 人设正文不能靠手抄：十几 KB 的中文原文，抄一遍就可能错字、漏行、串行。
 * 所以这里把「patch 模板」放在脚本里，运行时把
 *   presets/chat-prompt.md
 * 的正文原样缩进 16 格嵌进 persona.prefix（YAML `|` 字面块），写完再读回来做
 * 逐字节往返校验 —— 校验不过直接抛错，不会留下错文件。
 *
 * 人设之后紧接 presets/chat-style-limits.md（对话风格与格式硬性限制）：它是系统提示词
 * 的最后一段，用来压 AI 味（篇幅、信息倾泻、括号动作、客服腔、总结收尾等）。
 * 两段连成一个 payload 内联进 prefix，同样做往返校验。
 *
 * 改了 presets/ 下任何一个 md 之后，都要重跑本脚本，生成的 cordis.patch.yml 才是新版本。
 *
 * 用法：node scripts/build.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 仓库根目录：scripts/ 的上一级。 */
const ROOT = join(HERE, '..')
const PERSONA_PATH = join(ROOT, 'presets', 'chat-prompt.md')
const STYLE_PATH = join(ROOT, 'presets', 'chat-style-limits.md')
const MEDIA_PATH = join(ROOT, 'presets', 'media-tools.md')
const WORK_PERSONA_PATH = join(ROOT, 'presets', 'work-prompt.md')
const TOOLSET_PATH = join(ROOT, 'presets', 'work-tools.yml')
const OUTPUT_PATH = join(ROOT, 'cordis.patch.yml')
const INDENT = ' '.repeat(16)
const PREFIX_LINE = `${INDENT.slice(2)}prefix: |`

const TEMPLATE = `# ----- 遐蝶-聊天 (id: xiadie-chat) -------------------------------------------
# 基于内置 standard 预设裁剪：工具清单照抄 standard 的写法，但把编码 / 文件 / 命令 /
# 子代理这一整类能力全部拿掉，只留「对话 + 联网搜索」。
#
# 人设正文内联在下面 persona.prefix 的 YAML 字面块里（由 build.mjs 从
#   presets/chat-prompt.md
# 原样嵌入并逐字节校验，不依赖运行时读盘）。
#
# 另外挂了这个 bundle 自带的两个插件：
#   dsh-xiadie-agent/lore  —— 本地资料检索：按中文双字切词 + BM25，每轮把最相关的几段
#                        附在阁下这轮消息之后（数据源 data/lore_full.md）
#   dsh-xiadie-agent/guard —— 工具闸门：restrict 收窄可见工具面，guard 在执行期硬拦截
#
# 关于 inject: [biliBasicCompactionPolicy] —— 这里**故意不写**。
# 那个标记服务由第三方插件 billion-context 的 bili-compaction-gate 提供，官方四个内置
# 预设注入它是为了让自带的 compaction 等 bili 的压缩管线先就位。但 inject 是「必需依赖」：
# 没装 billion-context 时服务永不出现，预设会一直 pending —— 表现就是「装好了却在模式
# 列表里找不到遐蝶」。本包对外发布，不能假设别人装了 bili。
# 装了 bili 的情况也不需要这行：bili-compaction-gate 用 global 的 internal/config 钩子
# 扫描包括本预设在内的所有插件行，把 compaction-basic 和 command-compact 关掉。
- insert:
    - id: preset-xiadie-chat
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: xiadie-chat
        name: '遐蝶-聊天'
        description: '遐蝶陪聊人设（崩坏：星穹铁道）：只有对话、联网搜索与上下文压缩，不读写文件、不执行命令；本地设定资料自动检索注入。'
        order: 7
        plugins:
          # dsh-persona 的 config 只有 prefix / suffix 两个纯文本字段，插件本身不读文件。
          # 不写 suffix：省略即空串，连 "Your working directory is …" 一起遮蔽；
          # 不写 complete: true —— 那会吞掉工具说明，联网搜索就用不了了。
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |
%%PERSONA%%
          # ── 本 bundle 自带：本地资料检索（需求 4）────────────────────────
          - id: xiadie-lore
            name: 'dsh-xiadie-agent/lore'
            config:
              lorePath: './data/lore_full.md'
              topK: 3
              maxChars: 2200
              minMatchedTokens: 2
          # ── 本 bundle 自带：纯聊天工具闸门（需求 3）──────────────────────
          # 放行「看和查」类插件工具，不放行通用文件工具：
          #   对话与联网   web_search / web_fetch / ask_user_question
          #   上下文压缩   compress / decompress / search_context / acp_status /
          #                acp_cache / acp_read_original_image（billion-context）
          #   插件市场查询 dshm_search / dshm_list / dshm_outdated（只读，不安装）
          #   运行时内省   cordis_inspect_list / cordis_inspect_query（只读）
          #   影音分析     video_*（看视频）/ sound_*（听音频）/
          #                ffmpeg_*（转码、剪辑、抽帧）—— 这些插件自己读写文件，
          #                不需要把 ops_fs / write / edit / bash 交给她
          # 仍然挡住：通用文件读写、终端命令、子代理、插件安装/卸载。
          - id: xiadie-guard
            name: 'dsh-xiadie-agent/guard'
            config:
              allow:
                - web_search
                - web_fetch
                - ask_user_question
                - compress
                - decompress
                - search_context
                - acp_status
                - acp_cache
                - acp_read_original_image
                - cordis_inspect_list
                - cordis_inspect_query
                - dshm_search
                - dshm_list
                - dshm_outdated
                - video_help
                - video_probe
                - video_storyboard
                - video_zoom
                - video_locate
                - video_subtitles
                - video_storyboard_settings
                - sound_read
                - sound_transcribe
                - sound_melody
                - sound_chords
                - sound_rhythm
                - sound_structure
                - ffmpeg_health
                - ffmpeg_probe
                - ffmpeg_cut
                - ffmpeg_concat
                - ffmpeg_encode
                - ffmpeg_adjust
                - ffmpeg_extract
                - ffmpeg_frames
                - ffmpeg_storyboard
                - ffmpeg_gif
                - ffmpeg_subtitle
          # ── 上下文压缩：长对话要靠它，不能省 ────────────────────────────
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
              toolResultPruner: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
              - id: tool-result-pruner
                name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
                config:
                  thresholdChars: 8192
                  headChars: 4096
                  tailChars: 1024
          # ── 保留：阁下一句话就能用上的两件事 ───────────────────────────
          - id: tool-web
            name: '@deepseek-ai/dsh-tool-web'
            config:
              fetch: true
              searchTimeoutMs: 60000
          - id: tool-ask-user
            name: '@deepseek-ai/dsh-tool-ask-user'
          # ── 以下一律不要（standard 里有，这里显式关掉并留档）─────────────
          # 读 AGENTS.md / 项目约定 —— 聊天模式不读任何文件
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            disabled: true
          # 终端
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            disabled: true
          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
            disabled: true
          # 文件读写与检索
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
            disabled: true
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
            disabled: true
          # 后台任务
          - id: tool-jobs
            name: '@deepseek-ai/dsh-tool-jobs'
            disabled: true
          # 技能：要扫本地目录，属于文件访问
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            disabled: true
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
            disabled: true
          # 计划模式 / 目标 / 待办：都是编码 Agent 的活儿
          - id: plan-mode
            name: '@deepseek-ai/dsh-plan-mode'
            disabled: true
          - id: command-goal
            name: '@deepseek-ai/dsh-command-goal'
            disabled: true
          - id: tool-goal
            name: '@deepseek-ai/dsh-tool-goal'
            disabled: true
          - id: tool-todo
            name: '@deepseek-ai/dsh-tool-todo'
            disabled: true
          # 子代理 / 工作流：子代理会带着自己的完整工具集跑，必须关掉
          - id: tool-subagent
            name: '@deepseek-ai/dsh-tool-subagent'
            disabled: true
          - id: tool-subagent-fork
            name: '@deepseek-ai/dsh-tool-subagent'
            disabled: true
          - id: workflow-ptc
            name: '@deepseek-ai/dsh-workflow-ptc'
            disabled: true
          - id: tool-workflow
            name: '@deepseek-ai/dsh-tool-workflow'
            disabled: true
          # 交付文件 / 插件管理
          - id: present
            name: '@deepseek-ai/dsh-tool-present'
            disabled: true
          - id: tool-plugin-manager
            name: '@deepseek-ai/dsh-plugin-manager/tools'
            disabled: true
`

// ─────────────────────────────────────────────────────────────────────────────
// 遐蝶-工作：由遐蝶-聊天复制，人设精简 + 末尾工作指令 + 整段 standard 工具集
// ─────────────────────────────────────────────────────────────────────────────
const WORK_TEMPLATE = `# ----- 遐蝶-工作 (id: xiadie-work) -------------------------------------------
# 从「遐蝶-聊天」复制而来，三处改动：
#   1. 人设精简：个人线压成 性格 / 分寸 / 说话 三小节，去掉世界观长卷与人物关系逐条
#   2. 末尾追加【工作模式指令】与工作约定（在 persona.prefix 的最后）
#   3. 工具面全开：整段套用内置 standard 的工具集（tools-work.yml，由 sync-tools.mjs 抽取）
#
# 刻意不挂 dsh-xiadie-agent/lore：工作模式下不注入设定资料，省 token、也免得她聊设定。
# 刻意不挂 dsh-xiadie-agent/guard：工作模式就要完整工具面，不需要收窄白名单。
# 同样不写 inject: [biliBasicCompactionPolicy]（理由见文件上方「遐蝶-聊天」那段注释）。
- insert:
    - id: preset-xiadie-work
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: xiadie-work
        name: '遐蝶-工作'
        description: '遐蝶工作模式（崩坏：星穹铁道）：资深行业智库专家 + 出版级排版 —— 产出 PPT 分镜脚本与结构化 Word，工具全开（文件读写、Shell、检索、子代理）。'
        order: 8
        plugins:
          # 不写 complete: true —— 那会遮蔽工具说明，文件 / 终端工具就不会被正确调用。
          # includeRuntimeContext: true —— 保留工作目录、平台、审批策略等运行时上下文。
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              includeRuntimeContext: true
              prefix: |
%%PERSONA_WORK%%
%%TOOLSET%%
`

/** 把一段多行文本变成 YAML 字面块的块体（空行保持为空，其余行补 16 格缩进）。 */
function toBlock(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n+$/u, '')
  return normalized
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : INDENT + line.replace(/\s+$/u, '')))
    .join('\n')
}

/** 从写出的 yml 里把 prefix 块读回来（from 之后的第一处），验证与人设原文一致。 */
function readBackBlock(yml, from = 0) {
  const lines = yml.split('\n')
  const start = lines.indexOf(PREFIX_LINE, from)
  if (start < 0) throw new Error(`生成的 yml 里找不到 prefix 行：${PREFIX_LINE}`)
  const body = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === '') {
      body.push('')
      continue
    }
    if (!line.startsWith(INDENT)) break
    body.push(line.slice(INDENT.length))
  }
  while (body.length > 0 && body[body.length - 1] === '') body.pop()
  return `${body.join('\n')}\n`
}

/** 统一换行、去 BOM、去掉结尾空白行（返回不含结尾换行的正文）。 */
function normalize(text) {
  return text.replace(/\r\n/g, '\n').replace(/^\ufeff/u, '').replace(/\s+$/u, '')
}

const persona = normalize(await readFile(PERSONA_PATH, 'utf8'))
const style = normalize(await readFile(STYLE_PATH, 'utf8'))
// 【影音材料】插在人设与风格限制之间：先说「能看能听」，再用风格条款收口。
const media = normalize(await readFile(MEDIA_PATH, 'utf8'))
const chatPayload = `${persona}\n\n${media}\n\n${style}\n`

const workPersona = normalize(await readFile(WORK_PERSONA_PATH, 'utf8'))
const workPayload = `${workPersona}\n\n${media}\n`
const toolset = (await readFile(TOOLSET_PATH, 'utf8')).replace(/\r\n/g, '\n').replace(/\s+$/u, '')

if (!TEMPLATE.includes('%%PERSONA%%')) throw new Error('对话模板里缺 %%PERSONA%% 占位符')
if (!WORK_TEMPLATE.includes('%%PERSONA_WORK%%')) throw new Error('工作模板里缺 %%PERSONA_WORK%% 占位符')
if (!WORK_TEMPLATE.includes('%%TOOLSET%%')) throw new Error('工作模板里缺 %%TOOLSET%% 占位符')

const chatBlock = TEMPLATE.replace('%%PERSONA%%', toBlock(chatPayload))
const workBlock = WORK_TEMPLATE.replace('%%PERSONA_WORK%%', toBlock(workPayload)).replace('%%TOOLSET%%', toolset)
const output = `${chatBlock}\n${workBlock}`
await writeFile(OUTPUT_PATH, output, 'utf8')

const written = await readFile(OUTPUT_PATH, 'utf8')
const prefixLines = written.split('\n').flatMap((line, index) => (line === PREFIX_LINE ? [index] : []))
if (prefixLines.length !== 2) throw new Error(`应当有 2 处 prefix 块，实得 ${prefixLines.length}`)

const trips = [
  ['对话', readBackBlock(written, prefixLines[0]), chatPayload],
  ['工作', readBackBlock(written, prefixLines[1]), workPayload],
]
for (const [label, trip, source] of trips) {
  if (trip === source) continue
  const a = source.split('\n')
  const b = trip.split('\n')
  const at = a.findIndex((line, index) => line !== b[index])
  throw new Error(
    `${label}预设往返校验失败：第 ${at + 1} 行起不一致\n原文: ${JSON.stringify(a[at])}\n回读: ${JSON.stringify(b[at])}`,
  )
}

console.log(`OK  ${OUTPUT_PATH}`)
console.log(`    yml  ${Buffer.byteLength(written, 'utf8')} 字节 / ${written.split('\n').length} 行（两个预设）`)
console.log(`    遐蝶-聊天  prefix ${chatPayload.split('\n').length - 1} 行 / ${Buffer.byteLength(chatPayload, 'utf8')} 字节，往返校验一致`)
console.log(`              其中 人设 ${persona.split('\n').length} 行 / ${Buffer.byteLength(persona, 'utf8')} 字节；风格限制 ${style.split('\n').length} 行 / ${Buffer.byteLength(style, 'utf8')} 字节`)
console.log(`    遐蝶-工作  prefix ${workPayload.split('\n').length - 1} 行 / ${Buffer.byteLength(workPayload, 'utf8')} 字节，往返校验一致`)
console.log(`              工具集 ${toolset.split('\n').length} 行 / ${Buffer.byteLength(toolset, 'utf8')} 字节（原样嵌入）`)
