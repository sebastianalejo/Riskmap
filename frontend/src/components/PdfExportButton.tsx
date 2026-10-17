import { IncidentTrendChart } from './IncidentTrendChart'
import { Card, CardHeader } from './ui/card'
import { simulateDates } from '../utils/simulateDates'
import { RANGE_OPTIONS } from '../utils/chartData'
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
    <Card className="p-4 sm:p-5">
      <CardHeader
        title="Tendencia de incidentes"
        description="Serie de demostración usada en el reporte PDF."
      />
      <div className="mt-4">
        <IncidentTrendChart points={datedPoints} range={range} />
      </div>
    </Card>
  )
}
