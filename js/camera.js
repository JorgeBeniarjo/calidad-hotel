const cameraUtils = {
  fotosCapturadas: [],
  inputFileId: 'camera-input',
  gridContainerId: 'photos-grid-container',

  init: function() {
    const fileInput = document.getElementById(this.inputFileId);
    if (!fileInput) return;

    fileInput.addEventListener('change', (e) => this.procesarArchivosSeleccionados(e));
  },

  procesarArchivosSeleccionados: function(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Procesar cada archivo nuevo
    Array.from(files).forEach(file => {
      // Validar que es imagen
      if (!file.type.startsWith('image/')) return;
      
      // Añadir al estado interno
      this.fotosCapturadas.push(file);
      
      // Crear miniatura
      this.renderizarMiniatura(file, this.fotosCapturadas.length - 1);
    });

    // Reset input para permitir volver a elegir el mismo archivo
    event.target.value = '';
  },

  renderizarMiniatura: function(file, index) {
    const container = document.getElementById(this.gridContainerId);
    if (!container) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const div = document.createElement('div');
      div.className = 'photo-item';
      div.id = `photo-item-${index}`;
      
      const img = document.createElement('img');
      img.src = e.target.result;
      
      const btnRemove = document.createElement('button');
      btnRemove.type = 'button';
      btnRemove.className = 'btn-remove-photo';
      btnRemove.innerHTML = '✕';
      btnRemove.onclick = () => this.eliminarFoto(index);
      
      div.appendChild(img);
      div.appendChild(btnRemove);
      
      container.appendChild(div);
    };
    reader.readAsDataURL(file);
  },

  eliminarFoto: function(index) {
    // Eliminar del DOM
    const item = document.getElementById(`photo-item-${index}`);
    if (item) {
      item.remove();
    }
    
    // Marcar como null en el array (para mantener indices o regenerar)
    // Lo más seguro es eliminar y re-renderizar todo
    this.fotosCapturadas[index] = null;
  },

  // Obtener solo las fotos válidas para enviar
  obtenerFotosValidas: function() {
    return this.fotosCapturadas.filter(foto => foto !== null);
  },

  // Función útil para convertir imágenes a base64 si hiciera falta para apps script
  convertirABase64: function(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
    });
  }
};
