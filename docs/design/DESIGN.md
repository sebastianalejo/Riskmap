# DESIGN.md — RiskMap · Centro de Operaciones

> Sistema de diseño de **RiskMap**, plataforma de predicción y monitoreo de riesgo criminal
> (Lima Metropolitana). Este documento es la **fuente de verdad** del diseño: se usa como brief
> para generar pantallas en **Google Stitch** y como contrato de implementación en
> `frontend/` (React 19 + Vite + Tailwind CSS 4).
>
> Dirección elegida: **dark-first "centro de operaciones"** (tema oscuro por defecto, tema claro
> completo con toggle persistente).

---

## 1. Concepto y principios

RiskMap se usa como una **sala de monitoreo**: analistas que cargan datos, filtran un mapa de
incidentes, calculan predicciones y exportan reportes. El diseño debe sentirse como una consola
de operaciones profesional, sobria y densa en información, sin sacrificar claridad.

Principios:

1. **Datos primero**: cifras, estados y tendencias dominan la jerarquía; decoración mínima.
2. **Calma operativa**: superficies oscuras estables, acento teal reservado para acciones y foco;
   el color de riesgo (verde/naranja/rojo) es la única semántica cromática fuerte.
3. **Consistencia por tokens**: ningún color "suelto" en los componentes; todo sale del sistema.
4. **Precisión numérica**: cifras en tipografía monoespaciada (JetBrains Mono) para escaneo rápido.
5. **Accesible por defecto**: contraste WCAG AA en ambos temas, foco visible, navegación por teclado.

---

## 2. Temas

- **Oscuro ("ops")**: tema por defecto. Se activa con `data-theme="dark"` en `<html>`.
- **Claro**: modo diurno completo, mismos tokens semánticos.
- El usuario alterna con un botón (`ThemeToggle`) y la preferencia se guarda en
  `localStorage` con la clave `riskmap:theme`.

Regla: **los componentes nunca usan colores de paleta directa** (`slate-800`, `teal-500`, `#fff`);
usan tokens semánticos (`bg-surface-1`, `text-content-secondary`, `bg-risk-alto-soft`, …).

---

## 3. Tokens de color

### 3.1 Tema oscuro (por defecto)

| Token | Valor | Uso |
|---|---|---|
| `surface-0` | `#060B17` | Fondo de página |
| `surface-1` | `#0C1425` | Tarjetas, sidebar, superficies base |
| `surface-2` | `#131E33` | Elementos elevados, hover, inputs |
| `border-subtle` | `rgb(148 163 184 / 0.16)` | Bordes de tarjetas y separadores |
| `border-strong` | `rgb(148 163 184 / 0.30)` | Hover de bordes, foco secundario |
| `content-primary` | `#E9EEF8` | Texto principal |
| `content-secondary` | `#A6B4CC` | Texto secundario |
| `content-muted` | `#6C7A94` | Etiquetas, metadatos |
| `accent` | `#2DD4BF` | Acento (texto/iconos): navegación activa, focos |
| `accent-strong` | `#14B8A6` | Fondo de botones primarios |
| `accent-soft` | `rgb(45 212 191 / 0.12)` | Fondos translúcidos de acento |
| `accent-foreground` | `#042F2E` | Texto sobre `accent-strong` |
| `risk-bajo` | `#34D399` | Nivel bajo |
| `risk-medio` | `#FB923C` | Nivel medio |
| `risk-alto` | `#F87171` | Nivel alto |
| `risk-*-soft` | `rgb(… / 0.14)` | Chips/fondos de riesgo |
| `info` | `#38BDF8` | Datos INEI / información |
| `grid-line` | `rgb(148 163 184 / 0.10)` | Rejillas de gráficos |

### 3.2 Tema claro

| Token | Valor | Uso |
|---|---|---|
| `surface-0` | `#F5F7FB` | Fondo de página |
| `surface-1` | `#FFFFFF` | Tarjetas |
| `surface-2` | `#EEF2F8` | Hover, inputs |
| `border-subtle` | `rgb(15 23 42 / 0.10)` | Bordes |
| `border-strong` | `rgb(15 23 42 / 0.18)` | Hover de bordes |
| `content-primary` | `#0F172A` | Texto principal |
| `content-secondary` | `#475569` | Texto secundario |
| `content-muted` | `#64748B` | Metadatos |
| `accent` | `#0F766E` | Acento (contraste AA sobre blanco) |
| `accent-strong` | `#0F766E` | Botones primarios |
| `accent-foreground` | `#FFFFFF` | Texto sobre botón primario |
| `risk-bajo` | `#16A34A` | Nivel bajo |
| `risk-medio` | `#EA580C` | Nivel medio |
| `risk-alto` | `#DC2626` | Nivel alto |
| `info` | `#0284C7` | INEI |

