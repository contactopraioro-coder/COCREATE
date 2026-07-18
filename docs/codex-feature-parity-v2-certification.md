# Codex Feature Parity v2 - Real Device Certification

Fecha: 2026-07-16 22:20 COT  
Version certificada: Codex `0.134.0`, App Server v2  
Entorno: macOS 26.3 build 25D125, Apple Silicon arm64

## 1. Veredicto

`PROMPT #10 INCOMPLETO`

La implementacion principal y los flujos Codex quedaron certificados en un paquete Desktop real. El cierre estricto sigue bloqueado porque no hubo una grabacion/transcripcion con microfono fisico, el picker nativo no pudo ser controlado por Assistive Access, el drag-and-drop fisico no produjo evidencia y la navegacion con teclado fisico no fue ejecutada.

## 2. Recommendation

`REMAIN IN FEATURE PARITY`

No se deben agregar nuevas capabilities de paridad. Solo se debe ejecutar la checklist humana de dispositivos y cerrar los gates pendientes antes de Live Coding.

## 3. Entorno real

| Dato | Evidencia segura |
| --- | --- |
| Sistema | macOS 26.3, build 25D125 |
| Arquitectura | arm64 |
| GUI | Disponible para Electron empaquetado y BrowserWindow visible |
| Audio input | Electron enumero dispositivos reales; existe microfono integrado |
| Filesystem | Lectura/escritura real en workspace y directorios temporales |
| Red / GitHub | `github.com` accesible; descarga Electron completada |
| Node / npm | Node 24.13.0, npm 11.6.2 |
| Codex | binario user-local, `codex-cli 0.134.0` |
| App Server | Disponible, autenticado con cuenta Codex, protocolo v2 |
| Modos | Desktop empaquetado y Web local |
| Sandbox | Comandos base restringidos; gates GUI/red ejecutados con autorizacion nativa |

No se publican rutas personales, credenciales, nombres de dispositivos externos ni contenido privado.

## 4. Codex version

`npm run codex:version` confirmo `0.134.0`, compatible con la version fijada. `npm run codex:capabilities` reporto 35 surfaces estables y cinco experimentales. El contract test genero digest y paso contra App Server v2.

