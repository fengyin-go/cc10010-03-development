import { useCallback, useEffect, useMemo, useState } from 'react'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { listQualifications, updateChannelRules } from '@/api/qualification'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('ingest')
const columns = [
  "通道编号",
  "源端类型",
  "连接参数",
  "接入模式",
  "批次大小",
  "校验规则",
  "异常处理",
  "通道负责人",
  "归属部门",
  "当前结论编号"
]
const actions = [
  "提交校验",
  "启动接入",
  "停止接入"
]
const statuses = [
  "草稿",
  "待校验",
  "运行中",
  "已停止"
]
const qualColumns = ["结论编号", "通道编号", "结论", "结论状态", "校验人", "校验时间", "复核明细"]

export default function IngestView() {
  const [rows, setRows] = useState<EntryRow[]>([])
  const [quals, setQuals] = useState<EntryRow[]>([])
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
      setQuals(listQualifications())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '多源接入列表读取失败')
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

  function editRules(row: EntryRow) {
    setErrorMessage('')
    setNoticeMessage('')
    const current = String(row['校验规则'] ?? '')
    const next = window.prompt(`修改通道 ${row['通道编号']} 的校验规则（旧结论将转历史保留）`, current)
    if (next === null) {
      return
    }
    const result = updateChannelRules(Number(row.id), next)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setNoticeMessage(result.message)
    reload()
  }

  const stats = [
    { label: '接入通道总数', value: rows.length },
    { label: '运行中通道', value: rows.filter((row) => String(row.status) === '运行中').length },
    { label: '待校验通道', value: rows.filter((row) => String(row.status) === '待校验').length },
    { label: '有效结论', value: quals.filter((row) => String(row['结论状态']) === '有效').length },
  ]

  return (
    <section className="page" data-module="ingest">
      <header className="page-head">
        <div>
          <h2>多源接入管理</h2>
          <p className="page-desc">维护多源接入通道的输入、执行约束与结果记录，为多源异构接入提供可验证的数据工程流程。</p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => setErrorMessage('接入通道登记入口尚未接入审批流')}>
            登记接入通道
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出多源接入清单
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
                <button className="link" type="button" onClick={() => editRules(row)}>
                  修改校验规则
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 2}>暂无多源接入数据，可先登记接入通道</td>
            </tr>
          )}
        </tbody>
      </table>

      <h3 className="section-title">接入校验结论（可复核）</h3>
      <table className="data-table">
        <thead>
          <tr>
            {qualColumns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {quals.map((row) => (
            <tr key={String(row.id)}>
              {qualColumns.map((column) => <td key={column}>{row[column] || '—'}</td>)}
            </tr>
          ))}
          {quals.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={qualColumns.length}>暂无校验结论，提交校验后在此生成可复核记录</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条多源接入记录</span>
        {noticeMessage && <span className="notice-text">{noticeMessage}</span>}
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
