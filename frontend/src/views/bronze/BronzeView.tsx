import { useCallback, useEffect, useMemo, useState } from 'react'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { restrictedBronzeRows } from '@/api/qualification'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('bronze')
const columns = [
  "表编号",
  "来源通道",
  "目标路径",
  "保留策略",
  "分区规则",
  "文件格式",
  "压缩类型",
  "数据校验",
  "准入证据"
]
const actions = [
  "提交校验",
  "启用同步",
  "停用同步"
]
const statuses = [
  "草稿",
  "待校验",
  "已启用",
  "已停用"
]

export default function BronzeView() {
  const [rows, setRows] = useState<EntryRow[]>([])
  const [restricted, setRestricted] = useState<{ row: EntryRow; reason: string }[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [noticeMessage, setNoticeMessage] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const filterFields = useMemo(() => columns.slice(0, 3), [])

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
      setRestricted(restrictedBronzeRows())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '原始层管理列表读取失败')
    }
  }, [filters])

  useEffect(() => {
    reload()
  }, [reload])

  function runAction(action: string, row: EntryRow) {
    setErrorMessage('')
    setNoticeMessage('')
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setNoticeMessage(result.message)
    reload()
  }

  const stats = [
    { label: '原始表总数', value: rows.length },
    { label: '已启用表', value: rows.filter((row) => String(row.status) === '已启用').length },
    { label: '待校验表', value: rows.filter((row) => String(row.status) === '待校验').length },
    { label: '来源通道受限表', value: restricted.length },
  ]

  return (
    <section className="page" data-module="bronze">
      <header className="page-head">
        <div>
          <h2>原始层管理管理</h2>
          <p className="page-desc">维护原始层表的输入、执行约束与结果记录，为原始层管理提供可验证的数据工程流程。</p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => setErrorMessage('原始表登记入口尚未接入审批流')}>
            登记原始表
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出原始层管理清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((item) => (
          <article key={item.label} className="stat-card">
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">{item.value}</strong>
          </article>
        ))}
      </div>

      <p className="status-legend">
        {statuses.map((status: string) => (
          <span key={status} className="legend-item">
            {status}：{rows.filter((row) => String(row.status) === status).length}
          </span>
        ))}
      </p>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field}</span>
            <input
              value={filters[field] ?? ''}
              placeholder={`按${field}检索`}
              onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
            />
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] || '—'}</td>)}
              <td>{row.status}</td>
              <td className="row-actions">
                {actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => runAction(action, row)}>
                    {action}
                  </button>
                ))}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 2}>暂无原始层管理数据，可先登记原始表</td>
            </tr>
          )}
        </tbody>
      </table>

      <h3 className="section-title">来源通道受限待校验清单</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>表编号</th>
            <th>来源通道</th>
            <th>当前状态</th>
            <th>准入证据</th>
            <th>受限原因</th>
          </tr>
        </thead>
        <tbody>
          {restricted.map((item) => (
            <tr key={String(item.row.id)}>
              <td>{item.row['表编号']}</td>
              <td>{item.row['来源通道']}</td>
              <td>{item.row.status}</td>
              <td>{item.row['准入证据'] || '—'}</td>
              <td>{item.reason}</td>
            </tr>
          ))}
          {restricted.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={5}>没有受来源通道限制的原始表，全部已取得有效准入证据</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条原始层管理记录</span>
        {noticeMessage && <span className="notice-text">{noticeMessage}</span>}
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
