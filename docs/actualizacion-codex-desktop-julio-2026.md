# Actualización de avance — Codex como upstream (Desktop) · Julio 2026

> **Para:** el asistente que lleva la planificación macro / big picture del proyecto.
> **De:** el trabajo de implementación sobre la capa **Desktop (Electron)** de CoCreate.
> **Alcance de esta actualización:** cubre el período que va **desde que empezamos a probar la ejecución real de código usando Codex como upstream**, hasta **el último cambio** (arreglo de visibilidad de la vista dividida en la ventana *Probar*).

Esta nota está pensada para reconciliar tu roadmap (actualizado justo **antes** de este bloque de trabajo) con lo que efectivamente se implementó y se probó. Marco explícitamente lo que **ya funciona**, lo que **cambió de decisión** respecto a tu plan, lo **extra** que agregamos, y lo que **sigue pendiente**.

---

## 0. Contexto y encuadre

Tu roadmap describe la visión correcta: **CoCreate como workspace de desarrollo impulsado por Codex**, con la regla de oro de que *la IA nunca debe aparentar comprender algo que no ha demostrado comprender*.

Este bloque de trabajo se concentró en la pieza que tu roadmap tenía más abierta: **la integración operativa de Codex como upstream** (tu punto 6, que estaba en ~60%). El objetivo no era la UI, sino **hacer que Codex realmente ejecute código de punta a punta desde la app de escritorio**, con autenticación, sandbox, aislamiento de workspace y estados de ejecución honestos.

El resultado principal: **la ejecución real con Codex ya funciona end-to-end en la app instalada**, y sobre esa base construimos la nueva experiencia de **Live coding dentro de la ventana *Probar***.

---

## 1. Lo que se hizo y quedó funcionando (cronología temática)

### 1.1 Codex como motor de ejecución real (end-to-end)
- Integramos **Codex CLI (0.144.6)** como upstream y logramos ejecución real de código desde la app.
- **Modo de runtime:** `exec`. Probamos primero el flujo *app-server / SDK*, pero **falla dentro de Electron en Windows** (terminaba inesperadamente en ~360 ms). El modo `exec` es estable, así que esa es la vía de ejecución actual.
- **Autenticación:** vía **plan ChatGPT/Codex** (`codex login --with-api-key`), separado de la facturación de la API de OpenAI. La key se registra por *stdin* de un proceso hijo (no por shell) para evitar corrupción por BOM.
- **Binario:** en Windows `execFile` no resuelve `.cmd`, así que apuntamos `CODEX_BINARY` al `.exe` real.

### 1.2 Autenticación y cuenta en la UI
- Panel de **cuenta en la parte inferior del sidebar**: permite ingresar **API key** y hacer **login con ChatGPT**.
- Regla de precedencia: **si el usuario configuró una key personalizada, se usa esa; si no, la del `.env`**.

### 1.3 Estados de ejecución honestos en el chat
- El chat muestra **solo la narración en lenguaje natural que emite Codex** (las líneas de narración), en streaming, **reemplazándose** unas a otras, y terminando con el **mensaje final** (resumen + botón *Probar*).
- No se inventan estados: lo que se ve corresponde a lo que Codex realmente reporta. **Esto es exactamente tu principio de "honestidad del sistema" (95%)**, aplicado a la capa de ejecución desktop.

### 1.4 Aislamiento de workspaces
- Cada conversación ejecuta en su **propia carpeta** bajo `userData/workspaces/<conversationId>`.
- Esto evita que Codex edite el propio repo de CoCreate y da límites claros por sesión.

### 1.5 Selección de modelo y esfuerzo de razonamiento
- Selector con **todos los modelos que Codex permite** y su **reasoning effort**.
- La elección **persiste** entre chats (se recuerda la decisión del usuario, ya no vuelve al predeterminado al abrir una conversación nueva).

### 1.6 Ventana *Probar* (preview del programa desarrollado)
- Botón **Probar**: abre una **ventana nativa** con la app web que Codex está construyendo; si ya está abierta, hace **recarga en caliente**.
- Botón **Abrir en carpeta** para llegar al workspace en disco.

### 1.7 Live coding (nueva experiencia, dentro de *Probar*)
Pipeline completo y funcionando:

```text
Voz (Deepgram streaming STT)
        ↓
Organizador LLM (Gemini)  → detecta límites de tarea y redacta el prompt
        ↓
Codex (exec) aplica el cambio
        ↓
Marcadores visuales (puntos blancos) anclados al cursor + feedback en tiempo real
```

