import { Eraser, SlidersHorizontal } from 'lucide-react'
import {
  HOUR_RANGE_OPTIONS,
  RISK_LABELS,
  RISK_LEVELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  createDefaultFilters,
  countActiveFilters,
  type AnalysisFilters,
  type RiskLevel,
} from '../../utils/analysis'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardHeader } from '../ui/card'
import { Label, Select } from '../ui/input'

const RISK_CHIP_ACTIVE: Record<RiskLevel, string> = {
  alto: 'bg-risk-alto-soft text-risk-alto ring-risk-alto/60',
  medio: 'bg-risk-medio-soft text-risk-medio ring-risk-medio/60',
  bajo: 'bg-risk-bajo-soft text-risk-bajo ring-risk-bajo/60',
}
const RISK_CHIP_IDLE =
  'text-content-muted ring-line-subtle hover:text-content-secondary hover:ring-line-strong'

interface Props {
  filters: AnalysisFilters
  districts: string[]
  crimeTypes: string[]
  onChange: (filters: AnalysisFilters) => void
}

export function AnalysisFiltersPanel({ filters, districts, crimeTypes, onChange }: Props) {
  const activeCount = countActiveFilters(filters)

  function toggleRisk(level: RiskLevel) {
    const risks = filters.risks.includes(level)
      ? filters.risks.filter((r) => r !== level)
      : [...filters.risks, level]
    onChange({ ...filters, risks })
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-accent" aria-hidden />
              Filtros de análisis
            </span>
          }
          description="Todo el panel (KPIs, gráficos, tabla y exportación) responde a esta selección."
        />
        <div className="flex items-center gap-2">
          {activeCount > 0 && <Badge tone="accent">{activeCount} filtro(s) activo(s)</Badge>}
          <Button
            variant="ghost"
            size="sm"
            disabled={activeCount === 0}
            onClick={() => onChange(createDefaultFilters())}
          >
            <Eraser className="size-4" aria-hidden />
            Limpiar
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <Label htmlFor="analysis-district">Distrito</Label>
          <Select
            id="analysis-district"
            value={filters.district}
            onChange={(event) => onChange({ ...filters, district: event.target.value })}
          >
            <option value="">Todos los distritos</option>
            {districts.map((district) => (
              <option key={district} value={district}>
                {district}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="analysis-crime">Tipo de delito</Label>
          <Select
            id="analysis-crime"
            value={filters.crimeType}
            onChange={(event) => onChange({ ...filters, crimeType: event.target.value })}
          >
            <option value="">Todos los tipos</option>
            {crimeTypes.map((crimeType) => (
              <option key={crimeType} value={crimeType}>
                {crimeType}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="analysis-day">Día de la semana</Label>
          <Select
            id="analysis-day"
            value={filters.dayOfWeek}
            onChange={(event) => onChange({ ...filters, dayOfWeek: event.target.value })}
          >
            <option value="">Todos los días</option>
            {WEEKDAYS.map((day) => (
              <option key={day} value={day}>
                {WEEKDAY_LABELS[day]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="analysis-hour">Franja horaria</Label>
          <Select
            id="analysis-hour"
            value={filters.hourRange}
            onChange={(event) => onChange({ ...filters, hourRange: Number(event.target.value) })}
          >
            {HOUR_RANGE_OPTIONS.map((option, index) => (
              <option key={option.label} value={index}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-1.5 text-[13px] font-medium text-content-secondary">Nivel de riesgo</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Nivel de riesgo">
          {RISK_LEVELS.map((level) => {
            const active = filters.risks.includes(level)
            return (
              <button
                key={level}
                type="button"
                aria-pressed={active}
                onClick={() => toggleRisk(level)}
                className={[
                  'rounded-full px-3 py-1 text-xs font-semibold ring-1 transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  active ? RISK_CHIP_ACTIVE[level] : RISK_CHIP_IDLE,
                ].join(' ')}
              >
                {RISK_LABELS[level]}
              </button>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
