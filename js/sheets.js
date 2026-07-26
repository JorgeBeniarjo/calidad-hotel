const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwV-DfRWshCtB1xFOoWAX06WrzQmPuDOPTFVxlyZCWehm99gzKa-BZoDkMQT7JDHYLy/exec';

const sheetsAPI = {
  // Helper interno para conversiones base64
  _fileToBase64: async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  },

  /**
   * Cargar listado de habitaciones
   */
  cargarHabitaciones: async () => {
    try {
      const response = await fetch(`${APPS_SCRIPT_URL}?action=habitaciones`, { redirect: 'follow' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      return data.data;
    } catch (error) {
      console.error('Error cargarHabitaciones:', error);
      throw error;
    }
  },

  /**
   * Cargar listado del personal según rol (CAMARERA o SUPERVISOR)
   * @param {string} rol 
   */
  cargarPersonal: async (rol) => {
    try {
      const response = await fetch(`${APPS_SCRIPT_URL}?action=personal&rol=${encodeURIComponent(rol)}`, { redirect: 'follow' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      return data.data;
    } catch (error) {
      console.error(`Error cargarPersonal (${rol}):`, error);
      throw error;
    }
  },

  /**
   * Cargar todas las revisiones
   */
  cargarRevisiones: async () => {
    try {
      const response = await fetch(`${APPS_SCRIPT_URL}?action=revisiones`, { redirect: 'follow' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      return data.data;
    } catch (error) {
      console.error('Error cargarRevisiones:', error);
      throw error;
    }
  },

  /**
   * Guardar una nueva revisión
   * @param {Object} datosJSON Objeto con los datos del formulario
   * @param {Array} fotos Array de objetos Blob/File con las fotos
   */
  guardarRevision: async (datosJSON, fotos = []) => {
    try {
      const formData = new FormData();
      formData.append('datos', JSON.stringify(datosJSON));
      
      // Adjuntar fotos en formato base64
      for (let i = 0; i < fotos.length; i++) {
        const file = fotos[i];
        const dataUrl = await sheetsAPI._fileToBase64(file);
        
        // dataUrl tiene el formato "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
        // Extraemos solo la parte codificada en base64
        const base64Data = dataUrl.split(',')[1];
        
        formData.append(`foto_${i}`, base64Data);
        formData.append(`foto_mime_${i}`, file.type);
      }

      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        redirect: 'follow',
        body: formData
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      return result;
    } catch (error) {
      console.error('Error guardarRevision:', error);
      throw error;
    }
  },

  /**
   * Actualizar campos editables de una revisión (camarera, supervisor, observaciones, acción)
   * @param {string} id_revision
   * @param {Object} datos Campos a actualizar
   */
  actualizarCamposRevision: async (id_revision, datos) => {
    try {
      const formData = new FormData();
      formData.append('action', 'actualizarCampos');
      formData.append('id_revision', id_revision);
      formData.append('datos', JSON.stringify(datos));

      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        redirect: 'follow',
        body: formData
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      return result;
    } catch (error) {
      console.error('Error actualizarCamposRevision:', error);
      throw error;
    }
  },

  /**
   * Actualizar estado de una revisión a RESUELTA
   */
  actualizarEstadoRevision: async (id_revision, estado) => {
    try {
      const url = `${APPS_SCRIPT_URL}?action=actualizarEstado&id_revision=${encodeURIComponent(id_revision)}&estado=${encodeURIComponent(estado)}`;
      const response = await fetch(url, { redirect: 'follow' });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      return result;
    } catch (error) {
      console.error('Error actualizarEstadoRevision:', error);
      throw error;
    }
  },

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
};
