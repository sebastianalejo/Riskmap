import { useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { simulateDates, SIMULATED_DATES_NOTICE } from '../utils/simulateDates'
import { computeChartData, RANGE_OPTIONS } from '../utils/chartData'
import type { TimeRange } from '../utils/chartData'
import type { MapPoint } from '../hooks/useCrimeIncidentsForMap'
import type { Stats } from '../pages/MapPage'

const BAR_RGB: Record<string, [number, number, number]> = {
  bajo: [22, 163, 74],
  medio: [234, 88, 12],
  alto: [220, 38, 38],
}

interface Props {
  points: MapPoint[]
  allPointsCount: number
  stats: Stats
  crimeFilter: string
  districtFilter: string
  hourLabel: string
  riskLabels: string
  range: TimeRange
  onRangeChange: (r: TimeRange) => void
}

export function PdfExportControls({
  points,
  allPointsCount,
  stats,
  crimeFilter,
  districtFilter,
  hourLabel,
  riskLabels,
  range,
  onRangeChange,
}: Props) {
  const [exporting, setExporting] = useState(false)

  const rangeOpt = RANGE_OPTIONS.find((o) => o.value === range)!
  const datedPoints = simulateDates(points, rangeOpt.days)
  const hasData = points.length > 0

  async function handleExport() {
    setExporting(true)
    try {
      const doc = new jsPDF('p', 'mm', 'a4')
      const pw = doc.internal.pageSize.getWidth()
      let y = 20

      doc.setFontSize(18)
      doc.setTextColor(30)
      doc.text('Reporte de Mapa de Riesgo Criminal', pw / 2, y, { align: 'center' })
      y += 7

      doc.setFontSize(10)
      doc.setTextColor(100)
      const dateStr = new Date().toLocaleDateString('es-PE')
      doc.text(`Lima Metropolitana — ${dateStr}`, pw / 2, y, { align: 'center' })
      y += 12

      doc.setDrawColor(200)
      doc.setFillColor(248, 250, 252)
      doc.roundedRect(14, y, pw - 28, 28, 3, 3, 'FD')
      doc.setFontSize(11)
      doc.setTextColor(30)
      doc.text('Filtros aplicados', 20, y + 7)
      doc.setFontSize(9)
      doc.setTextColor(80)
      const filterItems = [
        { label: `Rango: ${rangeOpt.label}`, col: 0, row: 0 },
        { label: `Riesgo: ${riskLabels || 'Todos'}`, col: 0, row: 1 },
        { label: `Delito: ${crimeFilter || 'Todos'}`, col: 0, row: 2 },
        { label: `Distrito: ${districtFilter || 'Todos'}`, col: 1, row: 0 },
        { label: `Hora: ${hourLabel}`, col: 1, row: 1 },
      ]
      for (const f of filterItems) {
        const fx = f.col === 0 ? 20 : pw / 2
        doc.text(f.label, fx, y + 17 + f.row * 5)
      }
      y += 34

      doc.setFontSize(13)
      doc.setTextColor(30)
      doc.text('Estadísticas', 14, y)
      y += 8

      const statKeys = ['alto', 'medio', 'bajo'] as const
      const boxW = (pw - 28 - 12) / 5
      for (let i = 0; i < statKeys.length; i++) {
        const key = statKeys[i]
        const sx = 14 + i * (boxW + 3)
        const [r, g, b] = BAR_RGB[key]
        doc.setDrawColor(r, g, b)
        doc.setFillColor(255, 255, 255)
        doc.roundedRect(sx, y, boxW, 22, 2, 2, 'FD')
        doc.setFillColor(r, g, b)
        doc.rect(sx + boxW / 2 - 2, y + 3, 4, 4, 'F')
        doc.setFontSize(14)
        doc.setTextColor(30)
        doc.text(String(stats[key]), sx + boxW / 2, y + 16, { align: 'center' })
        doc.setFontSize(7)
        doc.setTextColor(100)
        doc.text(key.toUpperCase(), sx + boxW / 2, y + 20, { align: 'center' })
      }

      const visX = 14 + 3 * (boxW + 3)
      doc.setDrawColor(200)
      doc.roundedRect(visX, y, boxW, 22, 2, 2, 'D')
      doc.setFontSize(14)
      doc.setTextColor(30)
      doc.text(String(points.length), visX + boxW / 2, y + 16, { align: 'center' })
      doc.setFontSize(7)
      doc.setTextColor(100)
      doc.text('VISIBLES', visX + boxW / 2, y + 20, { align: 'center' })

      const totX = 14 + 4 * (boxW + 3)
      doc.roundedRect(totX, y, boxW, 22, 2, 2, 'D')
      doc.setFontSize(14)
      doc.setTextColor(30)
      doc.text(String(allPointsCount), totX + boxW / 2, y + 16, { align: 'center' })
      doc.setFontSize(7)
      doc.setTextColor(100)
      doc.text('TOTAL', totX + boxW / 2, y + 20, { align: 'center' })

      y += 28

      doc.setFontSize(13)
      doc.setTextColor(30)
      doc.text(`Tendencia — últimos ${rangeOpt.label.toLowerCase()}`, 14, y)
      y += 4
      doc.setFontSize(7)
      doc.setTextColor(180, 120, 20)
      doc.text(SIMULATED_DATES_NOTICE, 14, y + 2)
      y += 4

      const { chartData, totalChange } = computeChartData(datedPoints, range)
      const chartLeft = 20
      const chartRight = pw - 14
      const chartTop = y + 6
      const chartBottom = y + 86
      const chartW = chartRight - chartLeft
      const chartH = chartBottom - chartTop

      if (chartData.length > 0) {
        const maxTotal = Math.max(...chartData.map((d) => d.bajo + d.medio + d.alto), 1)
        const barCount = chartData.length
        const barGap = 1.5
        const barW = Math.max(2, (chartW - barGap * (barCount - 1)) / barCount)
        const yTicks = 4

        doc.setDrawColor(200)
        doc.setFontSize(7)
        doc.setTextColor(120)
        for (let i = 0; i <= yTicks; i++) {
          const val = Math.round((maxTotal / yTicks) * i)
          const ly = chartBottom - (val / maxTotal) * chartH
          doc.line(chartLeft, ly, chartRight, ly)
          doc.text(String(val), chartLeft - 2, ly + 2, { align: 'right' })
        }

        const barKeys = ['bajo', 'medio', 'alto'] as const
        for (let idx = 0; idx < chartData.length; idx++) {
          const d = chartData[idx]
          const x = chartLeft + idx * (barW + barGap)
          let accumulated = 0
          for (const key of barKeys) {
            const val = d[key]
            if (val === 0) continue
            const h = (val / maxTotal) * chartH
            const by = chartBottom - accumulated - h
            const [r, g, b] = BAR_RGB[key]
            doc.setFillColor(r, g, b)
            doc.rect(x, by, barW, Math.max(h, 1), 'F')
            accumulated += h
          }
        }

        const labelSkip = Math.max(1, Math.floor(barCount / 10))
        doc.setFontSize(6)
        doc.setTextColor(120)
        for (let idx = 0; idx < chartData.length; idx++) {
          if (idx % labelSkip !== 0 && idx !== chartData.length - 1) continue
          const x = chartLeft + idx * (barW + barGap) + barW / 2
          doc.text(chartData[idx].name, x, chartBottom + 3, { align: 'center' })
        }

        const trendUp = totalChange >= 0
        doc.setFontSize(9)
        doc.setTextColor(trendUp ? 220 : 22, trendUp ? 38 : 163, trendUp ? 38 : 74)
        const trendLabel = `${trendUp ? '↑ +' : '↓ '}${Math.abs(totalChange).toFixed(0)}%`
        doc.text(trendLabel, chartRight, chartTop - 2, { align: 'right' })

        doc.setFontSize(7)
        doc.setTextColor(120)
        let lx = chartLeft
        for (const key of barKeys) {
          const [r, g, b] = BAR_RGB[key]
          doc.setFillColor(r, g, b)
          doc.rect(lx, chartBottom + 6, 4, 4, 'F')
          doc.text(key.charAt(0).toUpperCase() + key.slice(1), lx + 6, chartBottom + 10)
          lx += 30
        }
      } else {
        doc.setFontSize(10)
        doc.setTextColor(150)
        doc.text('No hay datos suficientes para mostrar la tendencia.', pw / 2, chartTop + chartH / 2, { align: 'center' })
      }

      doc.save('reporte-riesgo-criminal.pdf')
    } catch (err) {
      console.error('Error al generar PDF:', err)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={range}
        onChange={(e) => onRangeChange(e.target.value as TimeRange)}
        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
      >
        {RANGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        onClick={handleExport}
        disabled={!hasData || exporting}
        className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {exporting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileDown className="size-4" />
        )}
        {exporting ? 'Generando…' : 'Descargar PDF'}
      </button>
    </div>
  )
}
