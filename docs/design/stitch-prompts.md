# Stitch — Prompts para el rediseño de RiskMap

Guía para generar el rediseño «centro de operaciones» en **Google Stitch** (`stitch.withgoogle.com`).

## Cómo usarlos

1. Inicia sesión en Stitch con tu cuenta Google y crea un proyecto **Web** llamado `RISKMAP Ops`
   (idioma sugerido: español; si genera en inglés, pídele: *"Traduce toda la interfaz al español"*).
2. Pega primero el **Prompt global** para fijar el sistema de diseño.
3. Genera cada pantalla con su prompt, **adjuntando una captura de la pantalla actual** como
   referencia (para conservar la funcionalidad real).
4. Itera con correcciones cortas y específicas (ver § Recetas de iteración).
5. Al terminar, **exporta**: `DESIGN.md` del proyecto + cada pantalla (HTML/Tailwind y PNG)
   y tráelos al repo. La implementación se hace en `frontend/` con Tailwind 4.

> El sistema visual completo está en [`DESIGN.md`](./DESIGN.md). Estos prompts ya lo resumen;
> si Stitch permite "design system", carga ahí el contenido de ese archivo.

---

## Prompt global (pegar primero)

```
Diseña RiskMap: un panel web profesional de predicción y monitoreo de riesgo criminal para
Lima Metropolitana (Perú), tipo "centro de operaciones" (sala de control). Lo usan analistas
que cargan datos, filtran un mapa de incidentes, calculan predicciones y exportan reportes PDF.
Toda la interfaz va en español.

ESTILO — dark-first, sobrio y técnico:
- Fondo de página #060B17; tarjetas #0C1425; elementos elevados/hover/inputs #131E33.
- Bordes sutiles rgba(148,163,184,0.16); nunca líneas duras.
- Texto principal #E9EEF8; secundario #A6B4CC; metadatos #6C7A94.
- Acento teal: #2DD4BF para texto/iconos/navegación activa; #14B8A6 para botón primario
  con texto #042F2E y un glow suave; fondos translúcidos teal al 12%.
- Semántica de riesgo (única familia de color fuerte): bajo #34D399, medio #FB923C, alto #F87171,
  siempre con etiqueta textual además del color.
- Tipografía: DM Sans para UI; JetBrains Mono para cifras, coordenadas y etiquetas técnicas.
- Radios: tarjetas 16px, controles 12px, chips tipo píldora. Densidad media, mucho aire entre tarjetas.
- Sensación: consola de monitoreo estable y confiable, sin degradados llamativos ni decoración.

ESTRUCTURA GENERAL (común a todas las pantallas):
- Sidebar fija de 264px con logo RiskMap (icono de radar/escudo), navegación
  (Resumen, Predicción, Mapa de riesgo, Importar datos) con el ítem activo resaltado en teal,
  y al pie el usuario + botón "Cerrar sesión".
- Header de 56px translúcido con blur: título de la página, acciones contextuales,
  botón de tema claro/oscuro (sol/luna) y usuario en móvil.
- Contenido con ancho máximo 1400px.

Resolución objetivo: escritorio 1440×900, con adaptación móvil razonable.
```

---

## Pantalla 1 — Login (`/login`)

```
Pantalla de acceso a RiskMap (panel oscuro tipo centro de operaciones).

- Fondo #060B17 con un halo radial teal muy sutil arriba y una textura apenas perceptible.
- Botón sol/luna en la esquina superior derecha (toggle de tema).
- Tarjeta central (máx. 420px) fondo #0C1425, borde rgba(148,163,184,0.16), radio 16px:
  - Logo: icono de radar dentro de un cuadro teal con glow suave.
  - Título "Acceso al panel"; subtítulo "Usuario de Firebase Authentication (correo y contraseña)".
  - Campo "Correo" con icono de usuario; campo "Contraseña" con icono de candado y botón
    de ojo para mostrar/ocultar.
  - Botón primario de ancho completo "Entrar" (teal #14B8A6, texto #042F2E, glow).
  - Estado de error: caja roja translúcida con icono de alerta y mensaje
    "Correo o contraseña incorrectos".
  - Estado de carga del botón: spinner + "Entrando…".
```

---

## Pantalla 2 — Resumen (`/`)

```
Dashboard principal de RiskMap (panel oscuro tipo centro de operaciones).

- Header: título "Resumen" + fecha del día; a la derecha botones "Ver mapa" (primario)
  e "Importar datos" (secundario).
- Fila de 4 tarjetas KPI (fondo #0C1425, radio 16px):
  1) "Incidentes cargados" — cifra grande en JetBrains Mono (ej. 1 234) con chip "Base de datos".
  2) "Riesgo alto" — 42 % con conteo "520 puntos", icono en caja roja translúcida.
  3) "Distrito más crítico" — "LA VICTORIA" + conteo.
  4) "Tendencia 7 días" — chip ↑ +12 % en naranja con cifra en mono.
- Fila principal (2/3 + 1/3):
  - "Tendencia de incidentes": gráfico de barras apiladas por nivel de riesgo
    (verde/naranja/rojo) con selector 7d/30d, rejilla muy tenue, ejes en #6C7A94.
  - "Distribución por riesgo": barras horizontales finas (Bajo/Medio/Alto) con porcentajes en mono,
    + lista "Top distritos" (5 filas: nombre, conteo, mini-barra).
- Fila inferior:
  - "Estado del sistema" (secundario, colapsado): base de datos conectada (punto verde),
    servicio de predicción no disponible (punto ámbar), versión.
  - "Acciones rápidas": 3 tarjetas pequeñas clicables (Predecir riesgo, Ver mapa, Importar datos)
    con icono, título y descripción de una línea.
- Estado de carga: skeletons con la forma de las tarjetas y del gráfico.
- Estado sin datos: tarjeta centrada con icono, "Sin registros todavía" y botón "Importar datos".
```

