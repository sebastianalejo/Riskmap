import { Download, FileText } from 'lucide-react'
import { useState } from 'react'
import { jsPDF } from 'jspdf'
import type { AnalysisIncident } from '../../hooks/useIncidentsForAnalysis'
import {
  HOUR_RANGE_OPTIONS,
  RISK_LABELS,
  RISK_LEVELS,
  WEEKDAY_LABELS,
  buildDistrictTable,
  computeOverview,
  countByCrimeType,
  districtRowsToCsv,
  formatDecimal,
  formatInt,
  formatPercent,
  truncateLabel,
  type AnalysisFilters,
} from '../../utils/analysis'
import { Button } from '../ui/button'
import { useToast } from '../ui/toast'

function filterSummary(filters: AnalysisFilters): { label: string; value: string }[] {
  const hourLabel = HOUR_RANGE_OPTIONS[filters.hourRange]?.label ?? 'Todas las horas'
  const risks =
    filters.risks.length === RISK_LEVELS.length
      ? 'Todos'
      : filters.risks.map((level) => RISK_LABELS[level]).join(', ') || 'Ninguno'
  return [
    { label: 'Distrito', value: filters.district || 'Todos' },
    { label: 'Tipo de delito', value: filters.crimeType || 'Todos' },
    { label: 'Día', value: filters.dayOfWeek ? WEEKDAY_LABELS[filters.dayOfWeek] : 'Todos' },
    { label: 'Franja', value: hourLabel },
    { label: 'Riesgo', value: risks },
  ]
}

