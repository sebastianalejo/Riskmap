import { useState } from 'react'
import { FileDown } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { Button } from './ui/button'
import {
  halfPeriodChange,
  MODALITY_ORDER,
  MODALITY_RGB,
  MODALITY_SHORT,
  MONTH_OPTIONS,
  type SeriesPoint,
} from '../utils/monthlyStats'
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
  months: number
  onMonthsChange: (months: number) => void
  series: SeriesPoint[]
}

export function PdfExportControls({
  points,
  allPointsCount,
  stats,
  crimeFilter,
  districtFilter,
  hourLabel,
  riskLabels,
  months,
  onMonthsChange,
  series,
}: Props) {
  const [exporting, setExporting] = useState(false)

  const rangeOpt = MONTH_OPTIONS.find((option) => option.value === months)!
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
        { label: `Tendencia: ${rangeOpt.label}`, col: 0, row: 0 },
        { label: `Riesgo: ${riskLabels || 'Todos'}`, col: 0, row: 1 },
        { label: `Delito: ${crimeFilter || 'Todos'}`, col: 0, row: 2 },
        { label: `Distrito: ${districtFilter || 'Todos'}`, col: 1, row: 0 },
        { label: `Hora: ${hourLabel}`, col: 1, row: 1 },
        { label: 'Fuente: SIDPOL (MININTER)', col: 1, row: 2 },
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
      doc.text(`Tendencia real de denuncias — ${rangeOpt.label.toLowerCase()}`, 14, y)
      y += 4
      doc.setFontSize(7)
      doc.setTextColor(100)
      doc.text('Serie mensual SIDPOL (MININTER), Lima Metropolitana y Callao.', 14, y + 2)
      y += 4

      const totalChange = halfPeriodChange(series)
      const chartLeft = 20
      const chartRight = pw - 14
      const chartTop = y + 6
      const chartBottom = y + 86
      const chartW = chartRight - chartLeft
      const chartH = chartBottom - chartTop

      if (series.length > 0) {
        const maxTotal = Math.max(...series.map((point) => point.total), 1)
        const barCount = series.length
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

        for (let idx = 0; idx < series.length; idx++) {
          const point = series[idx]
          const x = chartLeft + idx * (barW + barGap)
          let accumulated = 0
          for (const modality of MODALITY_ORDER) {
            const val = point.byModality[modality] ?? 0
            if (val <= 0) continue
            const h = (val / maxTotal) * chartH
            const by = chartBottom - accumulated - h
            const [r, g, b] = MODALITY_RGB[modality]
            doc.setFillColor(r, g, b)
            doc.rect(x, by, barW, Math.max(h, 1), 'F')
            accumulated += h
          }
        }

        const labelSkip = Math.max(1, Math.floor(barCount / 10))
        doc.setFontSize(6)
        doc.setTextColor(120)
        for (let idx = 0; idx < series.length; idx++) {
          if (idx % labelSkip !== 0 && idx !== series.length - 1) continue
          const x = chartLeft + idx * (barW + barGap) + barW / 2
          doc.text(series[idx].label, x, chartBottom + 3, { align: 'center' })
        }

        const trendUp = totalChange >= 0
        doc.setFontSize(9)
        doc.setTextColor(trendUp ? 220 : 22, trendUp ? 38 : 163, trendUp ? 38 : 74)
        const trendLabel = `${trendUp ? '↑ +' : '↓ '}${Math.abs(totalChange).toFixed(0)}%`
        doc.text(trendLabel, chartRight, chartTop - 2, { align: 'right' })

        doc.setFontSize(6)
        doc.setTextColor(120)
        let lx = chartLeft
        for (const modality of MODALITY_ORDER) {
          const [r, g, b] = MODALITY_RGB[modality]
          doc.setFillColor(r, g, b)
          doc.rect(lx, chartBottom + 6, 3.5, 3.5, 'F')
          doc.text(MODALITY_SHORT[modality], lx + 5, chartBottom + 9.5)
          lx += 24
        }
      } else {
        doc.setFontSize(10)
        doc.setTextColor(150)
        doc.text('No hay datos de la serie SIDPOL para mostrar.', pw / 2, chartTop + chartH / 2, { align: 'center' })
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
        value={months}
        onChange={(e) => onMonthsChange(Number(e.target.value))}
        aria-label="Periodo de la tendencia"
        className="h-8 rounded-xl border border-line-subtle bg-surface-2 px-2.5 text-xs text-content-primary outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/25"
      >
        {MONTH_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <Button size="sm" onClick={handleExport} disabled={!hasData} loading={exporting}>
        {!exporting && <FileDown className="size-3.5" aria-hidden />}
        {exporting ? 'Generando…' : 'Descargar PDF'}
      </Button>
    </div>
  )
}
