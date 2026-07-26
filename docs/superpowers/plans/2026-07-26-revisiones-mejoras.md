# Borrado, re-puntuación con incidencia y fin de duplicados — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir borrado de revisiones, permitir cambiar la puntuación tras una incidencia resuelta dejando constancia de ello, y eliminar los duplicados causados por reintentos en zonas de WiFi débil.

**Architecture:** PWA estática (sin build) con backend en Google Apps Script sobre una Google Sheet. Los cambios de backend se escriben y versionan primero en este repo (`backend/Codigo.gs`), y luego se copian manualmente al editor de Apps Script (no hay API de despliegue automatizado disponible en esta sesión). Los cambios de frontend son ediciones directas de `js/app.js`, `js/sheets.js`, `revisiones.html` y `css/app.css`.

**Tech Stack:** HTML/CSS/JS vanilla (sin framework, sin bundler), Google Apps Script (V8 runtime), Google Sheets como almacén de datos, Google Drive para fotos.

## Global Constraints

- No existe framework de tests automatizado en este proyecto (ni para el frontend ni para Apps Script). La verificación de cada tarea combina: (a) `node --check` sobre los archivos `.js`/`.gs` modificados como chequeo sintáctico real y automatizable, (b) `grep` para confirmar que el código esperado quedó presente, y (c) pasos manuales explícitos marcados **HUMAN CHECKPOINT** para todo lo que requiera el editor de Apps Script, la hoja de cálculo real, o probar la app en un teléfono — nada de eso es accesible por un agente en esta sesión.
- Cualquier cambio en `js/app.js`, `js/sheets.js`, `js/camera.js`, `css/app.css`, `index.html`, `nueva-revision.html`, `revisiones.html`, `manifest.json` o `sw.js` requiere subir `CACHE_NAME` en `sw.js` para que el Service Worker fuerce la recarga en los móviles que ya tienen la PWA instalada (convención ya usada en este repo, ver commit `091a192`). Se hace una sola vez al final de todo el trabajo (Task 9), no en cada tarea intermedia.
- El backend real vive fuera de este repo, en un proyecto de Apps Script en `script.google.com`. `backend/Codigo.gs` es la copia versionada que se mantiene sincronizada a mano; cualquier tarea de backend termina con una nota de qué copiar y dónde.
- Las columnas nuevas de la hoja `REVISIONES` deben añadirse **en este orden exacto al final** de las columnas existentes, porque `appendRow` escribe por posición: `INCIDENCIA` (col. 15), `PUNTUACION_ORIGINAL` (col. 16), `CLIENT_ID` (col. 17). Los accesos de lectura (`actualizarCamposRevision`, `getRevisiones`) son por nombre de cabecera (`indexOf`), así que sí toleran que el usuario las añada en otras posiciones, pero `appendRow` en la creación no — de ahí la exigencia de orden.

---

## Task 1: Versionar el backend actual de Apps Script

**Files:**
- Create: `backend/Codigo.gs`

**Interfaces:**
- Produces: contenido íntegro y sin cambios del `Codigo.gs` actual (tal y como está desplegado hoy), como base sobre la que las Tasks 2, 5 y 7 aplicarán modificaciones.

- [ ] **Step 1: Crear el directorio y el archivo con el contenido actual**

Crea `backend/Codigo.gs` con exactamente este contenido (es el código que ya está desplegado, sin ningún cambio funcional todavía):