- **Anclaje al DOM:** en la ventana *Probar* (misma-origin) rastreamos el cursor y el elemento real bajo el puntero (`elementFromPoint`), y anclamos un **punto blanco** a ese elemento. Los puntos son **sticky** (siguen al elemento a través de scroll/edits).
- **Límites de tarea explícitos:** una tarea se despacha **solo** cuando el usuario dice *"nueva tarea"* o hace clic en el **check ✓**. Un prompt por mejora.
- **Feedback de ejecución en vivo:** el punto se convierte en spinner con un diálogo horizontal mientras Codex trabaja; **verde** al terminar (hover muestra el resumen), **rojo** si falla (hover → reintentar).
- **Persistencia de marcadores:** los puntos **no** se borran al activar/desactivar Live.
- **Alcance por workspace:** los marcadores/tareas están **atados al workspace**, así que una conversación nueva no muestra los checks de otra.

### 1.8 Vista dividida en *Probar* (Split view)
- Pestañas **dividida / única** junto al botón *Live*.
- **Dividida:** izquierda = **"Original"** (snapshot congelado del momento en que se abrió *Probar*), derecha = **"En edición"** (versión que se va modificando en vivo). El usuario **da feedback señalando la izquierda** y los cambios se reflejan en la derecha.
- **Única:** funciona igual que siempre.
- **Último arreglo (el más reciente):** en la vista dividida los puntos blancos **se creaban pero no se veían** (se dibujaban *dentro* del iframe izquierdo y quedaban recortados). Se resolvió **separando la capa visual de la capa de rastreo**: el overlay (halo, etiqueta, puntos) ahora se renderiza en el **documento contenedor superior**, por encima de los iframes y siempre visible, mientras el **rastreo del elemento sigue leyendo del iframe izquierdo**. Un `frameOffset()` dinámico reconcilia ambos sistemas de coordenadas. *(Pendiente de verificación visual del usuario.)*

### 1.9 Instalador y logo
- **Logo redondo** (esquinas transparentes) y **instalador NSIS**; la app quedó **instalada en la PC**.

---

## 2. Mapeo contra tu roadmap

| Área de tu roadmap | Estado que traías | Estado tras este bloque (óptica Desktop) | Nota |
| --- | --- | --- | --- |
| Workspace | 🟢 90% | 🟢 90% | Se sumó panel de cuenta, selector de modelo/effort persistente, *Probar* y *Abrir en carpeta*. |
| UX | 🟢 90% | 🟢 90% | Sin regresiones; se agregó overlay de Live y tabs split/single. |
| Live | 🟢 85% | 🟢 88% | **Cambió de forma:** ver §3.1. Ahora corre **dentro de *Probar*** como overlay sobre la app en ejecución. |
| Honestidad del sistema | 🟢 95% | 🟢 95% | Reforzada en ejecución: el chat muestra solo narración real de Codex. |
| Voz | 🟢 90% | 🟢 90% | **Cambió de motor:** SpeechRecognition → **Deepgram** en desktop (ver §3.2). |
| Visión | 🟡 70% | 🟡 70% | **Cambió de enfoque en desktop:** anclaje al DOM en vez de `getDisplayMedia` (ver §3.3). |
| Context Engine | 🟡 40% | 🟡 45% | Aparece un primer "organizador" (Gemini) que convierte transcript → prompts discretos. Aún no es el motor unificado. |
| **Integración Codex Upstream** | 🟡 60% | 🟢 **~80%** | **Mayor avance del bloque:** ejecución real end-to-end, auth, sandbox, aislamiento, streaming de eventos, modelo/effort. |
| Ejecución | 🟡 35% | 🟡 **~55%** | Codex ya **edita archivos y ejecuta** en el workspace aislado; falta terminal/tests/deps formalizados y diffs. |
| Persistencia | 🟡 30% | 🟡 30% | Sin cambios de fondo; los marcadores persisten por sesión, pero no hay persistencia entre reinicios. |
| Permisos y seguridad | 🟠 25% | 🟠 25% | Sin cambios; sigue pendiente el modelo Ask/Assist/Autopilot. |

**Traducción ejecutiva:** este bloque movió sobre todo la aguja de **Integración Codex Upstream** (tu Fase 1, la de máxima prioridad) y de **Ejecución**, que eran justamente las piezas de infraestructura operativa que tu resumen marcaba como el próximo foco.

---

## 3. Cambios de decisión respecto a tu roadmap

### 3.1 Live coding ya no vive en una ventana "por detrás" — sale desde *Probar*
En tu roadmap, Live venía del linaje "compartir pantalla / modo live" con su propia superficie. **Decisión nueva:** Live coding ahora **se lanza desde la ventana *Probar*** (el preview de la app en ejecución) y actúa como un **overlay sobre el propio programa del usuario**, no como un panel separado de screen-share. Razón: al ser una superficie **propia y same-origin**, podemos leer el DOM real y **anclar el feedback al elemento exacto** que el usuario señala — algo que un screen-share no permite con la misma fidelidad.

