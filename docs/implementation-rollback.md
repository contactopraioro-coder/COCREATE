# Implementation Rollback

## Checkpoint

Antes del primer archivo, el runtime guarda exclusivamente los paths afectados. Para cada path conserva existencia, hash y modo; los archivos existentes se copian a un directorio privado. El checkpoint se verifica antes de habilitar Apply.

## Rollback automático

Si un archivo falla o llega una cancelación en Apply, se restauran las entradas en orden seguro. Después se recalculan hashes y permisos. El resultado distingue rollback completo, parcial o fallido; nunca se anuncia éxito sin verificación.

## Rollback manual

Una implementación aplicada expone `Revertir esta implementación`. Antes de restaurar, el runtime compara cada path con el manifest post-Apply. Si encuentra trabajo posterior, bloquea la reversión y crea conflictos explícitos para no destruirlo.

Una reversión segura restaura el checkpoint, verifica hashes y modos, vuelve a ejecutar validaciones, refresca Current y termina como `Rolled back`.

Rollback no ejecuta Git, no altera commits y no revierte archivos ajenos al change set.

