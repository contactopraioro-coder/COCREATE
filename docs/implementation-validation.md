# Implementation Validation

## Detección segura

El runtime detecta comandos declarados por el Project, sin instalar dependencias ni ejecutar texto generado por el modelo.

- Node: scripts `typecheck`, `lint`, `test` y `build`, respetando npm, pnpm, yarn o bun.
- Python: `python3 -m compileall -q .` cuando existe `pyproject.toml`.
- Rust: `cargo check` y `cargo test` cuando existe `Cargo.toml`.
- Go: `go test ./...` cuando existe `go.mod`.

Si no hay una estrategia conocida, el resultado es `Unavailable`, nunca `Passed`. Un ejecutable ausente también se reporta como no disponible.

## Resultados

Cada check conserva label, comando conocido, duración, estado, resumen, evidencia sanitizada y recomendación. Los estados son `passed`, `failed`, `unavailable` o `cancelled`.

Un fallo o timeout no revierte automáticamente un Apply correcto. La operación termina `Completed with warnings`, conserva el código visible y ofrece rollback. La cancelación durante Validation conserva el checkpoint y permite revertir de forma explícita.

La salida está limitada, elimina roots locales y redacta credenciales, tokens, passwords y secretos.