```javascript
// ============================================================
// HOTEL TRES ANCLAS - Control de Calidad
// Codigo.gs - Funciones auxiliares y API REST
// ============================================================

const SPREADSHEET_ID = '1lx_t2Xf8OyWL_QbdiePhyDaA6VxyCwXnu5FP_o8PqEw';
const DRIVE_FOLDER_ID = '1sdxA_W51JvxYwR5tHTSTrYaGN3FkWH2k';

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const hoja = ss.getSheetByName(sheetName);
  if (!hoja) return [];

  const valores = hoja.getDataRange().getValues();
  if (valores.length < 2) return [];

  const cabeceras = valores[0];
  const filas = valores.slice(1);

  return filas.map(fila => {
    const obj = {};
    cabeceras.forEach((cabecera, i) => {
      obj[cabecera] = fila[i];
    });
    return obj;
  });
}

function corsResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getHabitaciones() {
  const datos = getSheetData('HABITACIONES');
  const activas = datos.filter(row =>
    String(row['ACTIVO']).toUpperCase() === 'SÍ' ||
    String(row['ACTIVO']).toUpperCase() === 'SI'
  );
  const resultado = activas.map(row => ({
    ID_HABITACION: row['ID_HABITACION'],
    PLANTA: row['PLANTA'],
    TIPOLOGIA: row['TIPOLOGIA']
  }));
  resultado.sort((a, b) => Number(a.ID_HABITACION) - Number(b.ID_HABITACION));
  return corsResponse({ success: true, data: resultado });
}

function getPersonal(rol) {
  const datos = getSheetData('PERSONAL');
  const filtrado = datos.filter(row => {
    const activo = String(row['ACTIVO']).toUpperCase() === 'SÍ' ||
                   String(row['ACTIVO']).toUpperCase() === 'SI';
    const rolCorrecto = rol === '' || String(row['ROL']).toUpperCase() === rol.toUpperCase();
    return activo && rolCorrecto;
  });
  const resultado = filtrado.map(row => ({
    ID_PERSONAL: row['ID_PERSONAL'],
    NOMBRE: row['NOMBRE'],
    ROL: row['ROL']
  }));
  resultado.sort((a, b) => String(a.NOMBRE).localeCompare(String(b.NOMBRE)));
  return corsResponse({ success: true, data: resultado });
}

function getRevisiones() {
  const revisiones = getSheetData('REVISIONES');
  const fotos = getSheetData('FOTOS');
  const personal = getSheetData('PERSONAL');

  revisiones.sort((a, b) => new Date(b['TIMESTAMP']) - new Date(a['TIMESTAMP']));

  const resultado = revisiones.map(rev => {
    const fotosRevision = fotos
      .filter(f => f['ID_REVISION'] === rev['ID_REVISION'])
      .map(f => f['URL']);

    const camarera = personal.find(p => p['ID_PERSONAL'] === rev['ID_PERSONAL_TRABAJO']);
    const nombreCamarera = camarera ? camarera['NOMBRE'] : rev['ID_PERSONAL_TRABAJO'];

    const supervisor = personal.find(p => p['ID_PERSONAL'] === rev['ID_SUPERVISOR']);
    const nombreSupervisor = supervisor ? supervisor['NOMBRE'] : rev['ID_SUPERVISOR'];

    return {
      ID_REVISION: rev['ID_REVISION'],
      TIMESTAMP: rev['TIMESTAMP'],
      FECHA: rev['FECHA'],
      DEPARTAMENTO: rev['DEPARTAMENTO'],
      ID_HABITACION: rev['ID_HABITACION'],
      PLANTA: rev['PLANTA'],
      TIPOLOGIA: rev['TIPOLOGIA'],
      ID_PERSONAL_TRABAJO: rev['ID_PERSONAL_TRABAJO'],
      CAMARERA: nombreCamarera,
      ID_SUPERVISOR: rev['ID_SUPERVISOR'],
      SUPERVISOR: nombreSupervisor,
      PUNTUACION: rev['PUNTUACION'],
      OBSERVACIONES: rev['OBSERVACIONES'],
      ACCION_TOMADA: rev['ACCION_TOMADA'],
      REQUIRIO_REPASO: rev['REQUIRIO_REPASO'],
      ESTADO: rev['ESTADO'],
      FOTOS: fotosRevision
    };
  });

  return corsResponse({ success: true, data: resultado });
}

function actualizarCamposRevision(idRevision, datos) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hoja = ss.getSheetByName('REVISIONES');
    const valores = hoja.getDataRange().getValues();
    const cabeceras = valores[0];
    const colId = cabeceras.indexOf('ID_REVISION');

    for (let i = 1; i < valores.length; i++) {
      if (String(valores[i][colId]) === String(idRevision)) {
        const camposEditables = ['ID_PERSONAL_TRABAJO', 'ID_SUPERVISOR', 'OBSERVACIONES', 'ACCION_TOMADA'];
        camposEditables.forEach(campo => {
          if (datos.hasOwnProperty(campo)) {
            const col = cabeceras.indexOf(campo);
            if (col !== -1) hoja.getRange(i + 1, col + 1).setValue(datos[campo]);
          }
        });
        return corsResponse({ success: true });
      }
    }
    return corsResponse({ success: false, error: 'Revisión no encontrada' });
  } catch (err) {
    return corsResponse({ success: false, error: err.toString() });
  }
}

function actualizarEstadoRevision(idRevision, nuevoEstado) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hoja = ss.getSheetByName('REVISIONES');
    const datos = hoja.getDataRange().getValues();
    const cabeceras = datos[0];
    const colId = cabeceras.indexOf('ID_REVISION');
    const colEstado = cabeceras.indexOf('ESTADO');

    for (let i = 1; i < datos.length; i++) {
      if (datos[i][colId] === idRevision) {
        hoja.getRange(i + 1, colEstado + 1).setValue(nuevoEstado);
        return corsResponse({ success: true });
      }
    }
    return corsResponse({ success: false, error: 'Revisión no encontrada' });
  } catch (err) {
    return corsResponse({ success: false, error: err.toString() });
  }
}

// ============================================================
// ENTRY POINTS
// ============================================================

function doGet(e) {
  const action = e.parameter.action || '';

  if (action === 'habitaciones')    return getHabitaciones();
  if (action === 'personal')        return getPersonal(e.parameter.rol || '');
  if (action === 'revisiones')      return getRevisiones();
  if (action === 'actualizarEstado') {
    return actualizarEstadoRevision(
      e.parameter.id_revision,
      e.parameter.estado
    );
  }

  return corsResponse({ success: false, error: 'Acción no reconocida: ' + action });
}

function doPost(e) {
  try {
    const action = e.parameter.action || '';

    if (action === 'actualizarCampos') {
      const idRevision = e.parameter.id_revision;
      const datos = JSON.parse(e.parameter.datos);
      return actualizarCamposRevision(idRevision, datos);
    }

    const datosJSON = e.parameter.datos;
    if (!datosJSON) {
      return corsResponse({ success: false, error: 'No se recibieron datos' });
    }
    const datos = JSON.parse(datosJSON);

    const idRevision = Utilities.getUuid();
    const timestamp = new Date();

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaRevisiones = ss.getSheetByName('REVISIONES');
    const hojaFotos = ss.getSheetByName('FOTOS');

    hojaRevisiones.appendRow([
      idRevision,
      timestamp,
      datos.FECHA || '',
      datos.DEPARTAMENTO || 'PISOS',
      datos.ID_HABITACION || '',
      datos.PLANTA || '',
      datos.TIPOLOGIA || '',
      datos.ID_PERSONAL_TRABAJO || '',
      datos.ID_SUPERVISOR || '',
      datos.PUNTUACION || 0,
      datos.OBSERVACIONES || '',
      datos.ACCION_TOMADA || '',
      datos.REQUIRIO_REPASO || 'No',
      datos.ESTADO || 'ABIERTA'
    ]);

    const carpeta = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    let indiceFoto = 0;

    while (e.parameters['foto_' + indiceFoto]) {
      try {
        const fotoBase64 = e.parameter['foto_' + indiceFoto];
        const mimeType = e.parameter['foto_mime_' + indiceFoto] || 'image/jpeg';
        const nombreFoto = idRevision + '_' + indiceFoto + '.jpg';

        const blob = Utilities.newBlob(
          Utilities.base64Decode(fotoBase64),
          mimeType,
          nombreFoto
        );
        const archivo = carpeta.createFile(blob);
        archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        const urlFoto = 'https://lh3.googleusercontent.com/d/' + archivo.getId();

        hojaFotos.appendRow([
          Utilities.getUuid(),
          idRevision,
          urlFoto,
          timestamp,
          ''
        ]);

        indiceFoto++;
      } catch (errFoto) {
        Logger.log('Error subiendo foto ' + indiceFoto + ': ' + errFoto.toString());
        indiceFoto++;
      }
    }

    return corsResponse({
      success: true,
      id: idRevision,
      fotos_subidas: indiceFoto
    });

  } catch (err) {
    Logger.log('Error en doPost: ' + err.toString());
    return corsResponse({ success: false, error: err.toString() });
  }
}
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check backend/Codigo.gs`
Expected: sin salida (sintaxis válida). Apps Script usa globals (`SpreadsheetApp`, `DriveApp`, etc.) que Node no conoce, pero `--check` solo valida sintaxis, no ejecuta el código, así que no falla por eso.

