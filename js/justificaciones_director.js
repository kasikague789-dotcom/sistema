const API_JUSTIFICACIONES = '/api/justificaciones';
let justificacionesGlobal = [];

async function cargarJustificaciones() {
    try {
        const response = await fetch(API_JUSTIFICACIONES);
        const data = await response.json();
        justificacionesGlobal = data.datos || [];
        
        actualizarEstadisticas();
        renderizarJustificaciones();
    } catch (error) {
        console.error('Error al cargar justificaciones:', error);
    }
}

function actualizarEstadisticas() {
    const total = justificacionesGlobal.length;
    const pendientes = justificacionesGlobal.filter(j => j.estado === 'pendiente').length;
    const aprobadas = justificacionesGlobal.filter(j => j.estado === 'aprobada').length;
    const rechazadas = justificacionesGlobal.filter(j => j.estado === 'rechazada').length;
    const revision = justificacionesGlobal.filter(j => j.estado === 'revision').length;

    if (document.getElementById('stat-total')) document.getElementById('stat-total').innerText = total;
    if (document.getElementById('stat-pendientes')) document.getElementById('stat-pendientes').innerText = pendientes;
    if (document.getElementById('stat-aprobadas')) document.getElementById('stat-aprobadas').innerText = aprobadas;
    if (document.getElementById('stat-rechazadas')) document.getElementById('stat-rechazadas').innerText = rechazadas;
    if (document.getElementById('stat-revision')) document.getElementById('stat-revision').innerText = revision;
}

function renderizarJustificaciones() {
    const contenedor = document.getElementById('contenedor-justificaciones');
    if (!contenedor) return;

    const filtroEstado = document.getElementById('estado')?.value || 'todos';
    const filtroTipo = document.getElementById('tipo')?.value || 'todos';
    const busqueda = document.getElementById('busqueda')?.value.toLowerCase().trim() || '';

    const filtradas = justificacionesGlobal.filter(j => {
        const matchEstado = (filtroEstado === 'todos' || j.estado === filtroEstado);
        const tipoReal = j.tipo || j.tipo_justificacion || '';
        const matchTipo = (filtroTipo === 'todos' || tipoReal.toLowerCase() === filtroTipo);
        
        const nombreCompleto = `${j.estudiante_nombre || ''} ${j.estudiante_apellido || ''}`.toLowerCase();
        const cedula = (j.cedula || '').toLowerCase();
        const seccion = `${j.curso_nombre || ''} ${j.curso_seccion || ''}`.toLowerCase();
        
        const matchBusqueda = busqueda === '' || 
                              nombreCompleto.includes(busqueda) || 
                              cedula.includes(busqueda) || 
                              seccion.includes(busqueda);
                              
        return matchEstado && matchTipo && matchBusqueda;
    });

    if (filtradas.length === 0) {
        contenedor.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">No se encontraron justificaciones con estos filtros.</div>';
        return;
    }

    let html = '';
    filtradas.forEach(j => {
        const fInicio = j.fecha_inicio ? j.fecha_inicio.substring(0, 10) : '--';
        const fFin = j.fecha_fin ? j.fecha_fin.substring(0, 10) : '--';
        const fReg = j.fecha_registro ? j.fecha_registro.replace('T', ' ').substring(0, 16) : '--';

        let badgeColor = '';
        let badgeText = '';
        if(j.estado === 'pendiente') { badgeColor = 'pendiente'; badgeText = 'Pendiente'; }
        if(j.estado === 'aprobada') { badgeColor = 'aprobada'; badgeText = 'Aprobada'; }
        if(j.estado === 'rechazada') { badgeColor = 'rechazada'; badgeText = 'Rechazada'; }
        if(j.estado === 'revision') { badgeColor = 'revision'; badgeText = 'En Revisión'; }

        const badgeMateria = j.materia 
            ? `<span style="background:#e2e8f0; color:#4a5568; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; margin-left:8px;"><i class='bx bx-book'></i> ${escapeHTML(j.materia)}</span>`
            : `<span style="background:#c6f6d5; color:#22543d; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; margin-left:8px;"><i class='bx bx-time'></i> Todo el día</span>`;

        html += `<div class="justificacion-card ${j.estado}">`;
        html += '<div class="header-card">';
        html += '<div>';
        html += `<span class="estudiante">${escapeHTML((j.estudiante_nombre || '') + ' ' + (j.estudiante_apellido || ''))}</span>`;
        html += `<span class="cedula"> • Cédula: ${escapeHTML(j.cedula)}</span>`;
        html += `<span class="curso"> • ${escapeHTML(j.curso_nivel ? j.curso_nivel + ' - ' : '')}${escapeHTML(j.curso_nombre || 'Sin curso')} ${escapeHTML((j.curso_seccion || '') + (j.curso_turno ? ' · ' + j.curso_turno : ''))}</span>`;
        html += badgeMateria; 
        html += '</div>';
        html += `<span class="badge-estado-just ${badgeColor}">${badgeText}</span>`;
        html += '</div>';

        html += '<div class="detalle-grid">';
        html += `<div class="item"><div class="label">Desde</div><div class="value">${fInicio}</div></div>`;
        html += `<div class="item"><div class="label">Hasta</div><div class="value">${fFin}</div></div>`;
        html += `<div class="item"><div class="label">Tipo</div><div class="value">${escapeHTML(j.tipo || j.tipo_justificacion || 'No especificado')}</div></div>`;
        html += '</div>';

        html += '<div class="descripcion">';
        html += '<div class="label">Descripción</div>';
        html += `<div class="texto">${escapeHTML(j.descripcion || 'Sin descripción')}</div>`;
        html += '</div>';

        if (j.tiene_archivo) {
            html += '<div class="archivo-adjunto">';
            html += '<strong>Adjunto:</strong><br>';
            html += `<a href="#" onclick="abrirArchivoProtegido('/api/justificaciones/${j.id}/archivo'); return false;">Ver constancia (${escapeHTML(j.archivo_nombre || 'archivo')})</a>`;
            html += '</div>';
        }

        if (j.observaciones_director) {
            html += '<div class="observaciones-director">';
            html += '<div class="label">Observaciones del Director</div>';
            html += `<div class="texto">${escapeHTML(j.observaciones_director)}</div>`;
            html += '</div>';
        }

        html += '<div class="footer-card">';
        let infoProc = `Registrado el ${fReg}`;
        if (j.aprobado_por_nombre && (j.estado === 'aprobada' || j.estado === 'rechazada')) {
            infoProc += ` • ${j.estado === 'aprobada' ? 'Aprobada' : 'Rechazada'} por ${escapeHTML(j.aprobado_por_nombre)}`;
            if (j.estado === 'aprobada' && j.dias_justificados !== null && j.dias_justificados !== undefined) infoProc += ` (${j.dias_justificados} falta(s) justificada(s))`;
        }
        html += `<div class="info-procesamiento">${infoProc}</div>`;
        
        // LÓGICA DE BOTONES EDITADA: Muestra las opciones para cambiar de estado
        html += '<div class="acciones">';
        if (j.estado !== 'aprobada') {
            html += `<button onclick="abrirModal(${j.id}, 'aprobada')" class="btn btn-success" style="padding:4px 8px; font-size:12px;">Aprobar</button>`;
        }
        if (j.estado !== 'rechazada') {
            html += `<button onclick="abrirModal(${j.id}, 'rechazada')" class="btn btn-danger" style="padding:4px 8px; font-size:12px;">Rechazar</button>`;
        }
        if (j.estado !== 'revision') {
            html += `<button onclick="abrirModal(${j.id}, 'revision')" class="btn btn-warning" style="padding:4px 8px; font-size:12px;">${j.estado === 'aprobada' ? 'Anular aprobación' : 'En Revisión'}</button>`;
        }
        html += '</div>';
        
        html += '</div></div>';
    });

    contenedor.innerHTML = html;
}

