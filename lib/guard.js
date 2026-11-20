/**
 * dsh-xiadie-agent/guard —— 「遐蝶-聊天」的工具闸门。
 *
 * 预设里没有装的文件 / 终端 / 子代理行，本来就不存在；但宿主级插件（billion-context
 * 的压缩工具、dsh-m 的市场查询、dsh-ffmpeg、dsh-video-storyboard、plugin_manager 等）
 * 注册的工具是全局的，会漏进每一个预设。所以这里做两件事：
 *   1. restrict：把这个 agent 作用域能看到的全局工具裁到白名单（隐藏）；
 *   2. guard：执行期硬拦截，任何不在白名单里的调用一律拒绝（即使隐藏失败）。
 *
 * 白名单只收「看和查」的工具：对话 / 联网 / 上下文压缩 / 市场查询 / 运行时内省，
 * 外加影音分析（看视频、听音频、转码剪辑 —— 这些由 ffmpeg / video / sound 插件自己
 * 读写文件，不需要把通用文件工具交给她）。文件读写、终端、插件安装类仍然挡在外面。
 */

export const name = 'xiadie-agent-guard'

export const inject = ['tools']

const DEFAULT_ALLOW = [
  // 对话与联网
  'web_search',
  'web_fetch',
  'ask_user_question',
  // 上下文压缩（billion-context）
  'compress',
  'decompress',
  'search_context',
  'acp_status',
  'acp_cache',
  'acp_read_original_image',
  // 运行时只读内省
  'cordis_inspect_list',
  'cordis_inspect_query',
  // 插件市场只查不装
  'dshm_search',
  'dshm_list',
  'dshm_outdated',
  // 影音：dsh-video-storyboard（看视频）
  'video_help',
  'video_probe',
  'video_storyboard',
  'video_zoom',
  'video_locate',
  'video_subtitles',
  'video_storyboard_settings',
  // 影音：dsh-cixisound（听音频）
  'sound_read',
  'sound_transcribe',
  'sound_melody',
  'sound_chords',
  'sound_rhythm',
  'sound_structure',
  // 影音：dsh-ffmpeg（转码剪辑抽帧）
  'ffmpeg_health',
  'ffmpeg_probe',
  'ffmpeg_cut',
  'ffmpeg_concat',
  'ffmpeg_encode',
  'ffmpeg_adjust',
  'ffmpeg_extract',
  'ffmpeg_frames',
  'ffmpeg_storyboard',
  'ffmpeg_gif',
  'ffmpeg_subtitle',
]

export function apply(ctx, config = {}) {
  const configured = Array.isArray(config?.allow) ? config.allow : []
  // YAML 里的 allow 与内置 DEFAULT_ALLOW 取并集：YAML 只写「这一版想额外放行什么」，
  // 漏写影音工具也不会把 video_* / sound_* / ffmpeg_* 一起挡掉。
  const allow = new Set(
    [...DEFAULT_ALLOW, ...configured].map((entry) => String(entry)),
  )
  const logger = ctx.logger

  // 1) 收窄模型可见的工具面。
  //    ⚠ 这里以前是 `definitions() ∩ allow`：guard 的 apply 跑在预设装配早期，
  //    那一刻全局工具大多还没注册，definitions() 只返回 dshm_* 三个，
  //    于是 restrict 的 allow 掩码被裁成那三个，之后注册的工具全部永久不可见 ——
  //    重启后「遐蝶-聊天」只剩 3 个工具、看不到视频，就是这个原因。
  //    掩码按「名字」生效，所以直接交完整白名单即可：先注册的工具留下，
  //    后注册的影音工具也会按名字放行。
  try {
    ctx.tools.restrict({ allow: [...allow] })
    logger?.info?.(`[dsh-xiadie-agent/guard] 工具面白名单已登记：${allow.size} 项`)
  } catch (error) {
    logger?.warn?.(`[dsh-xiadie-agent/guard] 白名单式 restrict 失败（改用排除式兜底）：${error?.message ?? error}`)
    try {
      const names = ctx.tools.definitions().map((definition) => definition.name)
      const deny = names.filter((toolName) => !allow.has(toolName))
      if (deny.length > 0) ctx.tools.restrict({ deny })
      logger?.warn?.(`[dsh-xiadie-agent/guard] 已排除 ${deny.join(', ')}（仅本次已知的工具）`)
    } catch (fallbackError) {
      logger?.warn?.(
        `[dsh-xiadie-agent/guard] restrict 完全未生效（仅靠 guard 拦截）：${fallbackError?.message ?? fallbackError}`,
      )
    }
  }

  // 2) 执行期硬拦截。
  ctx.tools.guard((execution) => {
    if (allow.has(execution.name)) return undefined
    return `遐蝶是纯聊天模式，${execution.name} 已被禁用：她不能读写文件、执行命令、调用子代理或改动这台电脑。请用文字向阁下说明需要什么。`
  })
}
