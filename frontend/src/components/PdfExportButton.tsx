import { IncidentTrendChart } from './IncidentTrendChart'
import { simulateDates } from '../utils/simulateDates'
import { RANGE_OPTIONS } from './PdfExportControls'
import type { TimeRange } from '../utils/chartData'
import type { MapPoint } from '../hooks/useCrimeIncidentsForMap'

interface Props {
  points: MapPoint[]
  range: TimeRange
}

export function PdfExportButton({ points, range }: Props) {
  const rangeOpt = RANGE_OPTIONS.find((o) => o.value === range)!
  const datedPoints = simulateDates(points, rangeOpt.days)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">
        Tendencia de incidentes
      </h3>
      <IncidentTrendChart points={datedPoints} range={range} />
    </div>
  )
}
