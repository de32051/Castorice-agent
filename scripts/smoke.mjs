#!/usr/bin/env node
/**
 * smoke.mjs —— 不装 DSH 也能验一遍检索链路。
 *
 * 用一个假的 ctx 调 apply()，喂一个真实问题，看它有没有从 data/lore_full.md 里
 * 捞到东西、注入的快照消息长什么样。只验证「索引建得起来 + 命中合理」，
 * 不验证宿主 hook 的时序。
 *
 * 用法：node scripts/smoke.mjs ["你的问题"]
 */
import { apply, name } from '../lib/lore.js'

const question = process.argv[2] || '遐蝶和白厄是什么关系？'

const handlers = new Map()
const logs = []

const ctx = {
  logger: {
    info: (message) => logs.push(`info  ${message}`),
    warn: (message) => logs.push(`warn  ${message}`),
    debug: (message) => logs.push(`debug ${message}`),
  },
  on(event, handler) {
    handlers.set(event, handler)
    return () => handlers.delete(event)
  },
}

apply(ctx, {})

const preStep = handlers.get('agent/pre-step')
if (!preStep) throw new Error('没有注册 agent/pre-step，插件没生效')

const messages = [{ id: 'u1', role: 'user', content: question }]
const decision = await preStep(
  { agent: { id: 'smoke' }, turn: 1, step: 0, messages },
  async () => ({ kind: 'enter', messages }),
)

console.log(`插件名：${name}`)
for (const line of logs) console.log(`  ${line}`)

const injected = (decision?.messages ?? []).slice(messages.length)
if (injected.length === 0) {
  console.error(`\n没注入任何资料（问题：${question}）`)
  process.exit(1)
}

const text = typeof injected[0].content === 'string'
  ? injected[0].content
  : (injected[0].content ?? []).map((part) => part?.text ?? '').join('\n')

console.log(`\n问题：${question}`)
console.log(`注入 ${injected.length} 条快照，${text.length} 字符：\n`)
console.log(text.slice(0, 700) + (text.length > 700 ? '\n…' : ''))
console.log('\n检索链路正常')