function buildPdf(incidents: AnalysisIncident[], filters: AnalysisFilters): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pw = doc.internal.pageSize.getWidth()
  const margin = 14
  let y = 18

  /* Título */
  doc.setFontSize(16)
  doc.setTextColor(30)
  doc.setFont('helvetica', 'bold')
  doc.text('Reporte de análisis de incidentes', pw / 2, y, { align: 'center' })
  y += 6
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100)
  doc.text(
    `Lima Metropolitana — ${new Date().toLocaleDateString('es-PE')} · Firestore crime_incidents`,
    pw / 2,
    y,
    { align: 'center' },
  )
  y += 9

  /* Filtros aplicados */
  doc.setDrawColor(200)
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(margin, y, pw - margin * 2, 24, 3, 3, 'FD')
  doc.setFontSize(10)
  doc.setTextColor(30)
  doc.setFont('helvetica', 'bold')
  doc.text('Filtros aplicados', margin + 6, y + 6.5)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  filterSummary(filters).forEach((item, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = column === 0 ? margin + 6 : pw / 2 + 2
    doc.text(`${item.label}: ${item.value}`, x, y + 13 + row * 4.6)
  })
  y += 31

  /* KPIs */
  const overview = computeOverview(incidents)
  const kpis: { label: string; value: string }[] = [
    { label: 'Incidentes', value: formatInt(overview.total) },
    { label: 'Distritos', value: formatInt(overview.districts) },
    { label: '% riesgo alto', value: formatPercent(overview.pctAlto) },
    {
      label: 'Frec. promedio',
      value: overview.avgFrequency === null ? '—' : formatDecimal(overview.avgFrequency, 0),
    },
  ]
  const boxGap = 3
  const boxW = (pw - margin * 2 - boxGap * (kpis.length - 1)) / kpis.length
  kpis.forEach((kpi, index) => {
    const x = margin + index * (boxW + boxGap)
    doc.setDrawColor(200)
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(x, y, boxW, 20, 2, 2, 'FD')
    doc.setFontSize(13)
    doc.setTextColor(30)
    doc.text(kpi.value, x + boxW / 2, y + 12, { align: 'center' })
    doc.setFontSize(7)
    doc.setTextColor(100)
    doc.text(kpi.label.toUpperCase(), x + boxW / 2, y + 17, { align: 'center' })
  })
  y += 27

  /* Líderes */
  doc.setFontSize(11)
  doc.setTextColor(30)
  doc.setFont('helvetica', 'bold')
  doc.text('Tipos de delito más frecuentes', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  countByCrimeType(incidents, 5).forEach((row, index) => {
    doc.setTextColor(30)
    doc.text(`${index + 1}. ${truncateLabel(row.name, 42)}`, margin + 2, y)
    doc.setTextColor(90)
    doc.text(
      `${formatInt(row.count)} (${formatPercent(row.pct)})`,
      pw / 2,
      y,
    )
    y += 4.6
  })
  y += 4

  doc.setFontSize(11)
  doc.setTextColor(30)
  doc.setFont('helvetica', 'bold')
  doc.text('Distritos con más registros (filtrados)', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const districts = buildDistrictTable(incidents)
  districts.slice(0, 5).forEach((row, index) => {
    doc.setTextColor(30)
    doc.text(`${index + 1}. ${truncateLabel(row.district, 42)}`, margin + 2, y)
    doc.setTextColor(90)
    doc.text(
      `${formatInt(row.incidents)} registros · ${formatPercent(row.pctAlto)} alto`,
      pw / 2,
      y,
    )
    y += 4.6
  })
  y += 6

  /* Tabla comparativa (hasta donde quepa en la página) */
  doc.setFontSize(11)
  doc.setTextColor(30)
  doc.setFont('helvetica', 'bold')
  doc.text(`Comparación por distrito (${formatInt(districts.length)})`, margin, y)
  y += 5

  const colX = { district: margin, incidents: 100, pctAlto: 118, pctNight: 136, freq: 156, crime: 161 }
  const headerY = y
  doc.setFontSize(7.5)
  doc.setTextColor(100)
  doc.text('DISTRITO', colX.district, headerY)
  doc.text('INC.', colX.incidents, headerY, { align: 'right' })
  doc.text('% ALTO', colX.pctAlto, headerY, { align: 'right' })
  doc.text('% NOC.', colX.pctNight, headerY, { align: 'right' })
  doc.text('FREC.', colX.freq, headerY, { align: 'right' })
  doc.text('DELITO PRINCIPAL', colX.crime, headerY)
  y += 2
  doc.setDrawColor(210)
  doc.line(margin, y, pw - margin, y)
  y += 3.6

  const rowHeight = 5
  const maxRows = Math.max(0, Math.floor((280 - y) / rowHeight))
  const visibleRows = districts.slice(0, maxRows)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  for (const row of visibleRows) {
    doc.setTextColor(40)
    doc.text(truncateLabel(row.district, 30), colX.district, y + 0.5)
    doc.text(formatInt(row.incidents), colX.incidents, y + 0.5, { align: 'right' })
    doc.text(formatPercent(row.pctAlto), colX.pctAlto, y + 0.5, { align: 'right' })
    doc.text(formatPercent(row.pctNight), colX.pctNight, y + 0.5, { align: 'right' })
    doc.text(
      row.avgFrequency === null ? '—' : formatDecimal(row.avgFrequency, 0),
      colX.freq,
      y + 0.5,
      { align: 'right' },
    )
    doc.setTextColor(80)
    doc.text(truncateLabel(row.topCrime ?? '—', 20), colX.crime, y + 0.5)
    y += rowHeight
  }
  if (districts.length > visibleRows.length) {
    doc.setTextColor(120)
    doc.setFontSize(7.5)
    doc.text(
      `Se muestran ${formatInt(visibleRows.length)} de ${formatInt(districts.length)} distritos en este reporte.`,
      margin,
      y + 2,
    )
    y += 6
  }

  /* Pie */
  doc.setFontSize(7.5)
  doc.setTextColor(120)
  const footer = [
    'Los registros corresponden a denuncias (subregistro y sesgo territorial).',
    'El dataset no incluye la fecha del hecho: este reporte analiza hora, día de la semana y frecuencia histórica.',
    `Generado con RiskMap · ${new Date().toLocaleString('es-PE')}`,
  ]
  footer.forEach((line, index) => {
    doc.text(line, margin, 288 + index * 3.4)
  })

  return doc
}

interface Props {
  incidents: AnalysisIncident[]
  filters: AnalysisFilters
}

export function AnalysisExportButtons({ incidents, filters }: Props) {
  const { toast } = useToast()
  const [pdfBusy, setPdfBusy] = useState(false)
  const disabled = incidents.length === 0

  function handleCsv() {
    try {
      const rows = buildDistrictTable(incidents)
      // BOM para que Excel reconozca UTF-8 (tildes y «ó» de los encabezados).
      const blob = new Blob([`\uFEFF${districtRowsToCsv(rows)}`], {
        type: 'text/csv;charset=utf-8;',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `analisis-distritos-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
      toast({
        title: 'CSV exportado',
        description: `${formatInt(rows.length)} distrito(s) con los filtros aplicados.`,
        variant: 'success',
      })
    } catch (e) {
      toast({
        title: 'No se pudo exportar el CSV',
        description: e instanceof Error ? e.message : 'Error inesperado',
        variant: 'error',
      })
    }
  }

  function handlePdf() {
    setPdfBusy(true)
    try {
      const doc = buildPdf(incidents, filters)
      doc.save(`analisis-incidentes-${new Date().toISOString().slice(0, 10)}.pdf`)
      toast({
        title: 'PDF exportado',
        description: 'Resumen analítico con los filtros aplicados.',
        variant: 'success',
      })
    } catch (e) {
      toast({
        title: 'No se pudo exportar el PDF',
        description: e instanceof Error ? e.message : 'Error inesperado',
        variant: 'error',
      })
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={handleCsv} disabled={disabled}>
        <Download className="size-4" aria-hidden />
        CSV
      </Button>
      <Button variant="primary" onClick={handlePdf} disabled={disabled} loading={pdfBusy}>
        <FileText className="size-4" aria-hidden />
        PDF
      </Button>
    </div>
  )
}