### 3.3 Reglas de uso del color de riesgo

- `risk-alto` = rojo (peligro), `risk-medio` = naranja (precaución), `risk-bajo` = verde (seguro).
- **Nunca solo color**: siempre acompañar con etiqueta textual (Alto/Medio/Bajo) o icono.
- Chips: fondo `risk-*-soft` + texto `risk-*` + borde `risk-*` al 35 %.
- Marcadores del mapa: relleno `risk-*`, borde blanco al 80 % (oscuro) / blanco puro (claro).

---

## 4. Tipografía

| Rol | Fuente | Detalle |
|---|---|---|
| UI | **DM Sans** | 400/500/600/700 |
| Datos y cifras | **JetBrains Mono** | 400/500; números, coordenadas, contadores, etiquetas técnicas |

Escala:

| Token visual | Tamaño / peso | Uso |
|---|---|---|
| Display | 28–30 px / 600 | Números grandes de KPIs |
| Título de página | 24 px / 600 | `h1` |
| Título de tarjeta | 15–16 px / 600 | `h2/h3` |
| Cuerpo | 14 px / 400–500 | Texto general |
| Secundario | 13 px / 400 | Ayudas |
| Micro-etiqueta | 11 px / 600, mayúsculas, `tracking-wide` | Encabezados de sección, columnas |

Reglas: títulos de página en `content-primary`; ayudas en `content-secondary`; metadatos en
`content-muted`. Cifras siempre en `font-mono`.

---

## 5. Espaciado, radios, elevación y movimiento

- **Rejilla base**: 4 px. Ritmo vertical habitual: 8 / 12 / 16 / 24 / 32.
- **Padding de página**: 16 px móvil, 24–32 px escritorio.
- **Radios**: tarjetas `16 px` (`rounded-2xl`), controles `12 px` (`rounded-xl`), chips `full`.
- **Elevación** (oscuro): borde `border-subtle` + sombra suave `0 8px 24px rgb(2 6 23 / 0.5)`.
  Sin sombras difusas grandes; la profundidad la da la diferencia `surface-1`/`surface-2`.
- **Glow de acento**: solo en botón primario y anillos de foco:
  `0 0 0 1px rgb(45 212 191 / 0.25), 0 4px 24px rgb(20 184 166 / 0.25)`.
- **Movimiento**: transiciones de 150–200 ms `ease-out`; barras de gráficos 500 ms;
  respetar `prefers-reduced-motion`.

---

## 6. Layout

- **Shell**: sidebar fija de 260–264 px (`surface-1`, borde derecho `border-subtle`) +
  contenido con ancho máximo `1400 px`.
- **Navegación**: ítem activo = fondo `accent-soft`, texto `accent`, indicador vertical de 2 px
  a la izquierda; inactivo = `content-secondary`, hover `surface-2`.
- **Header**: 56 px, `surface-0` translúcido con blur, borde inferior `border-subtle`.
  Contiene: título de página, acciones contextuales, `ThemeToggle` y usuario.
- **Móvil**: sidebar en drawer con backdrop oscuro; header compacto con botón de menú.
- **Página estándar**: encabezado (título + descripción + acciones) y luego secciones con
  `gap` de 24 px.

---

## 7. Componentes

### Botones (`Button`)
| Variante | Oscuro | Claro |
|---|---|---|
| Primario | Fondo `accent-strong`, texto `accent-foreground`, glow | Fondo `accent-strong`, texto blanco |
| Secundario | Fondo `surface-2`, borde `border-subtle`, texto `content-primary` | Igual |
| Fantasma | Sin fondo, texto `content-secondary`, hover `surface-2` | Igual |
| Peligro | Fondo `risk-alto-soft`, texto `risk-alto`, anillo `risk-alto/40` | Igual |

Alturas: 32 / 36 / 44 px (`sm` / `md` / `lg`). Estados: hover, `active:scale-[0.98]`,
foco con anillo de acento, deshabilitado al 50 %, cargando con spinner.

### Tarjetas (`Card`)
Fondo `surface-1`, borde `border-subtle`, radio 16 px, padding 20–24 px.
Encabezado opcional: título (15 px/600) + descripción (13 px `content-secondary`) + acción a la derecha.

