/**
 * dsh-xiadie-agent/lore —— 「遐蝶-聊天」预设的本地资料检索。
 *
 * 为什么要自己写：宿主里的 dsh-rag-panel 只是「面板 + 会话开头指针」，真正的记忆库
 * 在 Python 侧（SQLite + MCP），并没有「把知识库路径指向一份 md」的配置项。所以这里
 * 自带一个极小的检索器：启动时把 lore_full.md 按标题切块，用中文双字切词（bigram）
 * 建 BM25 索引；每轮第一步把最相关的几块，作为一条 provider 快照消息附在阁下这轮
 * 消息之后。
 *
 * 设计约束：
 *   - 纯 Node 内置模块，零外部依赖，不联网；
 *   - 只在「agent/pre-step」时注入，检索失败 / 没命中 / 文件不在 —— 一律安静跳过；
 *   - 同一轮只注入一次（按 agent + turn 记账），重试与多步工具循环都不会重复。
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'xiadie-agent-lore'

/** 本包根目录（lib/ 的上一级）。整个仓库可整体移动，路径都从这里算。 */
const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 语料路径：允许绝对路径 / 相对本包路径；也可用环境变量 XIADIE_LORE_PATH 覆盖。 */
const DEFAULT_LORE_PATH = resolveLorePath(
  process.env.XIADIE_LORE_PATH || './data/lore_full.md',
)

function resolveLorePath(input) {
  const value = String(input ?? '').trim() || './data/lore_full.md'
  return isAbsolute(value) ? value : resolve(PKG_ROOT, value)
}

const DEFAULTS = {
  lorePath: DEFAULT_LORE_PATH,
  topK: 3,
  maxChars: 2200,
  minMatchedTokens: 2,
  minCoverage: 0.45,
  maxQueryChars: 600,
}

const K1 = 1.2
const B = 0.75
const MAX_CHUNK_CHARS = 1200
const MIN_CHUNK_CHARS = 40
const MAX_INJECTED_TURNS = 64

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/
const WORD_CHAR = /[A-Za-z0-9]/
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g
const URL_RE = /https?:\/\/\S+/g
const NOISE_LINE = /^[\s|*_\-—–=+·.。,，;；:：!！?？'"“”‘’()（）[\]【】]+$/

const HEADER = [
  '〔背景资料 · 本地资料库自动附上〕',
  '下面几段是与阁下刚刚这句话相关的官方设定摘录，供你回忆与自检。',
  '用法：只是在需要时自然化用（称呼、关系、事件先后的口径要对得上）；不要逐字朗读，',
  '不要整段照搬，也不要对阁下提起「资料」「检索」「设定库」这类字眼。',
].join('\n')

// ---------------------------------------------------------------------------
// 分词：中文按双字（bigram）切，拉丁字母/数字按词切
// ---------------------------------------------------------------------------

function tokenize(text) {
  const tokens = []
  let cjkRun = ''
  let wordRun = ''

  const flushCjk = () => {
    if (cjkRun.length === 1) tokens.push(cjkRun)
    else {
      for (let i = 0; i + 1 < cjkRun.length; i += 1) tokens.push(cjkRun.slice(i, i + 2))
    }
    cjkRun = ''
  }
  const flushWord = () => {
    if (wordRun.length >= 2) tokens.push(wordRun.toLowerCase())
    wordRun = ''
  }

  for (const char of text) {
    if (CJK_CHAR.test(char)) {
      flushWord()
      cjkRun += char
    } else if (WORD_CHAR.test(char)) {
      flushCjk()
      wordRun += char
    } else {
      flushCjk()
      flushWord()
    }
  }
  flushCjk()
  flushWord()
  return tokens
}

// ---------------------------------------------------------------------------
// 切块：按 markdown 标题分层，标题路径拼进块内以参与匹配
// ---------------------------------------------------------------------------

function cleanLine(line) {
  const text = line
    .replace(IMAGE_RE, '')
    .replace(LINK_RE, '$1')
    .replace(URL_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || NOISE_LINE.test(text)) return ''
  return text
}

function buildChunks(raw) {
  const chunks = []
  let headings = []
  let path = ''
  let body = []

  const flush = () => {
    const text = body.join('\n').trim()
    if (text.length >= MIN_CHUNK_CHARS) chunks.push({ path, text })
    body = []
  }

  for (const line of raw.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1].length
      headings = headings.filter((entry) => entry.level < level)
      headings.push({ level, text: cleanLine(heading[2]) || '资料' })
      path = headings.map((entry) => entry.text).join(' › ')
      continue
    }

    const cleaned = cleanLine(line)
    if (!cleaned) continue
    if (body.join('').length + cleaned.length > MAX_CHUNK_CHARS) flush()
    body.push(cleaned)
  }
  flush()
  return chunks
}

