# Proposal Workspaces

## Estrategia elegida

Desktop utiliza **Temporary Copy-on-Write Workspace** bajo `userData/state/proposals`.

Se evaluaron estas alternativas:

| Estrategia | Ventaja | Riesgo | Decisión |
| --- | --- | --- | --- |
| Git worktree | Diff y branches nativos | Requiere Git limpio, repo válido y administración de refs | No es universal |
| In-memory overlay | Muy rápido | Herramientas, bundlers y Codex esperan filesystem real | Insuficiente |
| Sandbox remoto | Aislamiento fuerte | Añade cloud, red y credenciales fuera de alcance | Diferido |
| Temporary copy-on-write | Funciona con y sin Git, es destruible y usa herramientas normales | Copia fuentes | Elegida |

La estrategia elegida no toca `.git`, no crea branches y funciona para Projects que no son repositorios.

## Estructura administrada

```text
proposals/
  proposal-runtime.json
  workspaces/
    proposal-<uuid>/
      project/
  transactions/
    proposal-<uuid>-<timestamp>/
      backup/
```

Las rutas nunca cruzan IPC. El registro público expone únicamente IDs, estados y metadatos de producto.

## Creación y recreación

La primera Proposal copia `Current`. Una iteración posterior copia el workspace de su Proposal padre y conserva el manifest original de `Current`. Esto permite historial acumulativo sin aplicar pasos intermedios.

La copia ignora:

- `.git`, builds, coverage y caches;
- dependencias pesadas;
- `.env*`, `.npmrc`, credenciales, certificados y llaves;
- symlinks.

`node_modules` se enlaza desde el Project para evitar otra instalación y acelerar Vite/Next. El sandbox de Codex mantiene como writable root únicamente la copia.

## Diff y conflictos

Al crear la Proposal se calcula un manifest SHA-256 de `Current`. Después de cada iteración se compara ese manifest con la copia. Antes de Apply se vuelve a calcular el manifest de Current para cada archivo modificado. Si Current cambió externamente, Apply se detiene en lugar de sobrescribir.

## Apply transaccional

1. Validar rutas y rechazar secretos/symlinks.
2. Respaldar cada archivo actual.
3. Copiar o eliminar únicamente archivos presentes en el diff.
4. Si todo pasa, marcar `Applied`.
5. Detener preview y eliminar la copia temporal.
6. Si algo falla, restaurar backups en orden inverso y marcar `Failed`.

No se ejecuta Git. El usuario conserva el control sobre commit, push y PR.

## Persistencia y limpieza

Metadatos, manifest, diff, validaciones y timeline se guardan de forma atómica con permisos locales restrictivos. Los procesos no sobreviven al cierre. En el próximo arranque una Proposal restaurada queda `stopped`, nunca falsamente `running`.

Los directorios no registrados se eliminan al inicializar. Las copias abandonadas superando el TTL se destruyen automáticamente, excepto versiones Ready o Approved que esperan una decisión del usuario.
