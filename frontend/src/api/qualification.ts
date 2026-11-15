import { allRows, listRows, saveAll } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import { currentOperator } from '@/stores/session'

// 接入资格核验：结论单独作为一个存储模块（不进 MODULES，概览不把它当业务模块统计）。
export const QUAL_KEY = 'ingestQual'

// 核验依据的四个输入：源端类型、连接参数、接入模式、异常处理。
const SUPPORTED_SOURCE_TYPES = ['MySQL', 'PostgreSQL', 'Oracle', 'Kafka', '对象存储', '文件服务', 'API']
const VALID_INGEST_MODES = ['全量', '增量', '全量+增量']

type CheckItem = {
  item: string
  pass: boolean
  detail: string
}

// 正在写入结论的通道编号：并发提交同一通道时，后来的请求直接忽略。
const verifying = new Set<string>()

function findChannel(channelId: number): EntryRow | undefined {
  return listRows('ingest').find((row) => Number(row.id) === channelId)
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

// 权限与归属：跨部门共享内容只读；只有通道负责人可以维护接入通道和通道编号。
export function assertIngestWritable(channelId: number): ActionResult | null {
  const channel = findChannel(channelId)
  if (!channel) {
    return { ok: false, message: `没有找到编号为 ${channelId} 的接入通道` }
  }
  const operator = currentOperator()
  const department = String(channel['归属部门'] ?? '')
  if (department && operator.department !== department) {
    return {
      ok: false,
      message: `跨部门共享内容只读：通道 ${channel['通道编号']} 归属${department}，当前值班 ${operator.name}（${operator.department}）的修改已拒绝`,
    }
  }
  const owner = String(channel['通道负责人'] ?? '')
  if (owner && operator.name !== owner) {
    return {
      ok: false,
      message: `越权修改已拒绝：只有通道负责人 ${owner} 可以维护接入通道 ${channel['通道编号']}，当前值班 ${operator.name}`,
    }
  }
  return null
}

// 生成可复核的校验明细：每一项都留下通过/未通过与依据，结论可以事后复核。
function buildChecks(channel: EntryRow): CheckItem[] {
  const sourceType = String(channel['源端类型'] ?? '').trim()
  const connParams = String(channel['连接参数'] ?? '').trim()
  const mode = String(channel['接入模式'] ?? '').trim()
  const abnormal = String(channel['异常处理'] ?? '').trim()
  return [
    {
      item: '源端类型',
      pass: SUPPORTED_SOURCE_TYPES.includes(sourceType),
      detail: sourceType
        ? SUPPORTED_SOURCE_TYPES.includes(sourceType)
          ? `${sourceType} 已登记`
          : `${sourceType} 不在支持的源端类型内`
        : '源端类型为空',
    },
    {
      item: '连接参数',
      pass: connParams.length >= 8 && (connParams.includes('://') || connParams.includes('=')),
      detail: connParams
        ? connParams.length >= 8 && (connParams.includes('://') || connParams.includes('='))
          ? '连接串格式完整'
          : '连接串缺少协议或键值结构'
        : '连接参数为空',
    },
    {
      item: '接入模式',
      pass: VALID_INGEST_MODES.includes(mode),
      detail: mode
        ? VALID_INGEST_MODES.includes(mode)
          ? `${mode} 为合法接入模式`
          : `${mode} 不是合法接入模式`
        : '接入模式为空',
    },
    {
      item: '异常处理',
      pass: abnormal.length > 0,
      detail: abnormal ? `已配置：${abnormal}` : '未配置异常处理策略',
    },
  ]
}

function checksToText(checks: CheckItem[]): string {
  return checks.map((check) => `${check.item}:${check.pass ? '通过' : '未通过'}(${check.detail})`).join('；')
}

function nextQualCode(quals: EntryRow[], channelCode: string): string {
  const seq = quals.filter((row) => String(row['通道编号']) === channelCode).length + 1
  return `INQV-${channelCode}-${String(seq).padStart(3, '0')}`
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 原始表是否仍受来源通道限制：返回空串表示不受限，否则返回受限原因。
export function restrictionReason(
  bronzeRow: EntryRow,
  quals: EntryRow[] = listRows(QUAL_KEY),
  channels: EntryRow[] = listRows('ingest'),
): string {
  const evidence = String(bronzeRow['准入证据'] ?? '').trim()
  if (!evidence) {
    return '来源通道未通过接入资格核验，原始表无准入证据'
  }
  const qual = quals.find((row) => String(row['结论编号']) === evidence)
  if (!qual) {
    return `准入证据 ${evidence} 对应的结论不存在`
  }
  if (String(qual['结论状态']) !== '有效') {
    return `准入证据 ${evidence} 已转历史（校验规则已变更），待按新规则重新核验`
  }
  const channel = channels.find((row) => String(row['通道编号']) === String(bronzeRow['来源通道']))
  if (!channel || String(channel.status) !== '运行中') {
    return `来源通道 ${bronzeRow['来源通道']} 未处于运行中`
  }
  return ''
}

// 来源通道受限的待校验表清单：跟着最近一次核验结论变化。
export function restrictedBronzeRows(): { row: EntryRow; reason: string }[] {
  const quals = listRows(QUAL_KEY)
  const channels = listRows('ingest')
  return listRows('bronze')
    .map((row) => ({ row, reason: restrictionReason(row, quals, channels) }))
    .filter((item) => item.reason !== '')
}

export function listQualifications(channelCode?: string): EntryRow[] {
  const rows = listRows(QUAL_KEY)
  if (!channelCode) {
    return rows
  }
  return rows.filter((row) => String(row['通道编号']) === channelCode)
}

// 接入资格核验入口：同一通道只接受首个有效校验，结论、通道状态、原始层回写一次提交。
export function verifyChannel(channelId: number): ActionResult {
  const denied = assertIngestWritable(channelId)
  if (denied) {
    return denied
  }
  const channel = findChannel(channelId)
  if (!channel) {
    return { ok: false, message: `没有找到编号为 ${channelId} 的接入通道` }
  }
  const code = String(channel['通道编号'])
  const quals = listRows(QUAL_KEY)
  const active = quals.find(
    (row) => String(row['通道编号']) === code && String(row['结论状态']) === '有效',
  )
  if (active) {
    return {
      ok: false,
      message: `通道 ${code} 已接受首个有效校验（${active['结论编号']}，结论：${active['结论']}），重复请求不再生成第二份结论`,
    }
  }
  if (verifying.has(code)) {
    return { ok: false, message: `通道 ${code} 的核验正在写入，并发重复请求已忽略` }
  }
  verifying.add(code)
  try {
    const operator = currentOperator()
    const checks = buildChecks(channel)
    const passed = checks.every((check) => check.pass)
    const qualCode = nextQualCode(quals, code)
    const conclusion: EntryRow = {
      id: nextId(quals),
      status: passed ? '通过' : '未通过',
      pending: false,
      abnormal: !passed,
      结论编号: qualCode,
      通道编号: code,
      源端类型快照: String(channel['源端类型'] ?? ''),
      连接参数快照: String(channel['连接参数'] ?? ''),
      接入模式快照: String(channel['接入模式'] ?? ''),
      异常处理快照: String(channel['异常处理'] ?? ''),
      校验规则快照: String(channel['校验规则'] ?? ''),
      复核明细: checksToText(checks),
      结论: passed ? '通过' : '未通过',
      结论状态: '有效',
      校验人: operator.name,
      校验时间: nowText(),
    }
    const nextQuals = [...quals, conclusion]
    const nextChannels = listRows('ingest').map((row) =>
      Number(row.id) === channelId
        ? passed
          ? { ...row, status: '运行中', pending: false, abnormal: false, 当前结论编号: qualCode }
          : { ...row, status: '待校验', pending: true, abnormal: true, 当前结论编号: '' }
        : row,
    )
    // 结论回写原始层：通过则发准入证据，未通过则保持原状（旧证据仍可追溯），待处理队列随结论刷新。
    const nextBronze = listRows('bronze').map((row) => {
      if (String(row['来源通道']) !== code) {
        return row
      }
      const next = passed ? { ...row, 准入证据: qualCode } : { ...row }
      const restricted = restrictionReason(next, nextQuals, nextChannels) !== ''
      return { ...next, pending: restricted || String(next.status) === '待校验' }
    })
    // 原子提交：任何一个数组没算完都不会走到这里，通道保持待校验。
    saveAll({ ...allRows(), ingest: nextChannels, bronze: nextBronze, [QUAL_KEY]: nextQuals })
    if (passed) {
      return {
        ok: true,
        message: `核验通过，结论 ${qualCode} 已回写原始层管理，通道 ${code} 进入运行中`,
      }
    }
    const failedItems = checks.filter((check) => !check.pass).map((check) => check.item).join('、')
    return {
      ok: false,
      message: `核验未通过（${failedItems}），结论 ${qualCode} 已留档，通道保持待校验，原始表未取得准入证据`,
    }
  } catch (error) {
    return {
      ok: false,
      message: `核验写入没有完成，通道保持待校验：${error instanceof Error ? error.message : '未知错误'}`,
    }
  } finally {
    verifying.delete(code)
  }
}

// 修改校验规则：旧结论转历史保留（被原始表引用的仍可追溯），通道回到待校验重新核验。
export function updateChannelRules(channelId: number, newRule: string): ActionResult {
  const rule = newRule.trim()
  if (!rule) {
    return { ok: false, message: '校验规则不能为空' }
  }
  const denied = assertIngestWritable(channelId)
  if (denied) {
    return denied
  }
  const channel = findChannel(channelId)
  if (!channel) {
    return { ok: false, message: `没有找到编号为 ${channelId} 的接入通道` }
  }
  const code = String(channel['通道编号'])
  if (String(channel['校验规则'] ?? '') === rule) {
    return { ok: false, message: `通道 ${code} 的校验规则没有变化` }
  }
  const quals = listRows(QUAL_KEY)
  const archived = quals.filter(
    (row) => String(row['通道编号']) === code && String(row['结论状态']) === '有效',
  ).length
  const nextQuals = quals.map((row) =>
    String(row['通道编号']) === code && String(row['结论状态']) === '有效'
      ? { ...row, 结论状态: '历史', 归档时间: nowText(), 归档原因: '校验规则变更' }
      : row,
  )
  const nextChannels = listRows('ingest').map((row) =>
    Number(row.id) === channelId
      ? { ...row, 校验规则: rule, status: '待校验', pending: true, abnormal: false, 当前结论编号: '' }
      : row,
  )
  // 原始表保留旧结论编号作为历史依据，但重新进入受限待校验清单。
  const nextBronze = listRows('bronze').map((row) => {
    if (String(row['来源通道']) !== code) {
      return row
    }
    const restricted = restrictionReason(row, nextQuals, nextChannels) !== ''
    return { ...row, pending: restricted || String(row.status) === '待校验' }
  })
  saveAll({ ...allRows(), ingest: nextChannels, bronze: nextBronze, [QUAL_KEY]: nextQuals })
  return {
    ok: true,
    message: archived > 0
      ? `通道 ${code} 校验规则已更新，${archived} 份旧结论转历史仍可追溯，通道回到待校验`
      : `通道 ${code} 校验规则已更新，通道回到待校验`,
  }
}

// 启动接入门槛：只有持有效通过结论的通道才能进入运行中。
export function assertChannelStartable(channelId: number): ActionResult | null {
  const channel = findChannel(channelId)
  if (!channel) {
    return { ok: false, message: `没有找到编号为 ${channelId} 的接入通道` }
  }
  const code = String(channel['通道编号'])
  const qualCode = String(channel['当前结论编号'] ?? '').trim()
  if (!qualCode) {
    return { ok: false, message: `通道 ${code} 没有有效的接入校验结论，不能进入运行中，请先提交校验` }
  }
  const qual = listRows(QUAL_KEY).find(
    (row) => String(row['结论编号']) === qualCode && String(row['结论状态']) === '有效',
  )
  if (!qual || String(qual['结论']) !== '通过') {
    return { ok: false, message: `通道 ${code} 的接入资格核验未通过，不能进入运行中` }
  }
  return null
}

// 原始表启用门槛：必须持有有效准入证据，且来源通道处于运行中。
export function assertBronzeStartable(bronzeId: number): ActionResult | null {
  const row = listRows('bronze').find((item) => Number(item.id) === bronzeId)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${bronzeId} 的原始表` }
  }
  const reason = restrictionReason(row)
  if (reason) {
    return { ok: false, message: `原始表 ${row['表编号']} 不允许启用：${reason}` }
  }
  return null
}