### 3.2 Voz: SpeechRecognition → Deepgram (en desktop)
Tu pipeline de voz (SpeechRecognition → VoiceService → Transcript) funciona en Chrome. **En Electron, la Web Speech API da error `network`.** Decisión: usar **Deepgram streaming** (WebSocket, nova-2, español, resultados interinos) para la voz en desktop. El transcript incremental en tiempo real se mantiene como concepto; cambia el proveedor por debajo.

### 3.3 Visión en desktop: anclaje al DOM en vez de captura de pantalla
Tu circuito de visión (`getDisplayMedia` → captura → análisis → observación semántica) quedó bloqueado por el entorno de captura, no por un bug de CoCreate. **En desktop tomamos otro camino para el mismo objetivo** ("que la IA sepa a qué se refiere el usuario"): como la ventana *Probar* es nuestra, usamos **rastreo de cursor + `elementFromPoint`** para saber con precisión el elemento y el contexto de código señalado. No reemplaza la visión por captura para casos generales, pero **resuelve el caso desktop de forma más confiable**.

### 3.4 "Todo por Gemini": investigado y descartado a nivel Codex
Exploramos correr **todo** CoCreate a través de **Gemini** vía Codex. **No es posible:** Codex requiere el *wire API* `/responses`, y Gemini solo expone el compatible con OpenAI `/chat/completions` (confirmado 404 en `/responses`). Siguiendo la regla acordada *"si no lo permite, no implementamos nada"*, **no construimos un proxy**. Resultado: **Codex sigue ejecutando sobre OpenAI**; Gemini se usa **solo** para el organizador LLM, y Deepgram para la voz.

### 3.5 Runtime de Codex: `exec` en lugar de app-server/SDK
Como el flujo app-server/SDK falla dentro de Electron en Windows, la ejecución usa **`exec`** con `danger-full-access` en el sandbox (en Windows `workspace-write` se degrada silenciosamente a solo-lectura). Es una decisión de estabilidad, no de preferencia arquitectónica; cuando el app-server sea viable en Electron, se puede migrar sin tocar la UI.

---

## 4. Extras agregados (no contemplados explícitamente en el roadmap)

- **Aislamiento de workspace por conversación** (carpetas dedicadas).
- **Selector de modelo + reasoning effort con persistencia**.
- **Ventana *Probar* nativa** con recarga en caliente + **Abrir en carpeta**.
- **Vista dividida "Original vs En edición"** en *Probar*.
- **Marcadores de tarea anclados al DOM** con estados grabando/ejecutando/hecho/fallido, retry y dismiss.
- **Organizador LLM (Gemini)** para detección de límites de tarea y redacción de prompts.
- **Instalador NSIS + logo redondo**, app instalada.
- Correcciones de robustez: timeout de proveedor 30 s → 10 min; anclaje sticky de puntos; feedback óptimo instantáneo al hacer clic en ✓.

---

## 5. Limitaciones y pendientes conocidos

- **Vista dividida:** el arreglo de visibilidad de puntos es reciente y **está pendiente de verificación visual** por el usuario.
- **Visión por captura** (`getDisplayMedia`) no es el camino en desktop; el anclaje al DOM cubre el caso *Probar*, no capturas arbitrarias.
- **Context Engine** aún no está unificado (el organizador es un primer paso, no el motor completo).
- **Ejecución** todavía no formaliza terminal / tests / instalación de dependencias / diffs como flujo de primera clase.
- **Persistencia** entre reinicios y **Permisos (Ask/Assist/Autopilot)** siguen sin abordarse.

---

## 6. Recomendación de próximos pasos (alineada a tus fases)

1. **Cerrar tu Fase 1 (Codex upstream):** ya estamos en ~80%. Falta consolidar un `CodexAdapter` estable y la normalización de herramientas/eventos para poder actualizar el upstream sin fricción. **Es el mejor lugar para seguir.**
2. **Arrancar el Context Engine (tu Fase 2)** tomando el organizador actual como semilla: unificar chat + transcript + puntero/DOM + proyecto en un solo motor que decida qué mandar a Codex.
3. **Formalizar Ejecución (tu Fase 4):** diffs, terminal, tests y deps como flujo de primera clase sobre el workspace aislado que ya existe.
4. **Recién después, Permisos (Fase 5) y Persistencia (Fase 6).**

---

*Documento generado como actualización de estado del bloque de trabajo Desktop/Codex. Las claves reales (OpenAI, Gemini, Deepgram) viven solo en `.env`, que está en `.gitignore` y no se versiona.*