## 5. Commands executed

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run build:desktop
npm run smoke:desktop
git diff --check
npm run codex:version
npm run codex:capabilities
npm run codex:app-server:contract
npm run codex:app-server:integration
npm run qa:workspace:desktop
npm run qa:workspace:web
node scripts/feature-parity-v2-real-capabilities-gate.mjs
node scripts/feature-parity-v2-resilience-gate.mjs
node scripts/feature-parity-v2-device-gate.mjs
electron scripts/feature-parity-v2-navigation-gate.mjs
```

Los intentos de device gate que quedaron esperando UI nativa fueron interrumpidos con codigo 130 y sus directorios temporales fueron eliminados. No cuentan como pruebas aprobadas.

## 6. Automated validation

- Typecheck: pass.
- Architecture lint: pass.
- Tests: 167 total, 166 pass, 0 fail, un integration probe opcional skipped.
- Build Web y overlay: pass.
- `git diff --check`: pass.
- Contrato App Server: pass, 35 stable + 5 experimental.
- Tests de flags, compatibility, Plan, Skills, MCP, Voice, picker, attachments, navigation y restore: incluidos en la suite aprobada.

## 7. Desktop build

`electron-builder 26.15.3` genero un paquete macOS arm64 fresco con Electron 31.7.7. La descarga desde GitHub completo. Deuda de distribucion no bloqueante para QA local: paquete sin Developer ID, icono Electron por defecto y metadata author/description ausente.

## 8. Desktop launch

`npm run smoke:desktop` paso sobre el paquete fresco. La ventana cargo contenido, bridge, renderer y sesion activa sin blank screen ni crash. El gate E2E abrio la app real y termino correctamente; el arranque observado fue menor a cinco segundos. La captura CDP Desktop no devolvio imagen, por lo que no se declara screenshot Desktop.

## 9. App Server real

Proceso real en `ready`, Codex 0.134.0, protocolo v2, autenticado, cinco MCP configurados y Web Search live. El probe de reinicio observo `starting`, `initializing`, `ready`, `stopping`, `stopped`, `restarting`, `initializing`, `ready`.

## 10. Real Turn

El gate creo un Project y Task temporales, envio un Turn real, creo thread/turn/execution, termino `execution.completed` y limpio el proyecto. Un segundo escenario ejecuto Turns antes y despues de reiniciar App Server sobre el mismo thread.

## 11. Streaming / Tools / Diffs / Artifacts / Approvals

Streaming real observado. El Turn de coding creo dos archivos temporales, ejecuto tests, emitio command/tool y diff/patch, produjo tres Artifacts y 201 Activities. Dos Turns adicionales solicitaron approval real: reject no escribio el probe y approve si lo escribio. No hubo autoapproval.

## 12. Plan Mode

Catalogo real `plan/default`. Plan produjo `plan.delta`; Default no lo produjo. La preferencia se restauro al cambiar de Task y al reiniciar la app, y pudo desactivarse para el siguiente Turn. No se genero plan desde UI.

## 13. Skills

Se descubrieron 77 Skills, se selecciono una Skill real desde Complementos, su token fue opaco y se consumio despues del Turn. No se expusieron paths, `SKILL.md`, prompts internos ni chain-of-thought.

## 14. MCP

Cinco servidores reales, cinco ready, 137 tools, IDs deduplicados y payload sanitizado. Tras reiniciar App Server, los cinco servidores reaparecieron. No se provoco la caida individual de un MCP real porque modificar configuracion del usuario no era seguro; error/method-not-found y deduplicacion permanecen cubiertos por tests, no por device gate.

## 15. Physical microphone

Electron detecto audio inputs reales e identifico un microfono integrado. El control de voz estaba deshabilitado antes de solicitar permiso porque el provider Desktop reporto configuracion ausente. No se ejecuto `getUserMedia`, permiso grant/deny, grabacion, cancelacion, cambio de dispositivo ni desconexion. Gate bloqueante.

## 16. Voice transcription

No ejecutada. El estado visible explico que falta la configuracion segura del provider de transcripcion. No se almaceno audio y Chat permanecio usable. Gate bloqueante.

## 17. Native File Picker

El gate invoco la accion real de adjuntos, pero la automatizacion macOS no pudo cerrar ni seleccionar en el dialogo nativo. El proceso se interrumpio y limpio; no se certifican cancel, single, multiple, image, invalid, size, ownership, expiration ni envio upstream mediante picker. Gate bloqueante.

## 18. Drag-and-drop

El intento con archivos temporales reales mediante CDP no produjo salida verificable antes del timeout y fue interrumpido. Los tests del broker no sustituyen la interaccion fisica. Gate bloqueante.

## 19. Desktop/Web consistency

Desktop mostro App Server, Git/filesystem local, modelos, reasoning, Plan, Skills y MCP reales. Web mostro Workspace, Chat, Identity y DateTime, y declaro App Server/filesystem/MCP local como Desktop-only o unavailable. No aparecieron branch, shell o scheduler locales ficticios en Web.

## 20. Navigation

Las seis entradas abrieron su route, active state, back, forward, refresh y restore. Programados fue Unsupported, Complementos Desktop-only en Web, Sitios Deferred y Pull requests Authentication required. `sendInputEvent` no activo el boton enfocado; un teclado fisico no fue probado y queda pendiente.

## 21. Context bar

El contexto principal se mantuvo como `Project · Task`, sin IDs ni jerarquia completa visible. Workspace, Conversation, Thread y capabilities permanecen en progressive disclosure.

## 22. Composer

Desktop mostro modelo real, reasoning, Plan, Skill, attachments y voice segun capability. Web mostro `Modelo automatico`, `Plan no disponible` y estados honestos. DateTime respondio `La hora local verificada...` sin provider. Los flujos fisicos de voz/picker/drop siguen pendientes.

## 23. Resilience

App Server reinicio y recupero el mismo thread, streaming, Chat y MCP. Web Search real emitio `webSearch.started` y `webSearch.completed`. Method-not-found, provider unavailable, invalid auth, voice denial y MCP failure individual solo tienen cobertura automatizada; no se presentan como device gates ejecutados.

## 24. Security

Tokens de Skills opacos, catalogo MCP sanitizado, approvals explicitas y ningun secret observado en renderer. No se imprimieron API keys, cookies, headers, config MCP, audio, prompts internos o rutas privadas en este informe. GitHub permanece disabled/auth required.

## 25. Defects found

`FP2-CERT-001`: en viewport 390 px, el texto del boton de tema quedaba parcialmente recortado aunque `scrollWidth` no reportaba overflow. Severidad media de UX movil. Los demas fallos encontrados pertenecian a selectores o timing de los harnesses y no se clasifican como producto.

## 26. Fixes applied

`FP2-CERT-001` se corrigio compactando `.theme-toggle` a icon-only dentro del media query movil. No se cambio arquitectura, navegacion, contratos ni comportamiento upstream.

## 27. Retests

Web QA volvio a pasar en 1440x921 y 390x816, sin overflow ni console errors. La captura Chat movil muestra topbar completo, contexto compacto, respuesta DateTime y composer dentro del viewport.

## 28. Evidence

| Gate | Required | Environment | Executed | Passed | Blocked | Evidence | Defect | Fix | Retest | Final status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Technical suite | Yes | Local | Yes | Yes | No | 167 tests, builds, contracts | None | N/A | Yes | Pass |
| Desktop package | Yes | macOS arm64 | Yes | Yes | No | fresh app bundle | None | N/A | Smoke | Pass |
| Desktop launch | Yes | Packaged GUI | Yes | Yes | No | smoke + E2E | None | N/A | Yes | Pass |
| App Server | Yes | Real process | Yes | Yes | No | ready/auth/v2 | None | N/A | Restart | Pass |
| Real Turn | Yes | Desktop | Yes | Yes | No | thread/turn/execution | None | N/A | Restart | Pass |
| Stream/tools/diff/artifact | Yes | Desktop | Yes | Yes | No | real event set | None | N/A | Yes | Pass |
| Approvals | Yes | Desktop | Yes | Yes | No | reject + approve probes | None | N/A | Yes | Pass |
| Web Search | Yes | App Server live | Yes | Yes | No | started/completed | None | N/A | Yes | Pass |
| Plan Mode | Yes | Desktop 0.134.0 | Yes | Yes | No | plan.delta/default | None | N/A | Yes | Pass |
| Skills | Yes | Desktop 0.134.0 | Yes | Yes | No | 77 + opaque token | None | N/A | Yes | Pass |
| MCP inventory/restart | Yes | Desktop | Yes | Yes | Partial | 5 ready after restart | Individual outage not forced | N/A | Yes | Partial pass |
| Physical microphone | Yes | Real devices | Partial | No | Yes | device enumeration only | None confirmed | N/A | No | Blocked |
| Voice transcription | Yes | Desktop | No | No | Yes | provider not configured | None confirmed | N/A | No | Blocked |
| Native picker | Yes | macOS dialog | Attempted | No | Yes | dialog did not return | None confirmed | N/A | No | Blocked |
| Drag-and-drop physical | Yes | Desktop | Attempted | No | Yes | no observable completion | None confirmed | N/A | No | Blocked |
| Web workspace | Yes | 1440 / 390 | Yes | Yes | No | QA + screenshots | Mobile topbar clip | CSS icon-only | Yes | Pass |
| Six routes/history | Yes | Web visible | Yes | Yes | No | route matrix | None | N/A | Yes | Pass |
| Keyboard physical | Yes | Web/Desktop | No | No | Yes | Electron synthesis inconclusive | None confirmed | N/A | No | Blocked |
| Context/composer | Yes | Desktop/Web | Yes | Partial | Yes | compact context + honest states | Device flows pending | N/A | No | Partial |
| App Server resilience | Yes | Real process | Yes | Yes | No | same thread after restart | None | N/A | Yes | Pass |
| Security | Yes | Desktop/Web | Yes | Yes | No | sanitized outputs/tests | None | N/A | Yes | Pass |

Evidencia visual temporal: `cocreate-cert-web-desktop-fixed.png` y `cocreate-feature-parity-v2-navigation-mobile.png` en `/tmp`. Son artefactos de QA local, no datos de producto.

## 29. Remaining debt

### Blocking

- Microfono fisico: permiso, record, cancel, stop, cleanup, device change y deny/retry.
- Transcripcion real con provider configurado de forma segura.
- Picker nativo: cancel, single, multiple, image, invalid, size, remove, ownership, expiration y send.
- Drag-and-drop fisico con mouse/trackpad, multiples, invalidos, carpeta y limpieza.
- Teclado fisico para seis routes y composer.

### Non-blocking

- Firma Developer ID, icono propio y metadata de paquete.
- Screenshot Desktop CDP no capturado; la evidencia funcional JSON si existe.

### Upstream-dependent

- Plan, Skills, Plugins y MCP lifecycle siguen experimentales y pinneados a 0.134.0.
- Scheduled Tasks, Sites y GitHub/PRs esperan surfaces oficiales/seguras.

### External infrastructure

- Provider de transcripcion Desktop no configurado en este entorno.
- Assistive Access no permitio controlar el dialogo nativo.

### Future product work

- Live Coding, Co-Coding, Context y Memory permanecen fuera de alcance y no se iniciaron.

### Checklist humana exacta

1. Configurar el provider de transcripcion solo mediante `.env.local`/secret store y reiniciar el paquete; no pegar keys en UI o logs.
2. Abrir CoCreate Desktop, ir a Chat y comprobar que el boton Voice esta habilitado antes de conceder permiso.
3. Pulsar Voice, elegir Allow y confirmar indicador visual/accesible; cancelar y verificar que desaparece el indicador del sistema.
4. Grabar de nuevo, hablar una frase de prueba, detener, revisar la transcripcion y enviarla solo con Start.
5. Repetir con permiso Deny, Retry y cambio/desconexion de dispositivo; confirmar que Chat sigue usable y no quedan tracks.
6. Abrir `+ > Adjuntar archivo`, cancelar, reabrir, seleccionar uno, multiples y una imagen; remover uno y todos.
7. Probar archivo vacio, mayor de 20 MB, extension no permitida, symlink y carpeta; confirmar mensaje especifico y ausencia de rutas completas.
8. Enviar un Turn con archivo permitido y confirmar que el tray se limpia y upstream recibe el input una sola vez.
9. Arrastrar uno, multiples, duplicado, invalido, grande y carpeta con mouse y trackpad; navegar entre routes y confirmar cero adjuntos fantasma.
10. Recorrer las seis routes con Tab, Enter y Space; probar back/forward/refresh, focus visible, composer y Escape en menus.
11. Desconectar de forma segura un MCP de prueba no critico, refrescar, reconectar y confirmar error/recuperacion sin tocar secrets.
12. Registrar hora, dispositivo generico, resultado y screenshot sin credenciales; si cualquier paso falla, mantener `PROMPT #10 INCOMPLETO`.

## 30. Final readiness

| Area | Evaluacion |
| --- | --- |
| Daily use readiness | Core coding confiable; experiencia diaria completa no certificada por voz/adjuntos fisicos |
| Private beta readiness | Condicional para un beta controlado sin depender de voz/picker; no para cierre general |
| Live Coding readiness | No: permanecen gates criticos de Feature Parity sin evidencia fisica |

Respuesta a la condicion de salida: CoCreate ya demuestra una base diaria solida sobre Codex para Workspace y coding, pero no puede declararse experiencia diaria completa ni avanzar formalmente a Live Coding mientras los gates criticos de dispositivo sigan pendientes.
