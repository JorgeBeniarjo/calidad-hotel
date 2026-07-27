# Backend de Apps Script — cómo desplegar

`backend/Codigo.gs` es una copia versionada del backend real, que vive en un
proyecto de Google Apps Script fuera de este repositorio (en
`script.google.com`). Cambios en este archivo no tienen ningún efecto hasta
que se copian a mano al editor de Apps Script y se publica una nueva
implementación.

Sigue estos pasos **en este orden exacto** para llevar los cambios de este
repositorio al backend real:

1. **Compara antes de pegar.** Abre el proyecto de Apps Script en
   `script.google.com` y compara su contenido actual contra
   `backend/Codigo.gs` de este repositorio. Si hay cambios hechos a mano
   directamente en el editor que no estén aquí, decide cómo conciliarlos
   antes de sobrescribir — pegar este archivo tal cual los perdería.
2. **Añade las columnas nuevas primero.** En la hoja `REVISIONES` de Google
   Sheets, añade estas 3 columnas nuevas al final de las existentes, en
   este orden exacto: `INCIDENCIA`, `PUNTUACION_ORIGINAL`, `CLIENT_ID`.
   Déjalas vacías para las filas existentes. Este paso debe ir ANTES de
   publicar el código nuevo: si se publica primero, la comprobación de
   `CLIENT_ID` no encuentra la columna y no protege nada (sin dar ningún
   error), y los datos de incidencia tampoco se guardan.
3. **Pega el código.** Copia el contenido de `backend/Codigo.gs` en
   `Codigo.gs` dentro del editor de Apps Script.
4. **Publica una Nueva implementación.** En el editor, usa
   "Implementar" → "Nueva implementación" (no basta con guardar el script:
   si el deployment no se actualiza, la web app sigue sirviendo la versión
   antigua).
5. **Recarga la PWA por completo en el móvil.** Cierra la app (o el
   navegador) donde está instalada y ábrela de nuevo, para que el Service
   Worker tome la nueva versión de caché y el código del frontend quede
   actualizado.
