const API_SECCIONES = '/api/secciones';
let seccionesList = [];

function actualizarReloj() {
    const ahora = new Date();
    const dia = String(ahora.getDate()).padStart(2, '0');
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const anio = ahora.getFullYear();
    const horas = String(ahora.getHours()).padStart(2, '0');
    const minutos = String(ahora.getMinutes()).padStart(2, '0');
    const elClock = document.getElementById('live-clock');
    if (elClock) elClock.innerText = `${dia}/${mes}/${anio} ${horas}:${minutos}`;
}

function inicializarAnios() {
    const select = document.getElementById('anio_escolar');
    if (!select) return;
    const actual = new Date().getFullYear();
    select.innerHTML = `
        <option value="${actual}">${actual} - ${actual + 1}</option>
        <option value="${actual - 1}">${actual - 1} - ${actual}</option>
        <option value="${actual - 2}">${actual - 2} - ${actual - 1}</option>
    `;
}

async function cargarSeccionesBD() {
    try {
        const res = await fetch(API_SECCIONES);
        const data = await res.json();
        if (data.estado === 'exitoso') {
            seccionesList = data.datos || [];
            renderSecciones();
        }
    } catch (error) {
        console.error('Error al cargar secciones:', error);
        mostrarAlerta('Error al conectar con el servidor', 'error');
    }
}

