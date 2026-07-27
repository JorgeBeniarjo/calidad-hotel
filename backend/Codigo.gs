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
      INCIDENCIA: rev['INCIDENCIA'] || 'NO',
      PUNTUACION_ORIGINAL: rev['PUNTUACION_ORIGINAL'] || '',
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

    if (action === 'eliminarRevision') {
      return eliminarRevision(e.parameter.id_revision);
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
