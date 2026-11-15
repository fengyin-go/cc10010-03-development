import { useSyncExternalStore } from 'react'

// 当前值班会话：纯前端版没有登录体系，用可切换的值班人模拟权限与归属。
export type Operator = {
  name: string
  department: string
}

// 预置值班人：张伟/李娜是接入通道负责人，王强来自其他部门（跨部门共享内容只读）。
export const OPERATORS: Operator[] = [
  { name: '张伟', department: '数据平台部' },
  { name: '李娜', department: '数据平台部' },
  { name: '王强', department: '业务分析部' },
]

const SESSION_KEY = 'lake-govern-config:operator'

function load(): Operator {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Operator
        if (parsed && typeof parsed.name === 'string' && typeof parsed.department === 'string') {
          return parsed
        }
      } catch {
        // 落到默认值班人
      }
    }
  }
  return OPERATORS[0]
}

let current: Operator = load()
const listeners = new Set<() => void>()

export function currentOperator(): Operator {
  return current
}

export function setOperator(next: Operator): void {
  current = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(next))
  }
  listeners.forEach((listener) => listener())
}

export function useOperator(): Operator {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => current,
  )
}
