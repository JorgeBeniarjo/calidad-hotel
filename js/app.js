// Registra el Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('Service Worker registrado', reg.scope))
      .catch((err) => console.log('Error al registrar Service Worker', err));
  });
}

const appLogic = {
  revisionesCache: [],
  camarerasCache: [],
  supervisoresCache: [],

  initGlobal: function () {
    this.monitorizarConexion();
  },

  // ... skipping to initListaRevisiones below ...


  monitorizarConexion: function () {
    const updateOfflineStatus = () => {
      const statusDiv = document.getElementById('connection-status');
      if (!statusDiv) return;

      if (navigator.onLine) {
        statusDiv.className = 'connection-status status-online';
        statusDiv.innerHTML = 'Conexión restaurada';
        setTimeout(() => { statusDiv.style.display = 'none'; }, 2000);
      } else {
        statusDiv.className = 'connection-status status-offline';
        statusDiv.innerHTML = 'Estás sin conexión. Los cambios se guardarán localmente.';
        statusDiv.style.display = 'block';
      }
    };

    window.addEventListener('online', updateOfflineStatus);
    window.addEventListener('offline', updateOfflineStatus);
    updateOfflineStatus();
  },

  mostrarLoader: function (mostrar) {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = mostrar ? 'flex' : 'none';
  },

  mostrarToast: function (mensaje, tipo = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = mensaje;
    toast.className = `toast toast-${tipo} show`;

    setTimeout(() => {
      toast.className = 'toast';
    }, 3000);
  },

  generarClientId: function () {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'cid-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  },

  // Lógica específica para la vista "Nueva Revisión"
  initFormNuevaRevision: async function () {
    this.mostrarLoader(true);
    try {
      // Establecer fecha por defecto (hoy)
      const inputFecha = document.getElementById('fecha');
      if (inputFecha) {
        const hoy = new Date();
        const yyyy = hoy.getFullYear();
        const mm = String(hoy.getMonth() + 1).padStart(2, '0');
        const dd = String(hoy.getDate()).padStart(2, '0');
        inputFecha.value = `${yyyy}-${mm}-${dd}`;
      }

      // Cargar selectores
      const habitaciones = await sheetsAPI.cargarHabitaciones();
      this.habitacionesCache = habitaciones;

      const inputHabitacion = document.getElementById('id_habitacion');
      const datalistHabitacion = document.getElementById('habitaciones-list');
      if (inputHabitacion && datalistHabitacion) {
        habitaciones.forEach(hab => {
          const opt = document.createElement('option');
          opt.value = `Hab. ${hab.ID_HABITACION} — Planta ${hab.PLANTA} — ${hab.TIPOLOGIA}`;
          datalistHabitacion.appendChild(opt);
        });

        const actualizarDesdeHabitacion = () => {
          const texto = inputHabitacion.value;
          const selected = this.habitacionesCache.find(hab =>
            texto === `Hab. ${hab.ID_HABITACION} — Planta ${hab.PLANTA} — ${hab.TIPOLOGIA}`
          );
          if (selected) {
            document.getElementById('planta').value = selected.PLANTA || '';
            document.getElementById('tipologia').value = selected.TIPOLOGIA || '';
            document.getElementById('id_habitacion_hidden').value = selected.ID_HABITACION;
          } else {
            document.getElementById('planta').value = '';
            document.getElementById('tipologia').value = '';
            document.getElementById('id_habitacion_hidden').value = '';
          }
        };

        inputHabitacion.addEventListener('input', actualizarDesdeHabitacion);
        inputHabitacion.addEventListener('change', actualizarDesdeHabitacion);
      }

      const personal = await sheetsAPI.cargarPersonal('CAMARERA');
      const selectPersonal = document.getElementById('id_personal_trabajo');
      if (selectPersonal) {
        personal.forEach(p => selectPersonal.add(new Option(p.NOMBRE, p.ID_PERSONAL)));
      }

      const supervisores = await sheetsAPI.cargarPersonal('SUPERVISOR');
      const selectSupervisor = document.getElementById('id_supervisor');
      if (selectSupervisor) {
        supervisores.forEach(s => selectSupervisor.add(new Option(s.NOMBRE, s.ID_PERSONAL)));
      }

      // Inicializar lógica UI del formulario (slider de puntuación)
      const inputPuntuacion = document.getElementById('puntuacion');
      const displayScore = document.getElementById('score-display');

      if (inputPuntuacion && displayScore) {
        const updateScoreColor = (val) => {
          displayScore.textContent = val;
          if (val <= 2) displayScore.style.color = 'var(--danger-color)';
          else if (val <= 3) displayScore.style.color = 'var(--warning-color)';
          else displayScore.style.color = 'var(--success-color)';
        };

        inputPuntuacion.addEventListener('input', (e) => updateScoreColor(e.target.value));
        updateScoreColor(inputPuntuacion.value); // Set initial
      }

      // Toggles (Departamento, Repaso, Estado)
      this.setupToggles();

      // Camera init
      cameraUtils.init();

    } catch (error) {
      this.mostrarToast('Error obteniendo datos básicos', 'error');
    } finally {
      this.mostrarLoader(false);
    }
  },

  setupToggles: function () {
    // Busca agrupaciones de toggle y añade listeners
    document.querySelectorAll('.toggle-group').forEach(group => {
      const hiddenInput = document.getElementById(group.dataset.target);
      const buttons = group.querySelectorAll('.toggle-btn');

      buttons.forEach(btn => {
        btn.addEventListener('click', () => {
          // Remover active de todos los hermanos
          buttons.forEach(b => b.classList.remove('active'));
          // Activar pulsado
          btn.classList.add('active');
          // Guardar valor en input hidden
          if (hiddenInput) {
            hiddenInput.value = btn.dataset.value;
          }
        });
      });
    });
  },

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

  // Lógica para Listado de Revisiones
  initListaRevisiones: async function (forceRefresh = false) {
    this.mostrarLoader(true);
    try {
      if (forceRefresh || this.revisionesCache.length === 0) {
        const [revisiones, camareras, supervisores] = await Promise.all([
          sheetsAPI.cargarRevisiones(),
          sheetsAPI.cargarPersonal('CAMARERA'),
          sheetsAPI.cargarPersonal('SUPERVISOR')
        ]);

        this.revisionesCache = revisiones || [];
        this.camarerasCache = camareras || [];
        this.supervisoresCache = supervisores || [];
      }
      this.renderListaRevisiones();
    } catch (error) {
      this.mostrarToast('Error cargando la lista', 'error');
    } finally {
      this.mostrarLoader(false);
    }
  },

  renderListaRevisiones: function () {
    const listContainer = document.getElementById('review-list');
    if (!listContainer) return;

    listContainer.innerHTML = ''; // Clear

    this.revisionesCache.forEach((rev, index) => {
      const item = document.createElement('div');
      item.className = 'review-item';
      item.style.cursor = 'pointer';
      item.onclick = () => appLogic.mostrarDetalleRevision(index);

      let scoreClass = 'score-red';
      if (rev.PUNTUACION >= 4) scoreClass = 'score-green';
      else if (rev.PUNTUACION >= 3) scoreClass = 'score-orange';

      const estadoBadge = rev.ESTADO === 'RESUELTA'
        ? '<span class="badge badge-resuelta">RESUELTA</span>'
        : '<span class="badge badge-abierta">ABIERTA</span>';

      let fechaFormateada = rev.FECHA;
      if (rev.FECHA) {
        const dateObj = new Date(rev.FECHA);
        if (!isNaN(dateObj.getTime())) {
          const dia = String(dateObj.getDate()).padStart(2, '0');
          const mes = String(dateObj.getMonth() + 1).padStart(2, '0');
          const anio = dateObj.getFullYear();
          fechaFormateada = `${dia}/${mes}/${anio}`;
        }
      }

      let camareraNombre = rev.ID_PERSONAL_TRABAJO;
      if (this.camarerasCache) {
        const camareraInfo = this.camarerasCache.find(c => c.ID_PERSONAL === rev.ID_PERSONAL_TRABAJO);
        if (camareraInfo) camareraNombre = camareraInfo.NOMBRE;
      }

      item.innerHTML = `
        <div class="review-info">
          <h4>Habitación ${rev.ID_HABITACION}</h4>
          <p>Fecha: ${fechaFormateada} | Planta: ${rev.PLANTA}</p>
          <p>Camarera: ${camareraNombre}</p>
        </div>
        <div class="review-score-badge">
          <div class="score-circle ${scoreClass}">${rev.PUNTUACION}</div>
          ${estadoBadge}
        </div>
      `;
      listContainer.appendChild(item);
    });
  },

  mostrarDetalleRevision: function (index) {
    const rev = this.revisionesCache[index];
    if (!rev) return;

    const modal = document.getElementById('review-modal');
    const bodyContent = document.getElementById('modal-body-content');
    const footerActions = document.getElementById('modal-footer-actions');

    let fechaFormateada = rev.FECHA;
    if (rev.FECHA) {
      const dateObj = new Date(rev.FECHA);
      if (!isNaN(dateObj.getTime())) {
        const dia = String(dateObj.getDate()).padStart(2, '0');
        const mes = String(dateObj.getMonth() + 1).padStart(2, '0');
        const anio = dateObj.getFullYear();
        const hora = String(dateObj.getHours()).padStart(2, '0');
        const min = String(dateObj.getMinutes()).padStart(2, '0');
        fechaFormateada = `${dia}/${mes}/${anio} ${hora}:${min}`;
      }
    }

    let camareraNombre = rev.ID_PERSONAL_TRABAJO;
    const camareraInfo = this.camarerasCache.find(c => c.ID_PERSONAL === rev.ID_PERSONAL_TRABAJO);
    if (camareraInfo) camareraNombre = camareraInfo.NOMBRE;

    let supervisorNombre = rev.ID_SUPERVISOR || "No asignado";
    const supInfo = this.supervisoresCache.find(s => s.ID_PERSONAL === rev.ID_SUPERVISOR);
    if (supInfo) supervisorNombre = supInfo.NOMBRE;

    let scoreColor = 'var(--danger-color)';
    if (rev.PUNTUACION >= 4) scoreColor = 'var(--success-color)';
    else if (rev.PUNTUACION >= 3) scoreColor = 'var(--warning-color)';

    const badgeHTML = rev.ESTADO === 'RESUELTA'
      ? '<span class="badge badge-resuelta">RESUELTA</span>'
      : '<span class="badge badge-abierta">ABIERTA</span>';

    let incidenciaHTML = '';
    if (rev.INCIDENCIA === 'SI') {
      incidenciaHTML = `
        <div class="detail-item detail-full">
          <span class="badge badge-incidencia">⚠ Hubo incidencia</span>
          <span class="detail-value">Puntuación original: ${rev.PUNTUACION_ORIGINAL}</span>
        </div>
      `;
    }

    let fotosHTML = '';
    if (rev.FOTOS && Array.isArray(rev.FOTOS) && rev.FOTOS.length > 0) {
      const imgsHTML = rev.FOTOS.map(url => `<img src="${url}" onclick="appLogic.mostrarVisorFotos('${url}')" style="max-height:80px;"/>`).join('');
      fotosHTML = `<div class="detail-item detail-full"><span class="detail-label">Galería Fotográfica</span><div class="detail-photos">${imgsHTML}</div></div>`;
    }

    bodyContent.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h3 style="margin-bottom:5px;">Habitación ${rev.ID_HABITACION}</h3>
          ${badgeHTML}
        </div>
        <div class="detail-score" style="color: ${scoreColor};">${rev.PUNTUACION}</div>
      </div>
      
      <div class="detail-grid" style="margin-top:10px;">
        <div class="detail-item"><span class="detail-label">Fecha y Hora</span><span class="detail-value">${fechaFormateada}</span></div>
        <div class="detail-item"><span class="detail-label">Dpto.</span><span class="detail-value">${rev.DEPARTAMENTO || 'N/A'}</span></div>
        <div class="detail-item"><span class="detail-label">Planta</span><span class="detail-value">${rev.PLANTA || 'N/A'}</span></div>
        <div class="detail-item"><span class="detail-label">Tipología</span><span class="detail-value">${rev.TIPOLOGIA || 'N/A'}</span></div>
        
        <div class="detail-item detail-full">
          <span class="detail-label">Camarera / Supervisor</span>
          <span class="detail-value">${camareraNombre} / ${supervisorNombre}</span>
        </div>
        ${incidenciaHTML}

        <div class="detail-item detail-full">
          <span class="detail-label">Observaciones</span>
          <span class="detail-value">${rev.OBSERVACIONES || 'Sin observaciones'}</span>
        </div>
        
        <div class="detail-item detail-full">
          <span class="detail-label">Acción Tomada</span>
          <span class="detail-value">${rev.ACCION_TOMADA || 'Ninguna'}</span>
        </div>
        
        <div class="detail-item"><span class="detail-label">Repaso Requerido</span><span class="detail-value">${rev.REQUIRIO_REPASO || 'NO'}</span></div>
        ${fotosHTML}
      </div>
    `;

    footerActions.innerHTML = '';
    const btnCerrar = document.createElement('button');
    btnCerrar.className = 'btn btn-secondary';
    btnCerrar.style.flex = '1';
    btnCerrar.innerText = 'Cerrar';
    btnCerrar.onclick = () => { modal.style.display = 'none'; };
    footerActions.appendChild(btnCerrar);

    const btnEditar = document.createElement('button');
    btnEditar.className = 'btn btn-secondary';
    btnEditar.style.flex = '1';
    btnEditar.innerText = 'Editar';
    btnEditar.onclick = () => this.abrirEditorRevision(index);
    footerActions.appendChild(btnEditar);

    const btnBorrar = document.createElement('button');
    btnBorrar.className = 'btn btn-danger';
    btnBorrar.style.flex = '1';
    btnBorrar.innerText = 'Borrar';
    btnBorrar.onclick = () => this.borrarRevision(rev.ID_REVISION, index);
    footerActions.appendChild(btnBorrar);

    if (rev.ESTADO !== 'RESUELTA') {
      const btnResolver = document.createElement('button');
      btnResolver.className = 'btn btn-primary';
      btnResolver.style.flex = '1';
      btnResolver.style.backgroundColor = 'var(--success-color)';
      btnResolver.innerText = 'Marcar como RESUELTA';
      btnResolver.onclick = () => this.resolverRevision(rev.ID_REVISION, index);
      footerActions.appendChild(btnResolver);
    }

    modal.style.display = 'flex';
  },

  abrirEditorRevision: function (index) {
    const rev = this.revisionesCache[index];
    if (!rev) return;

    this.currentEditIndex = index;

    const selCamarera = document.getElementById('edit-camarera');
    const selSupervisor = document.getElementById('edit-supervisor');

    selCamarera.innerHTML = '<option value="">-- Sin asignar --</option>';
    this.camarerasCache.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.ID_PERSONAL;
      opt.textContent = c.NOMBRE;
      selCamarera.appendChild(opt);
    });

    selSupervisor.innerHTML = '<option value="">-- Sin asignar --</option>';
    this.supervisoresCache.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.ID_PERSONAL;
      opt.textContent = s.NOMBRE;
      selSupervisor.appendChild(opt);
    });

    selCamarera.value = rev.ID_PERSONAL_TRABAJO || '';
    selSupervisor.value = rev.ID_SUPERVISOR || '';
    document.getElementById('edit-observaciones').value = rev.OBSERVACIONES || '';
    document.getElementById('edit-accion').value = rev.ACCION_TOMADA || '';

    const inputPuntuacion = document.getElementById('edit-puntuacion');
    if (inputPuntuacion) {
      inputPuntuacion.value = rev.PUNTUACION || 5;
      if (this._actualizarColorPuntuacionEdicion) {
        this._actualizarColorPuntuacionEdicion(inputPuntuacion.value);
      }
    }

    document.getElementById('edit-modal').style.display = 'flex';
  },

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

  mostrarVisorFotos: function (url) {
    document.getElementById('photo-viewer-img').src = url;
    document.getElementById('photo-viewer-modal').style.display = 'flex';
  },

  resolverRevision: async function (id_revision, index) {
    if (!id_revision) {
      this.mostrarToast('Falta campo ID_REVISION desde la hoja para actualizar', 'error');
      return;
    }

    this.mostrarLoader(true);
    try {
      await sheetsAPI.actualizarEstadoRevision(id_revision, 'RESUELTA');
      this.mostrarToast('Revisión actualizada a RESUELTA');

      document.getElementById('review-modal').style.display = 'none';
      if (this.revisionesCache[index]) {
        this.revisionesCache[index].ESTADO = 'RESUELTA';
      }
      this.renderListaRevisiones();
    } catch (error) {
      this.mostrarToast('Error al actualizar', 'error');
    } finally {
      this.mostrarLoader(false);
    }
  },

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
};

window.addEventListener('DOMContentLoaded', () => {
  appLogic.initGlobal();

  // Enrutamiento simple basado en el elemento específico que haya en la página
  if (document.getElementById('form-nueva-revision')) {
    appLogic.initFormNuevaRevision();

    const btnGuardar = document.getElementById('btn-guardar');
    if (btnGuardar) {
      btnGuardar.addEventListener('click', (e) => {
        e.preventDefault();
        appLogic.enviarFormulario();
      });
    }
  } else if (document.getElementById('review-list')) {
    appLogic.initListaRevisiones();
    appLogic.setupEditScoreSlider();
  }
});
