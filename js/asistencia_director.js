let datosCompletos = [];
let cursosList = [];

function getFechaHoyStr() {
    return window.fechaLocalISO(); // hoy (antes estaba fijo en 2026-08-31)
}

async function cargarDatosAsistencia(fecha = null) {
    const inputFecha = document.getElementById('fecha');
    if (!fecha) {
        fecha = (inputFecha && inputFecha.value) ? inputFecha.value : getFechaHoyStr();
    }
    
    if (inputFecha && !inputFecha.value) {
        inputFecha.value = fecha;
    }
    
    try {
        const response = await fetch(`/api/asistencia?fecha=${fecha}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.mensaje || 'Error al cargar');
        
        datosCompletos = data.estudiantes || [];
        cursosList = data.cursos || [];
        
        actualizarSelectCursos();
        renderAsistencia();
    } catch (error) {
        console.error('Error al cargar datos de asistencia:', error);
    }
}

function actualizarSelectCursos() {
    const selectCurso = document.getElementById('curso');
    if (!selectCurso) return;
    const valorActual = selectCurso.value; 
    
    selectCurso.innerHTML = '<option value="">Todas las secciones</option>';
    cursosList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.innerText = `${c.nombre} - Sección ${c.seccion}`;
        selectCurso.appendChild(opt);
    });
    
    selectCurso.value = valorActual; 
}

function renderAsistencia() {
    const cursoVal = document.getElementById('curso')?.value || '';
    const busquedaVal = document.getElementById('busqueda')?.value.toLowerCase().trim() || '';

    let filtrados = datosCompletos.filter(e => {
        if (cursoVal && e.curso_id != cursoVal) return false;
        if (busquedaVal) {
            const completo = `${e.nombre || ''} ${e.apellido || ''} ${e.cedula || ''}`.toLowerCase();
            if (!completo.includes(busquedaVal)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('tabla-body');
    if (!tbody) return;

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:35px; color:var(--text-muted);">No hay estudiantes que coincidan con el filtro.</td></tr>`;
    } else {
        let html = '';
        const textosEstado = { presente: 'Presente', ausente: 'Ausente', tarde: 'Tarde', justificada: 'Justificada', sin_marcar: 'Sin marcar' };

        filtrados.forEach((e, idx) => {
            const estado = e.estado;
            const horaText = e.hora_entrada ? String(e.hora_entrada).substring(0, 5) : '--:--';
            const materiaText = e.estado === 'sin_marcar' ? '<em style="color:var(--text-muted);">Ninguna clase registrada</em>' : (e.materia ? escapeHTML(e.materia) : '<em style="color:var(--text-muted);">General</em>');

            let badgeEstado = `<span class="badge-estado-asist ${estado}">${textosEstado[estado] || estado}</span>`;

            html += `
                <tr>
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHTML(e.nombre)} ${escapeHTML(e.apellido)}</strong></td>
                    <td>${escapeHTML(e.cedula)}</td>
                    <td>${e.curso ? `${escapeHTML(e.curso)} - ${escapeHTML(e.seccion)}` : 'Sin sección'}</td>
                    <td>${materiaText}</td>
                    <td>${horaText}</td>
                    <td>${badgeEstado}</td>
                    <td>
                        <button onclick="editarAsistencia(${e.id}, ${e.asistencia_id || 0}, '${escapeHTML(e.nombre)} ${escapeHTML(e.apellido)}', '${e.estado === 'sin_marcar' ? '' : e.estado}')" class="btn btn-sm btn-primary" title="Editar asistencia">${e.estado === 'sin_marcar' ? 'Marcar' : 'Editar'}</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    }
}

function limpiarFiltros() {
    const inputFecha = document.getElementById('fecha');
    if (inputFecha) inputFecha.value = getFechaHoyStr();
    if (document.getElementById('curso')) document.getElementById('curso').value = '';
    if (document.getElementById('busqueda')) document.getElementById('busqueda').value = '';
    cargarDatosAsistencia(getFechaHoyStr()); 
}

async function editarAsistencia(estudianteId, asistenciaId, nombreEstudiante, estadoActual) {
    const nuevoEstado = await elegirOpcion({
        titulo: 'Corregir asistencia',
        mensaje: `${nombreEstudiante}: elija el estado correcto.`,
        actual: estadoActual,
        aceptar: 'Guardar cambio',
        opciones: [
            { valor: 'presente', texto: 'Presente', icono: 'bx-check-circle', clase: 'op-presente' },
            { valor: 'ausente', texto: 'Ausente', icono: 'bx-x-circle', clase: 'op-ausente' },
            { valor: 'tarde', texto: 'Tarde', icono: 'bx-time-five', clase: 'op-tarde' },
            { valor: 'justificada', texto: 'Justificada', icono: 'bx-file', clase: 'op-justificada' }
        ]
    });
    if (!nuevoEstado || nuevoEstado === estadoActual) return;
    const estadoLimpio = nuevoEstado;

    const fechaVal = document.getElementById('fecha').value || getFechaHoyStr();

    try {
        const response = await fetch(`/api/asistencia/${estudianteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fecha: fechaVal, estado: estadoLimpio, asistencia_id: asistenciaId || undefined })
        });

        const resultado = await response.json();
        if (resultado.estado === 'exitoso') {
            cargarDatosAsistencia(fechaVal); 
        } else {
            avisar(resultado.mensaje || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo corregir la asistencia' });
        }
    } catch (error) {
        console.error('Error en la petición de actualización:', error);
        avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

document.addEventListener('DOMContentLoaded', function() {
    const inputFecha = document.getElementById('fecha');
    if (inputFecha) {
        inputFecha.value = getFechaHoyStr();
        inputFecha.max = getFechaHoyStr(); // no se registra asistencia a futuro
    }
    
    cargarDatosAsistencia(getFechaHoyStr()); 

    if (inputFecha) {
        inputFecha.addEventListener('change', function(e) {
            cargarDatosAsistencia(e.target.value);
        });
    }

    document.getElementById('curso')?.addEventListener('change', renderAsistencia);
    document.getElementById('busqueda')?.addEventListener('input', renderAsistencia);
});