// ---------------------------------------------------------------------------
// 索引与检索（BM25）
// ---------------------------------------------------------------------------

function buildIndex(chunks) {
  const postings = new Map() // token -> [docIdx, tf, docIdx, tf, ...]
  const df = new Map() // token -> 出现该词的块数
  const docLens = new Array(chunks.length)
  let totalLen = 0

  chunks.forEach((chunk, docIdx) => {
    const tokens = tokenize(`${chunk.path}\n${chunk.text}`)
    docLens[docIdx] = tokens.length
    totalLen += tokens.length

    const tf = new Map()
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)

    for (const [token, count] of tf) {
      df.set(token, (df.get(token) ?? 0) + 1)
      const list = postings.get(token)
      if (list) list.push(docIdx, count)
      else postings.set(token, [docIdx, count])
    }
  })

  return {
    chunks,
    postings,
    df,
    docLens,
    total: chunks.length,
    avgLen: totalLen / Math.max(1, chunks.length),
  }
}

function search(index, query, options) {
  const opts = { ...DEFAULTS, ...(options ?? {}) }
  const tokens = tokenize(query)
  if (tokens.length === 0 || index.total === 0) return []

  const queryTf = new Map()
  for (const token of tokens) queryTf.set(token, (queryTf.get(token) ?? 0) + 1)

  const scores = new Map()
  const matched = new Map()
  const covered = new Map()
  let queryWeightTotal = 0

  for (const [token, queryCount] of queryTf) {
    const posting = index.postings.get(token)
    if (!posting) continue
    const df = index.df.get(token) ?? 0
    const idf = Math.log(1 + (index.total - df + 0.5) / (df + 0.5))
    const weight = idf * Math.min(1 + Math.log(queryCount), 3)
    queryWeightTotal += idf

    for (let i = 0; i < posting.length; i += 2) {
      const docIdx = posting[i]
      const tf = posting[i + 1]
      const docLen = index.docLens[docIdx] || 1
      const norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * docLen) / index.avgLen))
      scores.set(docIdx, (scores.get(docIdx) ?? 0) + weight * norm)
      matched.set(docIdx, (matched.get(docIdx) ?? 0) + 1)
      covered.set(docIdx, (covered.get(docIdx) ?? 0) + idf)
    }
  }

  // idf 加权的查询覆盖率：命中越多高信息量词，越像在讲这件事。
  // 只命中「今天」「我们」这类高频词时覆盖率很低，会被下面的门槛滤掉。
  const denominator = Math.max(queryWeightTotal, 1e-9)

  return [...scores.entries()]
    .map(([docIdx, score]) => ({ docIdx, score, coverage: (covered.get(docIdx) ?? 0) / denominator }))
    .filter((hit) => (matched.get(hit.docIdx) ?? 0) >= opts.minMatchedTokens)
    .filter((hit) => hit.coverage >= opts.minCoverage)
    .sort((left, right) => right.score - left.score)
    .slice(0, opts.topK)
    .map((hit) => ({ ...index.chunks[hit.docIdx], score: hit.score, coverage: hit.coverage }))
}

function renderBlock(hits, maxChars) {
  const parts = []
  let used = 0

  for (const hit of hits) {
    const title = `【${hit.path || '资料'}】`
    const budget = maxChars - used - title.length - 2
    if (budget < 120) break
    const body = hit.text.length > budget ? `${hit.text.slice(0, budget)}…` : hit.text
    parts.push(`${title}\n${body}`)
    used += title.length + body.length + 2
  }

  return parts.length === 0 ? '' : `${HEADER}\n\n${parts.join('\n\n')}`
}

// ---------------------------------------------------------------------------
// 消息工具
// ---------------------------------------------------------------------------

function textOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const part of content) {
    if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text)
    }
  }
  return parts.join('\n')
}

