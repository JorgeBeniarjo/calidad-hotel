// Registra el Service Worker
// if ('serviceWorker' in navigator) {
//  window.addEventListener('load', () => {
//    navigator.serviceWorker.register('./sw.js')
//      .then((reg) => console.log('Service Worker registrado', reg.scope))
//      .catch((err) => console.log('Error al registrar Service Worker', err));
//  });
// }

const appLogic = {
  revisionesCache: [],
  camarerasCache: [],
  supervisoresCache: [],

  initGlobal: function() {
    this.monitorizarConexion();
  },

// ... skipping to initListaRevisiones below ...


  monitorizarConexion: function() {
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

  mostrarLoader: function(mostrar) {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = mostrar ? 'flex' : 'none';
  },

  mostrarToast: function(mensaje, tipo = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = mensaje;
    toast.className = `toast toast-${tipo} show`;
    
    setTimeout(() => {
      toast.className = 'toast';
    }, 3000);
  },

  // Lógica específica para la vista "Nueva Revisión"
  initFormNuevaRevision: async function() {
    this.mostrarLoader(true);
    try {
      // Establecer fecha por defecto (hoy)
      const inputFecha = document.getElementById('fecha');
      if (inputFecha) {
        inputFecha.valueAsDate = new Date();
      }

      // Cargar selectores
      const habitaciones = await sheetsAPI.cargarHabitaciones();
      this.habitacionesCache = habitaciones;
      
      const selectHabitacion = document.getElementById('id_habitacion');
      if (selectHabitacion) {
        habitaciones.forEach(hab => {
          selectHabitacion.add(new Option(`Hab. ${hab.ID_HABITACION} — Planta ${hab.PLANTA} — ${hab.TIPOLOGIA}`, hab.ID_HABITACION));
        });
        
        // Listener para autocompletar Planta y Tipología
        selectHabitacion.addEventListener('change', (e) => {
          const selected = this.habitacionesCache.find(h => h.ID_HABITACION.toString() === e.target.value);
          if (selected) {
            document.getElementById('planta').value = selected.PLANTA || '';
            document.getElementById('tipologia').value = selected.TIPOLOGIA || '';
          } else {
            document.getElementById('planta').value = '';
            document.getElementById('tipologia').value = '';
          }
        });
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
          if (val <= 4) displayScore.style.color = 'var(--danger-color)';
          else if (val <= 6) displayScore.style.color = 'var(--warning-color)';
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

  setupToggles: function() {
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

  enviarFormulario: async function() {
    // Validaciones
    const habitacion = document.getElementById('id_habitacion')?.value;
    const personal = document.getElementById('id_personal_trabajo')?.value;
    const supervisor = document.getElementById('id_supervisor')?.value;
    
    if (!habitacion || !personal || !supervisor) {
      this.mostrarToast('Debe completar Habitación, Camarera y Supervisor', 'error');
      return;
    }

    const habitacionSelectInfo = this.habitacionesCache.find(h => h.ID_HABITACION.toString() === habitacion.toString());
    const plantaReal = habitacionSelectInfo ? habitacionSelectInfo.PLANTA : document.getElementById('planta').value;
    const tipologiaReal = habitacionSelectInfo ? habitacionSelectInfo.TIPOLOGIA : document.getElementById('tipologia').value;

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
      ESTADO: document.getElementById('estado_val').value
    };

    const fotos = cameraUtils.obtenerFotosValidas();

    this.mostrarLoader(true);
    try {
      await sheetsAPI.guardarRevision(datos, fotos);
      this.mostrarToast('Revisión guardada exitosamente');
      // Limpiar o redirigir
      setTimeout(() => {
        window.location.href = './index.html';
      }, 1500);
    } catch (e) {
      this.mostrarToast('Error guardando, se reintentará luego', 'error');
    } finally {
      this.mostrarLoader(false);
    }
  },

  // Lógica para Listado de Revisiones
  initListaRevisiones: async function(forceRefresh = false) {
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

  renderListaRevisiones: function() {
    const listContainer = document.getElementById('review-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = ''; // Clear

    this.revisionesCache.forEach((rev, index) => {
      const item = document.createElement('div');
      item.className = 'review-item';
      item.style.cursor = 'pointer';
      item.onclick = () => appLogic.mostrarDetalleRevision(index);
      
      let scoreClass = 'score-red';
      if (rev.PUNTUACION >= 7) scoreClass = 'score-green';
      else if (rev.PUNTUACION >= 5) scoreClass = 'score-orange';

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

  mostrarDetalleRevision: function(index) {
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
    if (rev.PUNTUACION >= 7) scoreColor = 'var(--success-color)';
    else if (rev.PUNTUACION >= 5) scoreColor = 'var(--warning-color)';

    const badgeHTML = rev.ESTADO === 'RESUELTA' 
        ? '<span class="badge badge-resuelta">RESUELTA</span>' 
        : '<span class="badge badge-abierta">ABIERTA</span>';
        
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

  mostrarVisorFotos: function(url) {
    document.getElementById('photo-viewer-img').src = url;
    document.getElementById('photo-viewer-modal').style.display = 'flex';
  },

  resolverRevision: async function(id_revision, index) {
    if (!id_revision) {
      this.mostrarToast('Falta campo ID_REVISION desde la hoja para actualizar', 'error');
      return;
    }
    
    this.mostrarLoader(true);
    try {
      await sheetsAPI.actualizarEstadoRevision(id_revision, 'RESUELTA');
      this.mostrarToast('Revisión actualizada a RESUELTA');
      
      document.getElementById('review-modal').style.display = 'none';
      if(this.revisionesCache[index]) {
         this.revisionesCache[index].ESTADO = 'RESUELTA';
      }
      this.renderListaRevisiones();
    } catch (error) {
      this.mostrarToast('Error al actualizar', 'error');
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
  }
});