- [ ] **Step 3: Commit**

```bash
git add backend/Codigo.gs
git commit -m "Versionar backend de Apps Script en el repo"
```

---

## Task 2: Backend — acción de borrado (`eliminarRevision`)

**Files:**
- Modify: `backend/Codigo.gs`

**Interfaces:**
- Consumes: constantes `SPREADSHEET_ID`, funciones `corsResponse(data)` de Task 1.
- Produces: función `eliminarRevision(idRevision)` y ruta `action === 'eliminarRevision'` en `doPost`, que Task 4 (frontend) invocará vía `POST` con campos de formulario `action=eliminarRevision` e `id_revision=<ID_REVISION>`.

- [ ] **Step 1: Añadir la función `eliminarRevision`**

En `backend/Codigo.gs`, añade esta función justo después de `actualizarEstadoRevision`:

```javascript
function eliminarRevision(idRevision) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaRev = ss.getSheetByName('REVISIONES');
    const hojaFotos = ss.getSheetByName('FOTOS');

    const valoresRev = hojaRev.getDataRange().getValues();
    const cabRev = valoresRev[0];
    const colIdRev = cabRev.indexOf('ID_REVISION');

    let filaEncontrada = -1;
    for (let i = 1; i < valoresRev.length; i++) {
      if (String(valoresRev[i][colIdRev]) === String(idRevision)) {
        filaEncontrada = i + 1;
        break;
      }
    }
    if (filaEncontrada === -1) {
      return corsResponse({ success: false, error: 'Revisión no encontrada' });
    }
    hojaRev.deleteRow(filaEncontrada);

    const valoresFotos = hojaFotos.getDataRange().getValues();
    const cabFotos = valoresFotos[0];
    const colIdRevFoto = cabFotos.indexOf('ID_REVISION');
    const colUrl = cabFotos.indexOf('URL');

    for (let i = valoresFotos.length - 1; i >= 1; i--) {
      if (String(valoresFotos[i][colIdRevFoto]) === String(idRevision)) {
        const url = valoresFotos[i][colUrl];
        const match = String(url).match(/\/d\/([^/]+)/);
        if (match) {
          try {
            DriveApp.getFileById(match[1]).setTrashed(true);
          } catch (errDrive) {
            Logger.log('No se pudo enviar a la papelera el archivo de Drive: ' + errDrive.toString());
          }
        }
        hojaFotos.deleteRow(i + 1);
      }
    }

    return corsResponse({ success: true });
  } catch (err) {
    return corsResponse({ success: false, error: err.toString() });
  }
}
```

- [ ] **Step 2: Añadir la ruta en `doPost`**

En `backend/Codigo.gs`, dentro de `doPost`, justo después del bloque `if (action === 'actualizarCampos') { ... }`, añade:

```javascript
    if (action === 'eliminarRevision') {
      return eliminarRevision(e.parameter.id_revision);
    }
```

- [ ] **Step 3: Verificar sintaxis y que la ruta quedó cableada**

Run: `node --check backend/Codigo.gs`
Expected: sin salida.

Run: `grep -n "eliminarRevision" backend/Codigo.gs`
Expected: aparece la definición de la función y la línea de `doPost` que la invoca (al menos 2 coincidencias).

- [ ] **Step 4: Commit**

```bash
git add backend/Codigo.gs
git commit -m "Backend: añadir acción eliminarRevision (borra fila y fotos asociadas)"
```

---

## Task 3: Frontend — cliente API para borrar (`sheetsAPI.eliminarRevision`)

**Files:**
- Modify: `js/sheets.js`

**Interfaces:**
- Consumes: `APPS_SCRIPT_URL` (ya existente en el archivo); backend `action=eliminarRevision` de Task 2.
- Produces: `sheetsAPI.eliminarRevision(id_revision)` — `async`, devuelve el `result` JSON del backend o lanza si `result.success` es falso. Task 4 la usa desde `appLogic.borrarRevision`.

- [ ] **Step 1: Añadir el método `eliminarRevision`**

En `js/sheets.js`, añade este método dentro del objeto `sheetsAPI`, justo después de `actualizarEstadoRevision` (antes de la llave de cierre `}` final del objeto):

```javascript
  /**
   * Eliminar una revisión y sus fotos asociadas
   * @param {string} id_revision
   */
  eliminarRevision: async (id_revision) => {
    try {
      const formData = new FormData();
      formData.append('action', 'eliminarRevision');
      formData.append('id_revision', id_revision);

      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        redirect: 'follow',
        body: formData
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      return result;
    } catch (error) {
      console.error('Error eliminarRevision:', error);
      throw error;
    }
  }
```

Recuerda añadir una coma después del método `actualizarEstadoRevision` existente (pasa de ser el último miembro del objeto a tener este nuevo método a continuación).

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check js/sheets.js`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add js/sheets.js
git commit -m "Frontend: añadir sheetsAPI.eliminarRevision"
```

---

## Task 4: Frontend — botón Borrar en el modal de detalle

**Files:**
- Modify: `js/app.js`
- Modify: `css/app.css`

**Interfaces:**
- Consumes: `sheetsAPI.eliminarRevision` (Task 3); `appLogic.revisionesCache`, `appLogic.renderListaRevisiones()`, `appLogic.mostrarLoader()`, `appLogic.mostrarToast()` (ya existentes).
- Produces: `appLogic.borrarRevision(id_revision, index)`; botón "Borrar" añadido en `footerActions` dentro de `mostrarDetalleRevision`; clase CSS `.btn-danger`.

