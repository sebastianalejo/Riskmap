import { BookOpen, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, CardHeader } from '../ui/card'

const METRICS: { term: string; definition: ReactNode }[] = [
  {
    term: 'Incidentes',
    definition: 'Registros que cumplen los filtros activos. Cada registro equivale a una denuncia.',
  },
  {
    term: '% riesgo alto',
    definition:
      'Porcentaje de registros con nivel de riesgo alto. Se calcula solo sobre registros con nivel de riesgo válido.',
  },
  {
    term: 'Frecuencia histórica',
    definition:
      'Valor base de incidencia histórica de cada registro; el promedio por distrito resume su intensidad relativa.',
  },
  {
    term: '% nocturno',
    definition: 'Porcentaje de registros ocurridos entre las 22:00 y las 05:59.',
  },
  {
    term: 'Delito principal',
    definition: 'Tipo de delito con más registros en el distrito.',
  },
  {
    term: 'Fecha y hora',
    definition:
      'Combina los datos temporales disponibles de cada registro: año, día de la semana y hora. No es una fecha exacta.',
  },
  {
    term: 'Distrito más crítico',
    definition: 'Distrito con más registros tras aplicar los filtros.',
  },
  {
    term: 'Tasa por 100 000 hab.',
    definition:
      'Denuncias oficiales del periodo divididas por la población proyectada del distrito (INEI) y multiplicadas por 100 000. Permite comparar distritos de tamaños muy distintos.',
  },
]

const CAVEATS = [
  'Los datos provienen de denuncias registradas: existe subregistro y sesgo territorial. No equivalen a la criminalidad real de una zona.',
  'Los datos no incluyen la fecha exacta del hecho: solo el año, el día de la semana y la hora cuando están disponibles. Este módulo analiza esas variables y la frecuencia histórica; la tendencia mensual está en Resumen, con denuncias oficiales.',
  'Se analizan todos los datos publicados (años 2021-2024 y modalidades 2022), sin duplicados.',
  'Los distritos se agrupan al cargar los datos; los registros incompletos aparecen como «Sin distrito» o «Sin tipo».',
  'El «Contexto por distrito» y las «Series de contexto» usan otras fuentes oficiales (población proyectada del INEI, denuncias SIDPOL y delitos del MPFN); son cifras agregadas de contraste, no registros individuales.',
  'Las exportaciones respetan los filtros activos en el momento de la descarga.',
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