### Chips de riesgo (`Badge`)
Píldora con fondo `risk-*-soft`, texto `risk-*`, borde `risk-*` al 35 %.
Estados toggle (filtros): apagado = solo borde tenue y texto `content-secondary`;
encendido = fondo por nivel (rojo/naranja/verde sólido con texto oscuro/blanco según contraste).

### Formularios (`Input`, `Select`, `Textarea`)
Fondo `surface-2` (oscuro) / `surface-1` (claro), borde `border-subtle`, radio 12 px, 36–40 px de alto.
Foco: borde `accent` + anillo `accent/25`. Etiqueta: micro-etiqueta o 13 px `content-secondary`.
Error: borde y texto `risk-alto`.

### Tabla de datos
Cabecera con micro-etiquetas (`content-muted`), filas separadas por `border-subtle`,
hover de fila `surface-2`, cifras en `font-mono`. Estados vacíos con `EmptyState`.

### Toasts
Esquina inferior derecha, fondo `surface-2`, borde `border-subtle`, barra izquierda de 3 px
según variante (éxito `risk-bajo`/acento, error `risk-alto`, info `info`), icono + título +
descripción, autocierre 5 s, `role="status"`.

### Modal
Fondo oscuro con blur (`bg-surface-0/70 backdrop-blur-sm`), panel `surface-1` con
borde `border-subtle`, radio 16 px, ancho máximo 440–520 px, cierre con `Esc`, foco atrapado,
botón de peligro para acciones destructivas.

### Skeletons y estados vacíos
Skeleton: bloques `surface-2` animados (pulse) con la forma del contenido final.
Estado vacío: icono en `surface-2`, título, descripción y acción primaria opcional.

### KPIs (`StatCard`)
Etiqueta micro mayúsculas, cifra grande en `font-mono` (Display), variación (chip ↑/↓ con
`risk-bajo`/`risk-alto`), icono en caja `accent-soft` a la derecha.

---

## 8. Visualización de datos

- **Tendencia (barras apiladas)**: rejilla `grid-line`, texto de ejes `content-muted` (11 px mono),
  barras por nivel de riesgo con `risk-*`, sin bordes, radio superior 2 px, tooltip sobre
  `surface-2` con borde `border-subtle`.
- **Distribución**: barras horizontales finas (4–6 px) con `risk-*` y porcentaje en mono;
  el nivel predicho se refuerza con un **anillo de confianza** con glow del color del riesgo.
- **Leyenda**: puntos de color + conteo en mono; siempre visible en el mapa.
- **Mapa**: base oscura (Carto dark / estilo nocturno de Google), marcadores `risk-*` con borde
  claro, popups `surface-1` con borde `border-subtle`.

---

## 9. Accesibilidad

- Contraste objetivo **AA** (≥ 4.5:1 texto normal, ≥ 3:1 texto grande/iconos) en ambos temas.
- Foco visible: anillo de 2 px `accent` con offset 2 px en todo elemento interactivo.
- Iconos decorativos con `aria-hidden`; botones de solo icono con `aria-label`.
- El color de riesgo nunca es el único portador de información.
- `prefers-reduced-motion` desactiva animaciones no esenciales.
- Navegación completa por teclado (incluye modal y drawer).

---

## 10. Tono de la copy (español)

- Profesional, directo, orientado a la acción: «Ver mapa», «Importar datos», «Predecir riesgo».
- Números y unidades claros: `1 234 puntos`, `7 días`, `Alto · 42 %`.
- Errores que explican y proponen: «No se pudo cargar Firestore. Revisa tu conexión e inténtalo de nuevo.»
- Evitar jerga de infraestructura en la vista principal (p. ej. «Blaze», «Cloud Functions» van a
  un panel secundario de "Estado del sistema").

---

## 11. Inventario de pantallas

| Ruta | Pantalla | Objetivo |
|---|---|---|
| `/login` | Acceso | Autenticación con Firebase (correo/contraseña) |
| `/` | Resumen | KPIs, tendencia, distribución, top distritos, estado del sistema |
| `/prediccion` | Predicción | Formulario de escenario + resultado con confianza y factores |
| `/mapa` | Mapa de riesgo | Mapa + filtros (riesgo, delito, distrito, hora) + tendencia + PDF |
| `/datos` | Importar datos | CSV/XLSX con validación y vista previa, JSON, borrado con confirmación |