---

## Pantalla 3 — Predicción (`/prediccion`)

```
Pantalla de predicción de riesgo de RiskMap (panel oscuro).

- Header: "Predicción de riesgo" + descripción corta.
- Dos columnas (3/5 y 2/5):
  - IZQUIERDA — tarjeta "Escenario" (fondo #0C1425):
    - Select "Tipo de delito" (robo, hurto, etc.).
    - Chips seleccionables para "Franja horaria" (Madrugada/Mañana/Tarde/Noche) + slider de hora
      con valor en mono (22:00).
    - Select "Día de la semana".
    - Select "Distrito" con coordenadas en mono debajo (Lat, Lng, editables).
    - Slider "Frecuencia histórica" con etiquetas 1 (baja) / 500 (muy alta).
    - Botón primario "Predecir riesgo" con icono de chispa; estado de carga con spinner
      "Calculando…".
  - DERECHA — tarjeta "Resultado":
    - Estado vacío: icono + "Completa el escenario y pulsa Predecir riesgo".
    - Resultado: panel "Riesgo ALTO" con fondo rojo translúcido y anillo de confianza circular
      (aro grueso con glow del color del riesgo, ej. 78 % y etiqueta "confianza").
    - "Distribución en 120 registros": barras horizontales Alto/Medio/Bajo con porcentajes en mono.
    - "Factores detectados": lista con viñetas e icono chevron (3-4 ítems).
    - Nota al pie pequeña: método usado (base de datos o estimación aproximada).
- Estado de carga: skeleton del panel de resultado.
```

---

## Pantalla 4 — Mapa de riesgo (`/mapa`)

```
Pantalla "Mapa de riesgo" de RiskMap (panel oscuro, ocupa el alto completo).

- Barra superior sobre el mapa: icono de pin, título "Mapa de riesgo criminal",
  "Lima Metropolitana", chip "Filtros activos" (cuando aplique), selector de rango 7d/30d,
  botón "Exportar PDF" (secundario) y contador a la derecha "320 / 1 000 puntos" en mono.
- Panel de filtros flotante a la izquierda (colapsable, fondo #0C1425 translúcido con blur):
  - "Nivel de riesgo": 3 chips toggle (Alto/Medio/Bajo) con sus colores.
  - "Tipo de delito": select; "Distrito": select.
  - "Franja horaria": 5 botones segmentados (Todas, Madrugada, Mañana, Tarde, Noche).
  - Botón "Limpiar filtros" (fantasma).
  - Leyenda al pie: puntos de color con conteos por nivel + "Visibles 320 / Total 1 000" en mono.
- Mapa oscuro (estilo nocturno) ocupando el resto: marcadores circulares con borde claro,
  colores de riesgo; marcadores azules para los datos con año; popup con tarjeta oscura
  (tipo de delito, distrito, coordenadas en mono, riesgo).
- Panel inferior colapsable "Tendencia de incidentes": gráfico de barras apiladas
  + botón "Exportar reporte PDF" con icono de descarga.
- En móvil: los filtros se abren en un drawer sobre el mapa.
```

---

## Pantalla 5 — Importar datos (`/datos`)

```
Pantalla "Datos importados" de RiskMap (panel oscuro).

- Header: "Datos importados" + columnas requeridas descritas en texto simple
  (tipo de delito, hora, día de la semana, distrito, latitud, longitud, frecuencia histórica y
  nivel de riesgo; los nombres exactos están en la plantilla descargable).
- Aviso si el usuario no es administrador: caja ámbar translúcida con icono de escudo:
  "Tu cuenta no tiene permiso de administrador para importar datos".
- Fila superior (2 columnas):
  1) Tarjeta "Subir archivo de datos": dropzone punteada con icono de subida, "Arrastra tu archivo
     aquí o haz clic para elegirlo", formatos admitidos en micro-texto; estado de progreso con
     barra determinada y "Importando 120/300 registros"; al terminar, toast de éxito.
  2) Tarjeta "Importar datos pegando texto": textarea monoespaciada con placeholder de ejemplo,
     botón "Guardar" (primario).
- Tarjeta "Previsualización": tabla con las primeras filas parseadas antes de confirmar —
  columnas requeridas, filas con error resaltadas en rojo translúcido con mensaje por fila
  (ej. "Fila 12: hour debe ser un entero entre 0 y 23"), y pie con "298 válidas / 2 con error"
  + botón "Importar solo filas válidas".
- Zona de peligro (al pie, borde rojo tenue): "Borrar todos los registros" con descripción y
  botón de peligro; al pulsarlo se abre un modal: "¿Eliminar todos los registros?" con
  "Esta acción no se puede deshacer", input opcional de confirmación y botones
  "Cancelar" / "Eliminar todo" (rojo).
```

---

## Recetas de iteración (ejemplos)

- *"El fondo es demasiado plano: añade un halo radial teal apenas perceptible arriba del contenido."*
- *"Haz el sidebar más compacto (240px) y reduce el tamaño de los ítems a 36px de alto."*
- *"Los chips de riesgo deben verse desactivados con solo un borde tenue y gris."*
- *"Sube el contraste del texto secundario para cumplir WCAG AA en fondo #0C1425."*
- *"Añade el estado de carga con skeletons en la tarjeta de tendencia."*
- *"Convierte la pantalla a un tema claro coherente manteniendo los mismos tokens."*

## Al exportar

1. `DESIGN.md` del proyecto Stitch (tokens finales).
2. Cada pantalla en **HTML/Tailwind** y **PNG** (para comparar antes/después en la tesis).
3. Guarda los archivos en `docs/design/stitch/` y avísame para implementarlos.
