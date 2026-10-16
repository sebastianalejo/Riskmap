"""Carga diferida de `crime_ml`.

El descubrimiento de Cloud Functions tiene un límite de ~10 segundos: importar
`crime_ml` no debe arrastrar pandas/sklearn (los carga `pipeline` solo cuando
alguien hace `crime_ml.FEATURES`, `crime_ml.TARGET` o `crime_ml.CrimeRiskPipelineCore`).
"""

__all__ = ["CrimeRiskPipelineCore", "FEATURES", "TARGET"]


def __getattr__(name: str):
    if name in __all__:
        from crime_ml import pipeline

        return getattr(pipeline, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
