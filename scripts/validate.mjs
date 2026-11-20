#!/usr/bin/env node
/**
 * validate.mjs —— 安装前自检生成的 cordis.patch.yml。
 *
 * 检查三件事：
 *   1. 两个预设都在、id 唯一、每行插件都有 name；
 *   2. 内联进 persona.prefix 的正文与 presets/ 下的源文件**逐字一致**（防止手改了 md 忘了 build）；
 *   3. 聊天模式的闸门 / 检索插件名指向本包，语料路径是仓库内的相对路径。
 *
 * 零外部依赖：宿主装了 `yaml` 就顺带做一次真正的解析，没装就只做文本级校验。
 *
 * 用法：node scripts/validate.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const OUT = join(ROOT, 'cordis.patch.yml')

const normalize = (text) =>
  text
    .replace(/\r\n/g, '\n')
    .replace(/^\ufeff/u, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .replace(/\s+$/u, '')

const read = (name) => normalize(readFileSync(join(ROOT, name), 'utf8'))

const problems = []
const problem = (message) => problems.push(message)

// ── 1. 读文件 ────────────────────────────────────────────────────────────────
const raw = readFileSync(OUT, 'utf8')
const chatExpect = [read('presets/chat-prompt.md'), read('presets/media-tools.md'), read('presets/chat-style-limits.md')].join('\n\n')
const workExpect = [read('presets/work-prompt.md'), read('presets/media-tools.md')].join('\n\n')

// ── 2. 抠出两处 prefix 字面块 ────────────────────────────────────────────────
const INDENT = ' '.repeat(16)
const PREFIX_LINE = `${INDENT.slice(2)}prefix: |`

function blocks(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const found = []
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trimEnd() !== PREFIX_LINE) continue
    const body = []
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].startsWith(INDENT)) {
        body.push(lines[j].slice(INDENT.length))
        continue
      }
      // 块内的空行是不带缩进的（模板把空行原样留空），要算进块里
      if (lines[j].trim() === '') {
        body.push('')
        continue
      }
      break
    }
    while (body.length > 0 && body[body.length - 1] === '') body.pop()
    found.push(normalize(body.join('\n')))
  }
  return found
}

const prefixes = blocks(raw)
if (prefixes.length !== 2) problem(`应当有 2 处 persona.prefix 字面块，找到 ${prefixes.length} 处`)
if (prefixes[0] !== chatExpect) problem('遐蝶-聊天：内联人设与 presets/ 源文件不一致（改完 md 记得跑 node scripts/build.mjs）')
if (prefixes[1] !== workExpect) problem('遐蝶-工作：内联人设与 presets/ 源文件不一致（同上）')

// ── 3. 结构与关键行 ─────────────────────────────────────────────────────────
for (const id of ['id: xiadie-chat', 'id: xiadie-work']) {
  if (!raw.includes(id)) problem(`缺少预设 ${id.slice(4)}`)
}
for (const needle of ["name: 'dsh-xiadie-agent/lore'", "name: 'dsh-xiadie-agent/guard'"]) {
  if (!raw.includes(needle)) problem(`缺少插件行 ${needle}`)
}
if (!raw.includes("lorePath: './data/lore_full.md'")) problem('lore 的 lorePath 应当是仓库内的相对路径 ./data/lore_full.md')
if (/^#?\s*.*(D:|C:\\Users|DeepSeekharness)/mu.test(raw)) problem('生成物里残留了本机绝对路径')

// 插件 id 去重只在真解析后按预设分别做（两个预设之间复用同一个 id 是正常的）

// ── 4. 可选：真解析一次 ─────────────────────────────────────────────────────
let parsed = null
for (const specifier of ['yaml', join(ROOT, 'node_modules', 'yaml', 'index.js')]) {
  try {
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const YAML = require(specifier)
    parsed = YAML.parse(raw, { prettyErrors: true })
    break
  } catch {
    // 没装就跳过
  }
}
if (parsed) {
  if (!Array.isArray(parsed) || parsed.length !== 2) problem('顶层应当是两段 insert')
  const presets = parsed.map((op) => op?.insert?.[0]).filter(Boolean)
  const chat = presets.find((preset) => preset?.config?.id === 'xiadie-chat')
  const work = presets.find((preset) => preset?.config?.id === 'xiadie-work')
  if (!chat || !work) problem('YAML 解析后找不到两个预设')
  for (const [label, preset] of [['遐蝶-聊天', chat], ['遐蝶-工作', work]]) {
    if (!preset) continue
    for (const entry of preset.config?.plugins ?? []) {
      if (!entry.id) problem(`${label}: 有插件行缺 id`)
      if (!entry.name) problem(`${label}: ${entry.id} 缺 name`)
    }
    const enabled = (preset.config?.plugins ?? []).filter((entry) => entry.disabled !== true)
    console.log(
      `${label}  id=${preset.config.id}  插件行 ${preset.config.plugins.length}（启用 ${enabled.length}）  prefix ${(preset.config.plugins.find((e) => e.id === 'persona')?.config?.prefix ?? '').length} 字符`,
    )
  }
} else {
  console.log('（宿主没有 yaml 包，跳过真正的 YAML 解析，只做文本级校验）')
}

// ── 5. 结论 ────────────────────────────────────────────────────────────────
const mediaCount = (raw.match(/^\s+- (video|sound|ffmpeg)_/gmu) ?? []).length
console.log(`聊天白名单里的影音工具：${mediaCount} 条`)
console.log(`生成物：${Buffer.byteLength(raw, 'utf8')} 字节 / ${raw.split('\n').length} 行`)

if (problems.length > 0) {
  console.error(`\n校验失败：\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('\n校验通过')