- [ ] **Step 1: Añadir el estilo `.btn-danger` en `css/app.css`**

Añade esto justo después de la regla `.btn-secondary` (línea 336 del archivo actual, `}` de cierre de `.btn-secondary`):

```css
.btn-danger {
  background-color: var(--danger-color);
  color: white;
}

.btn-danger:active {
  background-color: #c9302c;
}
```

- [ ] **Step 2: Añadir el botón "Borrar" en `mostrarDetalleRevision`**

En `js/app.js`, dentro de `mostrarDetalleRevision`, justo después de este bloque existente:

```javascript
    const btnEditar = document.createElement('button');
    btnEditar.className = 'btn btn-secondary';
    btnEditar.style.flex = '1';
    btnEditar.innerText = 'Editar';
    btnEditar.onclick = () => this.abrirEditorRevision(index);
    footerActions.appendChild(btnEditar);
```

añade:

```javascript
    const btnBorrar = document.createElement('button');
    btnBorrar.className = 'btn btn-danger';
    btnBorrar.style.flex = '1';
    btnBorrar.innerText = 'Borrar';
    btnBorrar.onclick = () => this.borrarRevision(rev.ID_REVISION, index);
    footerActions.appendChild(btnBorrar);
```

- [ ] **Step 3: Añadir el método `borrarRevision`**

En `js/app.js`, añade este método dentro de `appLogic`, justo después de `resolverRevision` (antes de la llave de cierre `}` final del objeto `appLogic`):

```javascript
  borrarRevision: async function (id_revision, index) {
    if (!id_revision) {
      this.mostrarToast('Falta campo ID_REVISION para borrar', 'error');
      return;
    }

    const confirmado = window.confirm(
      '¿Seguro que quieres borrar esta revisión? También se borrarán sus fotos asociadas. Esta acción no se puede deshacer desde la app.'
    );
    if (!confirmado) return;

    this.mostrarLoader(true);
    try {
      await sheetsAPI.eliminarRevision(id_revision);
      this.mostrarToast('Revisión borrada correctamente');
      document.getElementById('review-modal').style.display = 'none';
      this.revisionesCache.splice(index, 1);
      this.renderListaRevisiones();
    } catch (error) {
      this.mostrarToast('Error al borrar la revisión', 'error');
    } finally {
      this.mostrarLoader(false);
    }
  }
```

Recuerda añadir una coma después de `resolverRevision` para que la sintaxis del objeto siga siendo válida.

- [ ] **Step 4: Verificar sintaxis y presencia del código**

Run: `node --check js/app.js`
Expected: sin salida.

Run: `grep -n "borrarRevision\|btn-danger" js/app.js css/app.css`
Expected: coincidencias tanto en `js/app.js` (definición del método y su uso en `footerActions.appendChild`) como en `css/app.css` (la clase `.btn-danger`).

- [ ] **Step 5: Commit**

```bash
git add js/app.js css/app.css
git commit -m "Frontend: añadir botón Borrar en el detalle de revisión"
```

- [ ] **Step 6: HUMAN CHECKPOINT — probar en la app real**

Este paso no lo puede ejecutar un agente: requiere copiar el backend actualizado al editor de Apps Script y usar la app real.

1. Abre `script.google.com`, entra al proyecto de Apps Script vinculado a esta hoja.
2. Reemplaza el contenido de `Codigo.gs` por el contenido actual de `backend/Codigo.gs` de este repo (ya incluye la Task 2).
3. Guarda y crea una **Nueva implementación** ("Implementar" → "Nueva implementación") del tipo "Aplicación web", manteniendo la misma URL si el editor lo permite (para no tener que cambiar `APPS_SCRIPT_URL` en `js/sheets.js`).
4. Abre `revisiones.html` en el móvil o navegador, entra a una revisión de prueba (usa una que no importe perder) y pulsa "Borrar". Confirma el diálogo.
5. Verifica en la Google Sheet que la fila de `REVISIONES` desapareció y que las filas asociadas en `FOTOS` también, y que las fotos correspondientes están en la papelera de la carpeta de Drive (no borradas de forma permanente).

---

## Task 5: Backend — re-puntuación con registro de incidencia

**Files:**
- Modify: `backend/Codigo.gs`

**Interfaces:**
- Consumes: función `actualizarCamposRevision` y `getRevisiones` existentes (Task 1).
- Produces: `actualizarCamposRevision` acepta ahora `PUNTUACION` en `datos`, y registra `INCIDENCIA`/`PUNTUACION_ORIGINAL` la primera vez que la puntuación cambia tras la creación. `getRevisiones()` devuelve también los campos `INCIDENCIA` y `PUNTUACION_ORIGINAL`, que Task 6 (frontend) usará.

- [ ] **Step 1: Reescribir `actualizarCamposRevision` con la lógica de incidencia**

En `backend/Codigo.gs`, sustituye la función `actualizarCamposRevision` completa por:

```javascript
function actualizarCamposRevision(idRevision, datos) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hoja = ss.getSheetByName('REVISIONES');
    const valores = hoja.getDataRange().getValues();
    const cabeceras = valores[0];
    const colId = cabeceras.indexOf('ID_REVISION');

    for (let i = 1; i < valores.length; i++) {
      if (String(valores[i][colId]) === String(idRevision)) {
        const fila = i + 1;

        if (datos.hasOwnProperty('PUNTUACION')) {
          const colPuntuacion = cabeceras.indexOf('PUNTUACION');
          const colIncidencia = cabeceras.indexOf('INCIDENCIA');
          const colPuntuacionOriginal = cabeceras.indexOf('PUNTUACION_ORIGINAL');
          const puntuacionActual = valores[i][colPuntuacion];
          const nuevaPuntuacion = datos.PUNTUACION;
          const yaHuboIncidencia = String(valores[i][colIncidencia]).toUpperCase() === 'SI' ||
                                    String(valores[i][colIncidencia]).toUpperCase() === 'SÍ';

          if (String(puntuacionActual) !== String(nuevaPuntuacion) && !yaHuboIncidencia) {
            if (colPuntuacionOriginal !== -1) hoja.getRange(fila, colPuntuacionOriginal + 1).setValue(puntuacionActual);
            if (colIncidencia !== -1) hoja.getRange(fila, colIncidencia + 1).setValue('SI');
          }
          if (colPuntuacion !== -1) hoja.getRange(fila, colPuntuacion + 1).setValue(nuevaPuntuacion);
        }

        const camposEditables = ['ID_PERSONAL_TRABAJO', 'ID_SUPERVISOR', 'OBSERVACIONES', 'ACCION_TOMADA'];
        camposEditables.forEach(campo => {
          if (datos.hasOwnProperty(campo)) {
            const col = cabeceras.indexOf(campo);
            if (col !== -1) hoja.getRange(fila, col + 1).setValue(datos[campo]);
          }
        });
        return corsResponse({ success: true });
      }
    }
    return corsResponse({ success: false, error: 'Revisión no encontrada' });
  } catch (err) {
    return corsResponse({ success: false, error: err.toString() });
  }
}
```

- [ ] **Step 2: Devolver `INCIDENCIA` y `PUNTUACION_ORIGINAL` desde `getRevisiones`**

En `backend/Codigo.gs`, dentro de `getRevisiones`, en el objeto que se devuelve por cada revisión (el que empieza en `ID_REVISION: rev['ID_REVISION'],`), añade estas dos líneas justo después de `ESTADO: rev['ESTADO'],`:

```javascript
      INCIDENCIA: rev['INCIDENCIA'] || 'NO',
      PUNTUACION_ORIGINAL: rev['PUNTUACION_ORIGINAL'] || '',
```

- [ ] **Step 3: Verificar sintaxis y presencia del código**

Run: `node --check backend/Codigo.gs`
Expected: sin salida.

Run: `grep -n "INCIDENCIA\|PUNTUACION_ORIGINAL" backend/Codigo.gs`
Expected: coincidencias tanto en `actualizarCamposRevision` como en `getRevisiones`.

- [ ] **Step 4: Commit**

```bash
git add backend/Codigo.gs
git commit -m "Backend: registrar incidencia al cambiar la puntuación de una revisión"
```

---

## Task 6: Frontend — puntuación editable e indicador de incidencia

**Files:**
- Modify: `revisiones.html`
- Modify: `js/app.js`
- Modify: `css/app.css`

**Interfaces:**
- Consumes: backend de Task 5 (`actualizarCamposRevision` con `PUNTUACION`, `getRevisiones` con `INCIDENCIA`/`PUNTUACION_ORIGINAL`); `sheetsAPI.actualizarCamposRevision` ya existente.
- Produces: slider `#edit-puntuacion` / `#edit-score-display` en el modal de edición; `appLogic.setupEditScoreSlider()`; badge de incidencia en el modal de detalle.

- [ ] **Step 1: Añadir el slider de puntuación al modal de edición**

En `revisiones.html`, dentro de `#edit-modal`, justo después de este bloque existente:

```html
          <div class="form-group">
            <label for="edit-supervisor">SUPERVISOR</label>
            <select id="edit-supervisor" class="form-control">
              <option value="">-- Sin asignar --</option>
            </select>
          </div>
```

añade:

```html
          <div class="form-group">
            <label>PUNTUACIÓN</label>
            <div class="slider-container">
              <div id="edit-score-display" class="score-display">5</div>
              <input
                type="range"
                id="edit-puntuacion"
                min="1"
                max="5"
                value="5"
                step="1"
              />
            </div>
          </div>
```

- [ ] **Step 2: Añadir `.badge-incidencia` en `css/app.css`**

Añade esto justo después de la regla `.badge-resuelta` (línea 529 del archivo actual):

```css
.badge-incidencia {
  background-color: var(--warning-color);
}
```

- [ ] **Step 3: Añadir `setupEditScoreSlider` a `appLogic`**

En `js/app.js`, añade este método dentro de `appLogic`, justo después de `setupToggles`:

```javascript
  setupEditScoreSlider: function () {
    const input = document.getElementById('edit-puntuacion');
    const display = document.getElementById('edit-score-display');
    if (!input || !display) return;

    const updateColor = (val) => {
      display.textContent = val;
      if (val <= 2) display.style.color = 'var(--danger-color)';
      else if (val <= 3) display.style.color = 'var(--warning-color)';
      else display.style.color = 'var(--success-color)';
    };

    input.addEventListener('input', (e) => updateColor(e.target.value));
    this._actualizarColorPuntuacionEdicion = updateColor;
  },
```

- [ ] **Step 4: Llamar a `setupEditScoreSlider` al iniciar la lista de revisiones**

En `js/app.js`, en el `window.addEventListener('DOMContentLoaded', ...)` del final del archivo, dentro de la rama:

```javascript
  } else if (document.getElementById('review-list')) {
    appLogic.initListaRevisiones();
  }
```

cámbiala por:

```javascript
  } else if (document.getElementById('review-list')) {
    appLogic.initListaRevisiones();
    appLogic.setupEditScoreSlider();
  }
```

- [ ] **Step 5: Precargar la puntuación al abrir el editor**

En `js/app.js`, dentro de `abrirEditorRevision`, justo antes de la línea `document.getElementById('edit-modal').style.display = 'flex';`, añade:

```javascript
    const inputPuntuacion = document.getElementById('edit-puntuacion');
    if (inputPuntuacion) {
      inputPuntuacion.value = rev.PUNTUACION || 5;
      if (this._actualizarColorPuntuacionEdicion) {
        this._actualizarColorPuntuacionEdicion(inputPuntuacion.value);
      }
    }
```

- [ ] **Step 6: Enviar la puntuación al guardar la edición y reflejar la incidencia en caché**

En `js/app.js`, dentro de `guardarEdicion`, sustituye:

```javascript
    const datos = {
      ID_PERSONAL_TRABAJO: document.getElementById('edit-camarera').value,
      ID_SUPERVISOR: document.getElementById('edit-supervisor').value,
      OBSERVACIONES: document.getElementById('edit-observaciones').value,
      ACCION_TOMADA: document.getElementById('edit-accion').value
    };

    this.mostrarLoader(true);
    try {
      await sheetsAPI.actualizarCamposRevision(rev.ID_REVISION, datos);
      Object.assign(this.revisionesCache[index], datos);
      this.mostrarToast('Revisión actualizada correctamente');
```

por:

```javascript
    const datos = {
      ID_PERSONAL_TRABAJO: document.getElementById('edit-camarera').value,
      ID_SUPERVISOR: document.getElementById('edit-supervisor').value,
      OBSERVACIONES: document.getElementById('edit-observaciones').value,
      ACCION_TOMADA: document.getElementById('edit-accion').value,
      PUNTUACION: document.getElementById('edit-puntuacion').value
    };

    this.mostrarLoader(true);
    try {
      await sheetsAPI.actualizarCamposRevision(rev.ID_REVISION, datos);

      const puntuacionCambio = String(rev.PUNTUACION) !== String(datos.PUNTUACION);
      const yaHuboIncidencia = String(rev.INCIDENCIA).toUpperCase() === 'SI';
      if (puntuacionCambio && !yaHuboIncidencia) {
        datos.INCIDENCIA = 'SI';
        datos.PUNTUACION_ORIGINAL = rev.PUNTUACION;
      }
      Object.assign(this.revisionesCache[index], datos);
      this.mostrarToast('Revisión actualizada correctamente');
```

(el resto de la función, desde `document.getElementById('edit-modal').style.display = 'none';` en adelante, no cambia).

- [ ] **Step 7: Mostrar el aviso de incidencia en el modal de detalle**

En `js/app.js`, dentro de `mostrarDetalleRevision`, justo después de esta línea existente:

```javascript
    let fotosHTML = '';
```

añade:

```javascript
    let incidenciaHTML = '';
    if (rev.INCIDENCIA === 'SI') {
      incidenciaHTML = `
        <div class="detail-item detail-full">
          <span class="badge badge-incidencia">⚠ Hubo incidencia</span>
          <span class="detail-value">Puntuación original: ${rev.PUNTUACION_ORIGINAL}</span>
        </div>
      `;
    }
```

y luego, dentro de la plantilla `bodyContent.innerHTML`, justo después de este bloque:

```javascript
        <div class="detail-item detail-full">
          <span class="detail-label">Camarera / Supervisor</span>
          <span class="detail-value">${camareraNombre} / ${supervisorNombre}</span>
        </div>
```

añade `${incidenciaHTML}`.

- [ ] **Step 8: Verificar sintaxis y presencia del código**

Run: `node --check js/app.js`
Expected: sin salida.

Run: `grep -n "edit-puntuacion\|INCIDENCIA\|badge-incidencia" js/app.js revisiones.html css/app.css`
Expected: coincidencias en los tres archivos.

- [ ] **Step 9: Commit**

```bash
git add revisiones.html js/app.js css/app.css
git commit -m "Frontend: permitir cambiar la puntuación en Editar y mostrar aviso de incidencia"
```

- [ ] **Step 10: HUMAN CHECKPOINT — columnas nuevas, redeploy y prueba real**

1. En la hoja `REVISIONES` de Google Sheets, añade dos columnas nuevas al final de las existentes, en este orden: `INCIDENCIA` y `PUNTUACION_ORIGINAL`. Déjalas vacías para las filas existentes.
2. Copia el contenido actualizado de `backend/Codigo.gs` al editor de Apps Script y publica una **Nueva implementación**.
3. En la app real: abre una revisión, pulsa "Editar", cambia la puntuación y guarda. Verifica que en la hoja se rellenó `INCIDENCIA = SI` y `PUNTUACION_ORIGINAL` con el valor antiguo, y que el modal de detalle muestra el aviso "⚠ Hubo incidencia".
4. Edita esa misma revisión una segunda vez cambiando la puntuación otra vez — confirma que `PUNTUACION_ORIGINAL` **no** cambia (debe seguir mostrando la primera puntuación, no la segunda).

---

## Task 7: Backend — idempotencia por `CLIENT_ID` al crear revisiones

**Files:**
- Modify: `backend/Codigo.gs`

**Interfaces:**
- Consumes: bloque de creación de revisión dentro de `doPost` (Task 1).
- Produces: `doPost` acepta `datos.CLIENT_ID` opcional; si ya existe una fila con ese `CLIENT_ID`, no duplica y devuelve el `id` ya existente. Guarda `CLIENT_ID` como columna 17 de la fila nueva. Task 8 (frontend) es quien genera y envía este valor.

- [ ] **Step 1: Añadir la comprobación de idempotencia y guardar `CLIENT_ID`**

En `backend/Codigo.gs`, dentro de `doPost`, sustituye este bloque:

```javascript
    const idRevision = Utilities.getUuid();
    const timestamp = new Date();

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaRevisiones = ss.getSheetByName('REVISIONES');
    const hojaFotos = ss.getSheetByName('FOTOS');

    hojaRevisiones.appendRow([
      idRevision,
      timestamp,
      datos.FECHA || '',
      datos.DEPARTAMENTO || 'PISOS',
      datos.ID_HABITACION || '',
      datos.PLANTA || '',
      datos.TIPOLOGIA || '',
      datos.ID_PERSONAL_TRABAJO || '',
      datos.ID_SUPERVISOR || '',
      datos.PUNTUACION || 0,
      datos.OBSERVACIONES || '',
      datos.ACCION_TOMADA || '',
      datos.REQUIRIO_REPASO || 'No',
      datos.ESTADO || 'ABIERTA'
    ]);
```

por:

```javascript
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaRevisiones = ss.getSheetByName('REVISIONES');
    const hojaFotos = ss.getSheetByName('FOTOS');

    const clientId = datos.CLIENT_ID || '';
    if (clientId) {
      const valoresExistentes = hojaRevisiones.getDataRange().getValues();
      const cabecerasExistentes = valoresExistentes[0];
      const colClientId = cabecerasExistentes.indexOf('CLIENT_ID');
      const colIdRevisionExistente = cabecerasExistentes.indexOf('ID_REVISION');
      if (colClientId !== -1) {
        for (let i = 1; i < valoresExistentes.length; i++) {
          if (String(valoresExistentes[i][colClientId]) === String(clientId)) {
            return corsResponse({
              success: true,
              id: valoresExistentes[i][colIdRevisionExistente],
              fotos_subidas: 0,
              duplicado_evitado: true
            });
          }
        }
      }
    }

    const idRevision = Utilities.getUuid();
    const timestamp = new Date();

    hojaRevisiones.appendRow([
      idRevision,
      timestamp,
      datos.FECHA || '',
      datos.DEPARTAMENTO || 'PISOS',
      datos.ID_HABITACION || '',
      datos.PLANTA || '',
      datos.TIPOLOGIA || '',
      datos.ID_PERSONAL_TRABAJO || '',
      datos.ID_SUPERVISOR || '',
      datos.PUNTUACION || 0,
      datos.OBSERVACIONES || '',
      datos.ACCION_TOMADA || '',
      datos.REQUIRIO_REPASO || 'No',
      datos.ESTADO || 'ABIERTA',
      'NO',
      '',
      clientId
    ]);
```

Nota: los dos valores `'NO'` y `''` añadidos antes de `clientId` corresponden a las columnas `INCIDENCIA` y `PUNTUACION_ORIGINAL` (Task 5) — una revisión recién creada nunca tiene incidencia todavía. El orden final de columnas que espera este `appendRow` es: ...`ESTADO`, `INCIDENCIA`, `PUNTUACION_ORIGINAL`, `CLIENT_ID` — por eso el orden de las 3 columnas nuevas en la hoja debe respetar exactamente esa secuencia.

- [ ] **Step 2: Verificar sintaxis y presencia del código**

Run: `node --check backend/Codigo.gs`
Expected: sin salida.

Run: `grep -n "CLIENT_ID\|duplicado_evitado" backend/Codigo.gs`
Expected: varias coincidencias (comprobación de idempotencia, `appendRow`, respuesta de duplicado evitado).

- [ ] **Step 3: Commit**

```bash
git add backend/Codigo.gs
git commit -m "Backend: idempotencia por CLIENT_ID para evitar filas duplicadas al crear"
```

---

## Task 8: Frontend — evitar doble envío en Nueva Revisión y Editar

**Files:**
- Modify: `js/app.js`
- Modify: `revisiones.html`

**Interfaces:**
- Consumes: backend de Task 7 (`doPost` con `datos.CLIENT_ID`); `sheetsAPI.guardarRevision`, `sheetsAPI.actualizarCamposRevision` ya existentes.
- Produces: `appLogic.generarClientId()`; guardas `this._guardandoRevision` / `this._guardandoEdicion`; botones `#btn-guardar` y `#btn-guardar-edicion` deshabilitados mientras la petición está en curso.

- [ ] **Step 1: Dar `id` al botón "Guardar cambios" del modal de edición**

En `revisiones.html`, dentro de `#edit-modal`, cambia:

```html
          <button
            class="btn btn-primary"
            style="flex: 1"
            onclick="appLogic.guardarEdicion()"
          >
            Guardar cambios
          </button>
```

por:

```html
          <button
            id="btn-guardar-edicion"
            class="btn btn-primary"
            style="flex: 1"
            onclick="appLogic.guardarEdicion()"
          >
            Guardar cambios
          </button>
```

- [ ] **Step 2: Añadir `generarClientId` a `appLogic`**

En `js/app.js`, añade este método dentro de `appLogic`, justo después de `mostrarToast`:

```javascript
  generarClientId: function () {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'cid-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  },
```

- [ ] **Step 3: Añadir la guarda y el `CLIENT_ID` en `enviarFormulario`**

En `js/app.js`, sustituye la función `enviarFormulario` completa por:

```javascript
  enviarFormulario: async function () {
    if (this._guardandoRevision) return;

    // Validaciones
    const habitacion = document.getElementById('id_habitacion_hidden')?.value;
    if (!habitacion) {
      this.mostrarToast('Selecciona una habitación válida de la lista', 'error');
      return;
    }
    const personal = document.getElementById('id_personal_trabajo')?.value || '';
    const supervisor = document.getElementById('id_supervisor')?.value || '';

    const habitacionSelectInfo = this.habitacionesCache.find(h => h.ID_HABITACION.toString() === habitacion.toString());
    const plantaReal = habitacionSelectInfo ? habitacionSelectInfo.PLANTA : document.getElementById('planta').value;
    const tipologiaReal = habitacionSelectInfo ? habitacionSelectInfo.TIPOLOGIA : document.getElementById('tipologia').value;

    if (!this._clientIdRevisionActual) {
      this._clientIdRevisionActual = this.generarClientId();
    }

    const datos = {
      FECHA: document.getElementById('fecha').value,
      DEPARTAMENTO: document.getElementById('departamento_val').value,
      ID_HABITACION: habitacion,
      PLANTA: plantaReal,
      TIPOLOGIA: tipologiaReal,
      ID_PERSONAL_TRABAJO: personal,
      ID_SUPERVISOR: supervisor,
      PUNTUACION: document.getElementById('puntuacion').value,
      OBSERVACIONES: document.getElementById('observaciones').value,
      ACCION_TOMADA: document.getElementById('accion_tomada').value,
      REQUIRIO_REPASO: document.getElementById('requirio_repaso_val').value,
      ESTADO: document.getElementById('estado_val').value,
      CLIENT_ID: this._clientIdRevisionActual
    };

    const fotos = cameraUtils.obtenerFotosValidas();

    this._guardandoRevision = true;
    const btnGuardar = document.getElementById('btn-guardar');
    if (btnGuardar) btnGuardar.disabled = true;
    this.mostrarLoader(true);
    try {
      await sheetsAPI.guardarRevision(datos, fotos);
      this.mostrarToast('Revisión guardada exitosamente');
      // Limpiar o redirigir
      setTimeout(() => {
        window.location.href = './index.html';
      }, 1500);
    } catch (e) {
      this.mostrarToast('Error guardando. Comprueba tu conexión y vuelve a intentarlo.', 'error');
      this._guardandoRevision = false;
      if (btnGuardar) btnGuardar.disabled = false;
    } finally {
      this.mostrarLoader(false);
    }
  },
```

