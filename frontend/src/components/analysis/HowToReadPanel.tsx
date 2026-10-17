import { BookOpen, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, CardHeader } from '../ui/card'

const METRICS: { term: string; definition: ReactNode }[] = [
  {
    term: 'Incidentes',
    definition: 'Registros que cumplen los filtros activos. Cada registro equivale a una denuncia del dataset.',
  },
  {
    term: '% riesgo alto',
    definition:
      'Porcentaje de registros con risk_level = alto. Se calcula solo sobre registros con nivel de riesgo válido.',
  },
  {
    term: 'Frecuencia histórica (historical_frequency)',
    definition:
      'Valor base de incidencia histórica que trae el dataset para cada registro; el promedio por distrito resume su intensidad relativa.',
  },
  {
    term: '% nocturno',
    definition: 'Porcentaje de registros ocurridos entre las 22:00 y las 05:59, según el campo hour.',
  },
  {
    term: 'Delito principal',
    definition: 'Tipo de delito con más registros en el distrito (moda del campo crime_type).',
  },
  {
    term: 'Fecha y hora',
    definition:
      'Combina los campos temporales disponibles de cada registro: año (occurred_year, esquema INEI), día de la semana (day_of_week) y hora (hour). No es una fecha exacta.',
  },
  {
    term: 'Distrito más crítico',
    definition: 'Distrito con más registros tras aplicar los filtros.',
  },
]

const CAVEATS = [
  'Los datos provienen de denuncias registradas: existe subregistro y sesgo territorial. No equivalen a la criminalidad real de una zona.',
  'El dataset no incluye la fecha exacta del hecho: solo el año (INEI), el día de la semana y la hora cuando están disponibles. Este módulo analiza esas variables y la frecuencia histórica; no series temporales (la tendencia mensual real vive en Resumen, con datos SIDPOL).',
  'Se analiza el dataset publicado completo (`crime_incidents`: INEI 2021-2024 + puntos 2022, IDs deterministas y sin duplicados).',
  'Los distritos se canonicalizan en la ingesta (ámbito Lima/Callao); los registros incompletos aparecen como «Sin distrito» o «Sin tipo».',
  'Las exportaciones (CSV/PDF) respetan los filtros activos en el momento de la descarga.',
]

/** Bloque metodológico: definiciones y advertencias del módulo. */
export function HowToReadPanel() {
  return (
    <Card className="p-5">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <BookOpen className="size-4 text-accent" aria-hidden />
            Cómo leer este panel
          </span>
        }
        description="Definiciones de cada métrica y límites de los datos, para evitar conclusiones incorrectas."
      />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="analysis-metrics-heading">
          <h3
            id="analysis-metrics-heading"
            className="text-[11px] font-semibold uppercase tracking-wide text-content-muted"
          >
            Definición de métricas
          </h3>
          <dl className="mt-3 space-y-2.5">
            {METRICS.map((metric) => (
              <div key={metric.term} className="rounded-xl bg-surface-2 px-3 py-2.5">
                <dt className="text-[13px] font-semibold text-content-primary">{metric.term}</dt>
                <dd className="mt-0.5 text-[13px] leading-relaxed text-content-secondary">
                  {metric.definition}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="analysis-caveats-heading">
          <h3
            id="analysis-caveats-heading"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted"
          >
            <TriangleAlert className="size-3.5 text-risk-medio" aria-hidden />
            Advertencias sobre los datos
          </h3>
          <ul className="mt-3 space-y-2.5">
            {CAVEATS.map((caveat) => (
              <li
                key={caveat}
                className="flex items-start gap-2.5 rounded-xl border border-line-subtle px-3 py-2.5 text-[13px] leading-relaxed text-content-secondary"
              >
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-risk-medio" aria-hidden />
                {caveat}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Card>
  )
}