function abrirModal(id, estado) {
    const modal = document.getElementById('modalJustificacion');
    if (modal) modal.classList.add('active');
    
    if (document.getElementById('justificacion_id')) document.getElementById('justificacion_id').value = id;
    if (document.getElementById('estado_modal')) document.getElementById('estado_modal').value = estado;
    if (document.getElementById('observaciones')) document.getElementById('observaciones').value = '';
    
    const titulos = {
        'aprobada': 'Aprobar Justificación',
        'rechazada': 'Rechazar Justificación',
        'revision': 'Marcar para Revisión'
    };
    const tituloModal = document.getElementById('modalTitle');
    if (tituloModal) tituloModal.textContent = titulos[estado] || 'Procesar Justificación';
    
    const checkGroup = document.getElementById('grupo_inasistencia');
    if(checkGroup) {
        checkGroup.style.display = (estado === 'aprobada') ? 'flex' : 'none';
    }
}

function cerrarModal() {
    const modal = document.getElementById('modalJustificacion');
    if (modal) modal.classList.remove('active');
}

async function procesarJustificacion(event) {
    event.preventDefault();
    const id = document.getElementById('justificacion_id').value;
    const estado = document.getElementById('estado_modal').value;
    const observaciones = document.getElementById('observaciones').value;
    const eliminarInasistencia = document.getElementById('eliminar_inasistencia')?.checked || false;

    try {
        const response = await fetch(`${API_JUSTIFICACIONES}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                estado: estado, 
                observaciones: observaciones,
                eliminar_inasistencia: eliminarInasistencia
            })
        });

        const data = await response.json().catch(() => ({}));
        if (response.ok) {
            cerrarModal();
            avisar(data.mensaje || 'La respuesta quedó guardada.', { tipo: 'ok', titulo: estado === 'aprobada' ? 'Justificación aprobada' : estado === 'rechazada' ? 'Justificación rechazada' : 'Justificación respondida' });
            cargarJustificaciones();
        } else {
            avisar(data.mensaje || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo responder la justificación' });
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

const formFiltros = document.getElementById('formFiltros');
if (formFiltros) {
    formFiltros.addEventListener('submit', function(e) {
        e.preventDefault();
        renderizarJustificaciones();
    });
}

if (document.getElementById('estado')) document.getElementById('estado').addEventListener('change', renderizarJustificaciones);
if (document.getElementById('tipo')) document.getElementById('tipo').addEventListener('change', renderizarJustificaciones);
if (document.getElementById('busqueda')) document.getElementById('busqueda').addEventListener('input', renderizarJustificaciones);

document.addEventListener('DOMContentLoaded', cargarJustificaciones);