Nota importante: `this._clientIdRevisionActual` se genera una sola vez por carga de página (no en cada intento), así que si el primer intento falla y el usuario vuelve a pulsar "Guardar" sin recargar la página, se reenvía el **mismo** `CLIENT_ID` — eso es lo que permite al backend reconocer el reintento y no duplicar. Como este es un sitio multi-página (cada `.html` recarga `js/app.js` desde cero), navegar a "Nueva Revisión" otra vez para una habitación distinta ya parte de un `appLogic` nuevo, con `_clientIdRevisionActual` sin definir.

- [ ] **Step 4: Añadir la guarda en `guardarEdicion`**

En `js/app.js`, en `guardarEdicion` (ya modificada en la Task 6), añade la guarda al principio y el disable/enable del botón. La función completa queda:

```javascript
  guardarEdicion: async function () {
    if (this._guardandoEdicion) return;

    const index = this.currentEditIndex;
    const rev = this.revisionesCache[index];
    if (!rev) return;

    const datos = {
      ID_PERSONAL_TRABAJO: document.getElementById('edit-camarera').value,
      ID_SUPERVISOR: document.getElementById('edit-supervisor').value,
      OBSERVACIONES: document.getElementById('edit-observaciones').value,
      ACCION_TOMADA: document.getElementById('edit-accion').value,
      PUNTUACION: document.getElementById('edit-puntuacion').value
    };

    this._guardandoEdicion = true;
    const btnGuardarEdicion = document.getElementById('btn-guardar-edicion');
    if (btnGuardarEdicion) btnGuardarEdicion.disabled = true;
    this.mostrarLoader(true);
    try {
      await sheetsAPI.actualizarCamposRevision(rev.ID_REVISION, datos);

      const puntuacionCambio = String(rev.PUNTUACION) !== String(datos.PUNTUACION);
      const yaHuboIncidencia = String(rev.INCIDENCIA).toUpperCase() === 'SI';
      if (puntuacionCambio && !yaHuboIncidencia) {
        datos.INCIDENCIA = 'SI';
        datos.PUNTUACION_ORIGINAL = rev.PUNTUACION;
      }
      Object.assign(this.revisionesCache[index], datos);
      this.mostrarToast('Revisión actualizada correctamente');
      document.getElementById('edit-modal').style.display = 'none';
      document.getElementById('review-modal').style.display = 'none';
      this.renderListaRevisiones();
    } catch (error) {
      this.mostrarToast('Error al guardar cambios', 'error');
    } finally {
      this._guardandoEdicion = false;
      if (btnGuardarEdicion) btnGuardarEdicion.disabled = false;
      this.mostrarLoader(false);
    }
  },
```

- [ ] **Step 5: Verificar sintaxis y presencia del código**

Run: `node --check js/app.js`
Expected: sin salida.

Run: `grep -n "CLIENT_ID\|_guardandoRevision\|_guardandoEdicion\|btn-guardar-edicion" js/app.js revisiones.html`
Expected: coincidencias en ambos archivos.

- [ ] **Step 6: Commit**

```bash
git add js/app.js revisiones.html
git commit -m "Frontend: evitar doble envío con guardas de UI y CLIENT_ID"
```

- [ ] **Step 7: HUMAN CHECKPOINT — columna nueva, redeploy y prueba de duplicados**

1. En la hoja `REVISIONES`, añade la columna `CLIENT_ID` como la última columna, después de `PUNTUACION_ORIGINAL` (Task 6). El orden final de las 3 columnas nuevas debe ser: `INCIDENCIA`, `PUNTUACION_ORIGINAL`, `CLIENT_ID`.
2. Copia el contenido actualizado de `backend/Codigo.gs` al editor de Apps Script y publica una **Nueva implementación**.
3. Prueba de doble toque: crea una revisión de prueba y, justo al pulsar "GUARDAR REVISIÓN", intenta pulsarlo una segunda vez rápidamente. Verifica que el botón se queda deshabilitado y que solo aparece una fila nueva en la hoja.
4. Prueba de "falso error de red": activa el modo avión justo después de pulsar "Guardar" (antes de que aparezca el toast) y espera a que salga el mensaje de error. Desactiva el modo avión, vuelve a pulsar "Guardar" sin recargar la página. Verifica en la hoja que solo hay **una** fila para esa revisión (con el `CLIENT_ID` relleno), no dos.
5. Repite una prueba equivalente editando una revisión (doble toque en "Guardar cambios") y confirma que la fila original se actualiza una sola vez, sin filas nuevas.

---

## Task 9: Bump de versión de caché del Service Worker

**Files:**
- Modify: `sw.js`

**Interfaces:**
- Consumes: ninguna de las tareas anteriores directamente; es el cierre obligatorio de todo el trabajo de frontend (Tasks 3, 4, 6, 8), siguiendo la convención ya usada en este repo (commit `091a192`, "Bump cache v4 para forzar recarga de app.js con botón Editar").

- [ ] **Step 1: Subir la versión de caché**

En `sw.js`, cambia:

```javascript
const CACHE_NAME = "calidad-hotel-v4";
```

por:

```javascript
const CACHE_NAME = "calidad-hotel-v5";
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check sw.js`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "Bump cache v5 para forzar recarga tras mejoras de revisiones (borrado, incidencia, anti-duplicados)"
```

- [ ] **Step 4: HUMAN CHECKPOINT — confirmar recarga en el móvil**

Cierra por completo la app (o el navegador) en el móvil donde está instalada la PWA y ábrela de nuevo. Comprueba en las herramientas de desarrollador (o simplemente probando el flujo completo: crear, editar con cambio de puntuación, y borrar una revisión de prueba) que los tres cambios están activos.