function renderSecciones() {
    const tbody = document.getElementById('tabla-body');
    if (!tbody) return;

    if (seccionesList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <div class="icon"></div>
                        <h4>No hay secciones registradas</h4>
                        <p>Crea tu primera sección usando el formulario.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    seccionesList.forEach((s, idx) => {
        const isActivo = (s.activo == 1 || s.activo === true);
        
        const badge = isActivo
            ? '<span class="badge-activo">Activa</span>' 
            : '<span class="badge-inactivo">Archivada / Inactiva</span>';
            
        const estiloFila = isActivo ? '' : 'opacity: 0.55; background-color: #f8f9fa; filter: grayscale(1); transition: all 0.3s;';
        const estiloTexto = isActivo ? '' : 'color: #6c757d;';

        const anioBase = parseInt(s.anio_escolar) || new Date().getFullYear();
        const periodoFormateado = `${anioBase} - ${anioBase + 1}`;

        let nivelTexto = s.nivel || '-';
        if (s.nombre && s.nombre.includes('6to Año')) {
            nivelTexto = 'Téc. Medio';
        }

        // Lógica de botones según el estado
        let botones = '';
        if (isActivo) {
            botones = `
                <button onclick="cargarEdicion(${s.id})" class="btn-sm btn-primary" title="Editar">Editar</button>
                <button onclick="eliminarSeccion(${s.id}, true)" class="btn-sm btn-danger" title="Archivar/Eliminar">Eliminar</button>
            `;
        } else {
            botones = `
                <button onclick="cargarEdicion(${s.id})" class="btn-sm btn-warning" title="Restaurar">Restaurar</button>
                <button onclick="eliminarSeccion(${s.id}, false)" class="btn-sm btn-danger" title="Eliminar definitivamente">Eliminar</button>
            `;
        }

        html += `
            <tr style="${estiloFila}">
                <td style="${estiloTexto}">${idx + 1}</td>
                <td style="${estiloTexto}"><strong>${escapeHTML(s.nombre)}</strong></td>
                <td style="${estiloTexto}">${escapeHTML(nivelTexto)}</td>
                <td style="${estiloTexto}">${escapeHTML(s.seccion)}</td>
                <td style="${estiloTexto}">${s.turno ? escapeHTML(s.turno) : '<span style="color:var(--text-secondary)">Sin definir</span>'}</td>
                <td style="${estiloTexto}">${periodoFormateado}</td>
                <td>${badge}</td>
                <td>${botones}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function cargarEdicion(id) {
    const s = seccionesList.find(sec => sec.id == id);
    if (!s) return;

    document.getElementById('seccion_id').value = s.id;
    document.getElementById('nombre').value = s.nombre;
    document.getElementById('nivel').value = s.nivel || "";
    document.getElementById('seccion').value = s.seccion;
    document.getElementById('turno').value = s.turno || '';
    document.getElementById('anio_escolar').value = s.anio_escolar;
    document.getElementById('activo').checked = (s.activo == 1 || s.activo === true);

    document.getElementById('titulo-form').innerText = 'Editar Sección';
    document.getElementById('btn-submit').className = 'btn btn-warning';
    document.getElementById('btn-submit').innerText = 'Actualizar Sección';
    document.getElementById('grupo-activo').style.display = 'flex';
    document.getElementById('btn-cancelar').style.display = 'block';
}

function cancelarEdicion() {
    document.getElementById('seccion_id').value = '';
    document.getElementById('formSeccion').reset();

    const actual = new Date().getFullYear();
    document.getElementById('anio_escolar').value = actual;

    document.getElementById('titulo-form').innerText = 'Crear Nueva Sección';
    document.getElementById('btn-submit').className = 'btn btn-success';
    document.getElementById('btn-submit').innerText = 'Crear Sección';
    document.getElementById('grupo-activo').style.display = 'none';
    document.getElementById('btn-cancelar').style.display = 'none';
}

async function eliminarSeccion(id, isActiva) {
    let mensajeConfirmacion = isActiva 
        ? 'Si la sección tiene estudiantes o profesores, el sistema no permitirá borrarla. Si está vacía, se archivará para proteger las asistencias.'
        : '¡ATENCIÓN! Esto borrará la sección definitivamente de la base de datos y también se perderán las asistencias registradas en ella. ¿Está totalmente seguro?';

    if (await confirmar(mensajeConfirmacion, { titulo: isActiva ? '¿Eliminar sección?' : '¿Borrar definitivamente?', aceptar: 'Sí, continuar', peligro: true })) {
        try {
            const res = await fetch(`${API_SECCIONES}/${id}`, { method: 'DELETE' });
            const data = await res.json();

            if (data.estado === 'exitoso' || res.ok) {
                mostrarAlerta(data.mensaje, 'success');
                await cargarSeccionesBD();
            } else {
                mostrarAlerta(`${data.mensaje || 'Error al eliminar'}`, 'error');
            }
        } catch (err) {
            console.error('Error al eliminar sección:', err);
            mostrarAlerta('Error de conexión al eliminar', 'error');
        }
    }
}

// Alerta moderna con colores, iconos y botón de cerrar
function mostrarAlerta(msg, tipo) {
    const container = document.getElementById('alert-container');
    if (!container) return;
    
    const bg = tipo === 'error' ? '#fff5f5' : '#f0fff4';
    const color = tipo === 'error' ? '#c53030' : '#2f855a';
    const border = tipo === 'error' ? '#feb2b2' : '#9ae6b4';
    const icon = tipo === 'error' ? 'bx-error-circle' : 'bx-check-circle';
    
    container.innerHTML = `
        <div class="alert" style="background: ${bg}; color: ${color}; border: 1px solid ${border}; padding: 15px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: flex-start; gap: 12px; font-size: 14px; font-weight: 500; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); transition: all 0.3s ease;">
            <i class='bx ${icon}' style="font-size: 22px; margin-top: 1px;"></i>
            <div style="flex: 1; line-height: 1.4;">${msg}</div>
            <button onclick="document.getElementById('alert-container').innerHTML=''" style="background:none; border:none; color: ${color}; cursor:pointer; font-size: 20px; padding: 0; display:flex; align-items:center;"><i class='bx bx-x'></i></button>
        </div>
    `;
    
    setTimeout(() => { 
        if(container.innerHTML !== '') container.innerHTML = ''; 
    }, 8000);
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

document.addEventListener('DOMContentLoaded', function() {
    actualizarReloj();
    setInterval(actualizarReloj, 60000);

    inicializarAnios();
    cargarSeccionesBD();

    const form = document.getElementById('formSeccion');
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();

            const id = document.getElementById('seccion_id').value;
            const nombre = document.getElementById('nombre').value.trim();
            const nivel = document.getElementById('nivel').value;
            const seccion = document.getElementById('seccion').value;
            const anio_escolar = parseInt(document.getElementById('anio_escolar').value);
            
            const activo = document.getElementById('activo').checked ? 1 : 0;

            if (!nombre || !seccion) {
                mostrarAlerta('Complete los campos obligatorios', 'error');
                return;
            }

            const turno = document.getElementById('turno').value;
            const payload = { nombre, nivel, seccion, turno, anio_escolar, activo };

            try {
                let res;
                if (id) {
                    res = await fetch(`${API_SECCIONES}/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } else {
                    res = await fetch(API_SECCIONES, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }

                const data = await res.json();

                if (data.estado === 'exitoso' || res.ok) {
                    mostrarAlerta(`${id ? 'Sección actualizada' : 'Sección creada'} correctamente`, 'success');
                    cancelarEdicion();
                    await cargarSeccionesBD();
                } else {
                    mostrarAlerta(`${data.mensaje || 'Error al procesar'}`, 'error');
                }
            } catch (err) {
                console.error('Error al guardar sección:', err);
                mostrarAlerta('Error de comunicación con el servidor', 'error');
            }
        });
    }
});