/** 找出最近一条真正的用户消息：跳过本插件自己注入的快照消息。 */
function lastUserText(messages, maxChars) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || message.role !== 'user') continue
    if (String(message.source?.kind ?? '').startsWith('plugin:')) continue
    const text = textOf(message).trim()
    if (!text) continue
    return text.length > maxChars ? text.slice(-maxChars) : text
  }
  return ''
}

/** 会话格式 V4 的 provider 快照消息（与 dsh-llm createUserMessage 同形）。 */
function createSnapshotMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: `plugin:${name}`,
      form: 'snapshot',
      sections: [{ name: 'lore', text }],
    },
  })
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

export function apply(ctx, config = {}) {
  const options = { ...DEFAULTS }
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value === undefined || value === null || value === '') continue
    options[key] = value
  }
  options.topK = Math.max(1, Math.min(6, Number(options.topK) || DEFAULTS.topK))
  options.maxChars = Math.max(400, Math.min(8000, Number(options.maxChars) || DEFAULTS.maxChars))
  options.minMatchedTokens = Math.max(
    1,
    Math.min(4, Number(options.minMatchedTokens) || DEFAULTS.minMatchedTokens),
  )
  const coverage = Number(options.minCoverage)
  options.minCoverage = Number.isFinite(coverage)
    ? Math.max(0, Math.min(1, coverage))
    : DEFAULTS.minCoverage
  options.lorePath = resolveLorePath(options.lorePath)

  const logger = ctx.logger
  const injectedTurns = new Map()
  let indexPromise = null

  const ensureIndex = () => {
    if (!indexPromise) {
      const startedAt = Date.now()
      indexPromise = (async () => {
        const raw = await readFile(options.lorePath, 'utf8')
        const chunks = buildChunks(raw)
        const index = buildIndex(chunks)
        logger?.info?.(
          `[xiadie-agent/lore] 索引完成：${index.total} 块 / ${index.postings.size} 词，用时 ${Date.now() - startedAt}ms（${options.lorePath}）`,
        )
        return index
      })()
      indexPromise.catch((error) => {
        indexPromise = null
        logger?.warn?.(`[xiadie-agent/lore] 资料库读取失败，检索已停用：${error?.message ?? error}`)
      })
    }
    return indexPromise
  }

  // 启动时预热索引，别让第一轮对话等它。
  const warm = setTimeout(() => {
    void ensureIndex().catch(() => {})
  }, 0)
  if (typeof warm?.unref === 'function') warm.unref()

  ctx.on('dispose', () => {
    clearTimeout(warm)
    injectedTurns.clear()
  })

  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      const decision = await next()
      try {
        if (!decision || decision.kind !== 'enter') return decision

        const messages = decision.messages ?? payload?.messages ?? []
        if (!Array.isArray(messages) || messages.length === 0) return decision

        const agentId = String(payload?.agent?.id ?? '')
        const turnKey = `${agentId}#${payload?.turn ?? payload?.step ?? 0}`
        if (injectedTurns.has(turnKey)) return decision

        const last = messages[messages.length - 1]
        if (last && String(last.source?.kind ?? '') === `plugin:${name}`) return decision

        const query = lastUserText(messages, options.maxQueryChars)
        if (!query) return decision

        const index = await ensureIndex().catch(() => null)
        if (!index) return decision

        const hits = search(index, query, options)
        if (hits.length === 0) return decision

        const block = renderBlock(hits, options.maxChars)
        if (!block) return decision

        if (injectedTurns.size >= MAX_INJECTED_TURNS) {
          const oldest = injectedTurns.keys().next().value
          if (oldest !== undefined) injectedTurns.delete(oldest)
        }
        injectedTurns.set(turnKey, true)
        logger?.debug?.(
          `[xiadie-agent/lore] 注入 ${hits.length} 块（${hits.map((hit) => hit.score.toFixed(2)).join(', ')}）`,
        )

        return { ...decision, messages: [...messages, createSnapshotMessage(block)] }
      } catch (error) {
        logger?.warn?.(`[xiadie-agent/lore] 注入失败，本轮跳过：${error?.message ?? error}`)
        return decision
      }
    },
    { prepend: true },
  )
}

// 离线自检（test.mjs）复用；对插件契约无影响。
export { tokenize, buildChunks, buildIndex, search, renderBlock }
