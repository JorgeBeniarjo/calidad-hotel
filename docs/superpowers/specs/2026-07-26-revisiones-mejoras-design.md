# Diseño: Borrado, re-puntuación con incidencia, y fin de duplicados

## Contexto

`calidad-hotel-dev` es una PWA (sin build, HTML/CSS/JS vanilla) para que supervisores de un hotel
registren revisiones de calidad de habitaciones. El frontend vive en este repositorio
(`index.html`, `nueva-revision.html`, `revisiones.html`, `js/app.js`, `js/sheets.js`, `sw.js`).
El backend es un proyecto de Google Apps Script (`Codigo.gs`, no versionado en este repo) que lee
y escribe sobre una Google Sheet (`SPREADSHEET_ID`), con hojas `HABITACIONES`, `PERSONAL`,
`REVISIONES` y `FOTOS`. Las fotos se guardan como archivos en una carpeta de Google Drive.

El usuario (supervisor/administrador de calidad) ha pedido tres mejoras relacionadas, todas sobre
el ciclo de vida de una revisión:

1. Poder borrar una revisión creada por error.
2. Poder cambiar la puntuación de una revisión después de que se resuelva una incidencia
   (p. ej. "puntúo 2, pido que rehagan la cama, la camarera lo corrige, subo la nota a 5"),
   dejando constancia de que hubo una incidencia.
3. Corregir un bug de duplicados: a veces se crean revisiones duplicadas, tanto al guardar una
   revisión nueva como (según observa el usuario) al editar una existente. El usuario sospecha
   que la pérdida de cobertura WiFi al recorrer las habitaciones del hotel tiene algo que ver.

## Diagnóstico de los duplicados

**Nueva Revisión — causa confirmada.** `doPost` en `Codigo.gs` genera un `Utilities.getUuid()` y
hace `appendRow` en cada llamada, sin ninguna clave de idempotencia que permita detectar "esta
petición ya se guardó". En el frontend, `enviarFormulario` (`js/app.js`) no deshabilita el botón
"GUARDAR REVISIÓN" mientras la petición está en curso, y el mensaje de error
("Error guardando, se reintentará luego") es engañoso: **no existe ningún reintento automático en
el código**. Combinado con una red WiFi débil en pasillos/habitaciones, se produce este patrón:

1. El dispositivo envía la petición; Apps Script la recibe, la procesa (puede tardar varios
   segundos, más si hay fotos) y graba la fila con éxito en el servidor.
2. La conexión se corta antes de que el dispositivo reciba la respuesta → el `fetch` falla o hace
   timeout → la app muestra el toast de error.
3. El usuario, creyendo que no se guardó, repite la acción manualmente → segunda fila con un UUID
   distinto → duplicado.

Un doble toque accidental sobre el botón (sin red de por medio) produce el mismo resultado, ya que
cada llamada genera su propia fila de forma independiente.

**Editar — causa no confirmada, pero explicable.** `actualizarCamposRevision` en el backend busca
la fila por `ID_REVISION` y hace `setValue` — nunca `appendRow`. Con el código tal cual está, no
debería poder crear una fila nueva. La explicación más probable es que **la implementación
(deployment) de Apps Script publicada en la URL que usa la app no sea la versión más reciente del
código** (un problema clásico de Apps Script: guardar cambios en el editor no actualiza la web app
publicada salvo que se cree una "Nueva implementación"). Este diseño incluye, como parte de la
implementación, verificar/republicar el deployment. Además, el rediseño del punto 2 (permitir
cambiar la puntuación desde "Editar") elimina el motivo que hoy empuja a usar "Nueva Revisión"
como truco para actualizar la nota de una habitación ya revisada — si ese truco era la causa real
de lo que el usuario percibía como "duplicado al editar", desaparece con este cambio.

## 1. Botón Borrar

Borrado físico (no soft-delete), tal como ha pedido el usuario.

- **Backend**: nueva acción `eliminarRevision(idRevision)` en `Codigo.gs`, invocada vía
  `doPost` con `action=eliminarRevision`. Busca la fila en `REVISIONES` por `ID_REVISION` y la
  borra (`deleteRow`). Busca todas las filas asociadas en `FOTOS` (mismo `ID_REVISION`), y para
  cada una: manda el archivo de Drive correspondiente a la papelera (`setTrashed(true)` —
  reversible desde Drive, no lo destruye de forma permanente) y borra la fila de `FOTOS`. Recorre
  las filas de `FOTOS` de abajo hacia arriba para no desajustar los índices al borrar. Si no
  encuentra la revisión, responde `{success:false, error:'Revisión no encontrada'}`.
- **Frontend**: en `mostrarDetalleRevision` (`js/app.js`), nuevo botón "Borrar" (rojo, estilo
  peligro) en el footer del modal, junto a "Editar"/"Cerrar"/"Marcar como RESUELTA". Al pulsarlo,
  pide confirmación nativa (`confirm()`) indicando que también se borrarán las fotos asociadas. Si
  se confirma, llama a `sheetsAPI.eliminarRevision(id)`, quita la revisión de
  `revisionesCache`, cierra el modal, refresca la lista y muestra un toast de éxito.
- **`sheets.js`**: nueva función `eliminarRevision(id_revision)` que hace POST con
  `action=eliminarRevision` e `id_revision`, siguiendo el mismo patrón que
  `actualizarCamposRevision`.

## 2. Cambiar puntuación tras incidencia resuelta, con registro

