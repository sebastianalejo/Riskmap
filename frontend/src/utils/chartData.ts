import type { PointWithDate } from './simulateDates'

export type TimeRange = '7d' | '1m' | '3m' | '6m'

export const RANGE_OPTIONS: { value: TimeRange; label: string; days: number }[] = [
  { value: '7d', label: '7 días', days: 7 },
  { value: '1m', label: '1 mes', days: 30 },
  { value: '3m', label: '3 meses', days: 90 },
  { value: '6m', label: '6 meses', days: 180 },
]

export const RANGE_CONFIG: Record<TimeRange, { label: string; days: number }> = Object.fromEntries(
  RANGE_OPTIONS.map(({ value, label, days }) => [value, { label, days }]),
) as Record<TimeRange, { label: string; days: number }>

interface Bucket {
  name: string
  sortKey: string
  bajo: number
  medio: number
  alto: number
}

function getBucketKey(date: Date, range: TimeRange): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  if (range === '7d' || range === '1m') return d.toISOString().slice(0, 10)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().slice(0, 10)
}

function bucketLabel(date: Date, range: TimeRange): string {
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  if (range === '7d') return days[date.getDay()]
  if (range === '1m') return `${date.getDate()}/${date.getMonth() + 1}`
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
  const week = Math.ceil((date.getDate() + startOfMonth.getDay()) / 7)
  return `S${week}`
}

export interface ChartDataResult {
  chartData: Bucket[]
  totalChange: number
}

export function computeChartData(points: PointWithDate[], range: TimeRange): ChartDataResult {
  const buckets: Record<string, Bucket> = {}

  for (const p of points) {
    if (!p.date) continue
    const key = getBucketKey(p.date, range)
    if (!buckets[key]) {
      buckets[key] = {
        name: bucketLabel(p.date, range),
        sortKey: key,
        bajo: 0,
        medio: 0,
        alto: 0,
      }
    }
    const rl = p.riskLevel?.toLowerCase()
    if (rl === 'bajo' || rl === 'medio' || rl === 'alto') {
      buckets[key][rl]++
    }
  }

  const sorted = Object.values(buckets).sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2))
  const secondHalf = sorted.slice(Math.floor(sorted.length / 2))
  const firstTotal = firstHalf.reduce((s, b) => s + b.bajo + b.medio + b.alto, 0)
  const secondTotal = secondHalf.reduce((s, b) => s + b.bajo + b.medio + b.alto, 0)
  const change = firstTotal > 0 ? ((secondTotal - firstTotal) / firstTotal) * 100 : 0

  return { chartData: sorted, totalChange: change }
}