- **Hoja `REVISIONES`** (acción manual pendiente del usuario): añadir dos columnas nuevas,
  `INCIDENCIA` (valores `SI`/`NO`, vacío se trata como `NO`) y `PUNTUACION_ORIGINAL` (numérico,
  vacío si nunca hubo incidencia). Se indicará el nombre exacto y la posición al implementar.
- **Backend**: `actualizarCamposRevision` gana `PUNTUACION` como campo editable. Antes de
  aplicar el cambio, si `datos.PUNTUACION` viene informado, es distinto del valor actual en la
  hoja, **y la columna `INCIDENCIA` de esa fila todavía no es `SI`**, entonces: copia la
  puntuación actual a `PUNTUACION_ORIGINAL` y pone `INCIDENCIA = 'SI'` antes de sobrescribir
  `PUNTUACION`. Ediciones posteriores de la puntuación ya no vuelven a tocar
  `PUNTUACION_ORIGINAL` (solo se registra la primera incidencia).
- **`getRevisiones()`**: debe devolver también `INCIDENCIA` y `PUNTUACION_ORIGINAL` para que el
  frontend pueda mostrarlas.
- **Frontend — modal Editar** (`abrirEditorRevision`/`guardarEdicion`/`edit-modal` en
  `revisiones.html`): se añade un slider de puntuación (mismo componente visual que en
  Nueva Revisión, 1–5) precargado con la puntuación actual. Se envía como parte de `datos` en
  `actualizarCamposRevision`.
- **Frontend — modal Detalle** (`mostrarDetalleRevision`): si `rev.INCIDENCIA === 'SI'`, se
  muestra un aviso visual ("⚠ Hubo incidencia") junto con la puntuación original
  (`rev.PUNTUACION_ORIGINAL`), sin ocultar la puntuación final vigente.

## 3. Fin de duplicados

- **Frontend — guardas de doble envío** (`enviarFormulario` y `guardarEdicion` en
  `js/app.js`): guardia por bandera (`this._guardandoRevision` /
  `this._guardandoEdicion`) que corta cualquier llamada mientras una ya está en curso, y
  deshabilitar el botón correspondiente (`btn-guardar` / botón "Guardar cambios") nada más
  empezar, reactivándolo en el `finally` tanto en éxito como en error.
- **Mensaje de error honesto**: cambiar el toast de "Error guardando, se reintentará luego" (que
  promete un reintento automático inexistente) por un mensaje que refleje la realidad, p. ej.
  "Error guardando. Comprueba tu conexión y vuelve a intentarlo." No se construye una cola de
  reintento automático offline — sería una pieza de infraestructura considerable
  (IndexedDB, sincronización en segundo plano) desproporcionada para el volumen de uso de un
  único hotel; la combinación de guardas de UI + idempotencia de backend (siguiente punto) ya
  hace segura la opción de "vuelve a intentarlo a mano".
- **Idempotencia en backend (la protección real contra el escenario de WiFi)**:
  - `js/app.js` genera un `CLIENT_ID` (UUID vía `crypto.randomUUID()`, con fallback simple si no
    está disponible) en el momento de pulsar "Guardar" en Nueva Revisión, y lo incluye en
    `datos.CLIENT_ID` enviado a `guardarRevision`.
  - **Hoja `REVISIONES`** (acción manual pendiente del usuario): añadir columna `CLIENT_ID`.
  - **Backend**: en el flujo de creación de `doPost`, antes de `appendRow`, recorre `REVISIONES`
    buscando una fila con el mismo `CLIENT_ID`. Si ya existe, no inserta nada nuevo — responde
    `{success:true, id: <ID_REVISION existente>}` (mismo contrato que la creación normal). Si no
    existe, procede como hoy y guarda también el `CLIENT_ID` en la nueva fila.
  - Con esto, si el mismo intento de guardado se reenvía (doble toque que se cuela pese a la
    guarda de UI, o el usuario reintenta a mano tras un "falso error" de red), el backend lo
    reconoce y no duplica la fila.
  - Nota de alcance: si el usuario navega fuera del formulario y vuelve a rellenarlo desde cero,
    se genera un `CLIENT_ID` nuevo — se trata como una revisión legítimamente nueva, que es el
    comportamiento correcto.
- **Verificar el deployment de Apps Script**: al terminar los cambios de backend, confirmar que
  se publica una "Nueva implementación" (o que el deployment usa "Head" y por tanto ya sirve el
  código actualizado), para asegurar que la URL en `js/sheets.js` sirve siempre la versión más
  reciente del script.

## Fuera de alcance

- Cola de reintento offline automática (IndexedDB + background sync) para cuando falla el guardado
  por completo — el usuario puede reintentar a mano de forma segura gracias a la idempotencia.
- Historial completo de múltiples cambios de puntuación (el usuario ha confirmado que con un
  aviso de "hubo incidencia" + la puntuación original es suficiente).
- Soft-delete / papelera dentro de la propia app para revisiones borradas (el usuario ha pedido
  borrado físico).

## Acciones manuales pendientes del usuario

Antes o durante la implementación, hay que añadir a mano estas columnas en la hoja `REVISIONES`
de Google Sheets (se indicarán nombres exactos y aparecerán vacías para las filas existentes):

- `INCIDENCIA`
- `PUNTUACION_ORIGINAL`
- `CLIENT_ID`

Y, tras aplicar los cambios de `Codigo.gs`, publicar una nueva implementación del proyecto de
Apps Script para que la web app sirva el código actualizado.
