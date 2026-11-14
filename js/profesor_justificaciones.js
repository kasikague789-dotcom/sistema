const PROFESOR_ACTUAL_ID = window.USUARIO.id; 
let justificacionesGlobal = [];

document.addEventListener('DOMContentLoaded', async () => {
    actualizarReloj();
    setInterval(actualizarReloj, 60000);

    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
    }

    await cargarSubmenuSecciones();
    await cargarJustificaciones();
    await cargarEstudiantesParaSelect();
});

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

async function cargarSubmenuSecciones() {
    try {
        const response = await fetch(`/api/profesores/mis-secciones/${PROFESOR_ACTUAL_ID}`);
        if (!response.ok) return;
        const result = await response.json();
        const ul = document.getElementById('submenu-secciones');
        if (!ul) return;
        ul.innerHTML = '';
        (result.datos || []).forEach(s => {
            ul.innerHTML += `
                <li><a href="secciones.html#${window.anclaClase(s.curso_id, s.materia)}">
                    ${escapeHTML(s.materia)} - ${escapeHTML(s.curso_nombre)} ${escapeHTML(s.seccion + (s.turno ? ' · ' + s.turno : ''))}
                </a></li>
            `;
        });
    } catch (e) { console.error("Error al cargar submenú:", e); }
}

async function cargarJustificaciones() {
    const contenedor = document.getElementById('contenedor-justificaciones');
    try {
        const response = await fetch(`/api/profesores/justificaciones/${PROFESOR_ACTUAL_ID}`);
        
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Error ${response.status}: ${errText}`);
        }
        
        const result = await response.json();
        justificacionesGlobal = result.datos || [];
        
        actualizarEstadisticas(justificacionesGlobal);
        renderizarJustificaciones(justificacionesGlobal);
    } catch (err) {
        console.error("Error REAL de conexión:", err);
        contenedor.innerHTML = `<p style="color:#e53e3e; text-align:center; font-weight:500;">Error al conectar con la base de datos. (Revisa la consola con F12 para ver el motivo exacto)</p>`;
    }
}

function actualizarEstadisticas(datos) {
    const total = datos.length;
    const pendientes = datos.filter(j => j.estado === 'pendiente').length;
    const aprobadas = datos.filter(j => j.estado === 'aprobada').length;
    const rechazadas = datos.filter(j => j.estado === 'rechazada').length;

    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-pendientes').innerText = pendientes;
    document.getElementById('stat-aprobadas').innerText = aprobadas;
    document.getElementById('stat-rechazadas').innerText = rechazadas;
}

function renderizarJustificaciones(datos) {
    const contenedor = document.getElementById('contenedor-justificaciones');
    contenedor.innerHTML = '';

    if (datos.length === 0) {
        contenedor.innerHTML = `
            <div style="text-align:center; padding:30px; background:var(--bg-card, #fff); border-radius:12px;">
                <p style="color:var(--text-muted, #a0aec0);">No se encontraron justificaciones.</p>
            </div>
        `;
        return;
    }

    datos.forEach(j => {
        let badgeEstado = '';
        if (j.estado === 'pendiente') badgeEstado = `<span class="badge-estado-just pendiente">Pendiente</span>`;
        else if (j.estado === 'aprobada') badgeEstado = `<span class="badge-estado-just aprobada">Aprobada</span>`;
        else if (j.estado === 'rechazada') badgeEstado = `<span class="badge-estado-just rechazada">Rechazada</span>`;
        else if (j.estado === 'revision') badgeEstado = `<span class="badge-estado-just pendiente">En revisión</span>`;

        const badgeMateria = j.materia 
            ? `<span style="background:#e2e8f0; color:#4a5568; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; margin-left:8px;"><i class='bx bx-book'></i> ${escapeHTML(j.materia)}</span>`
            : `<span style="background:#c6f6d5; color:#22543d; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; margin-left:8px;"><i class='bx bx-time'></i> Todo el día</span>`;

        contenedor.innerHTML += `
            <div class="justificacion-card ${j.estado}">
                <div class="header-card">
                    <div>
                        <div class="estudiante">${escapeHTML(j.estudiante)}</div>
                        <div class="cedula">C.I: ${escapeHTML(j.cedula)}</div>
                        <div class="curso">${escapeHTML(j.curso)}</div>
                        ${badgeMateria}
                    </div>
                    <div>${badgeEstado}</div>
                </div>
                
                <div class="detalle-grid">
                    <div class="item">
                        <div class="label">Desde</div>
                        <div class="value">${escapeHTML(j.fecha_inicio)}</div>
                    </div>
                    <div class="item">
                        <div class="label">Hasta</div>
                        <div class="value">${escapeHTML(j.fecha_fin)}</div>
                    </div>
                    <div class="item">
                        <div class="label">Tipo</div>
                        <div class="value" style="text-transform:capitalize;">${escapeHTML(j.tipo)}</div>
                    </div>
                </div>

                <div class="descripcion">
                    <div class="label">Motivo / Descripción</div>
                    <div class="texto">${escapeHTML(j.descripcion)}</div>
                </div>

                ${j.tiene_archivo ? `<div style="margin-top:8px;"><a href="#" onclick="abrirArchivoProtegido('/api/justificaciones/${j.id}/archivo'); return false;" style="font-size:13px;">Ver constancia</a></div>` : ''}
                ${j.observaciones_director ? `
                <div class="descripcion" style="background:#fffaf0; border-left:3px solid #ed8936;">
                    <div class="label" style="color:#dd6b20;">Observación del Director</div>
                    <div class="texto">${escapeHTML(j.observaciones_director)}</div>
                </div>
                ` : ''}
            </div>
        `;
    });
}

function aplicarFiltros(e) {
    if (e) e.preventDefault();
    const estadoStr = document.getElementById('filtro-estado').value.toLowerCase();
    const buscarStr = document.getElementById('filtro-busqueda').value.toLowerCase();

    const filtrados = justificacionesGlobal.filter(j => {
        const pasaEstado = (estadoStr === 'todos' || j.estado === estadoStr);
        const pasaBusqueda = (j.estudiante.toLowerCase().includes(buscarStr) || j.cedula.includes(buscarStr));
        return pasaEstado && pasaBusqueda;
    });

    renderizarJustificaciones(filtrados);
}

function restablecerFiltros() {
    document.getElementById('filtro-estado').value = 'todos';
    document.getElementById('filtro-busqueda').value = '';
    renderizarJustificaciones(justificacionesGlobal);
}

async function cargarEstudiantesParaSelect() {
    try {
        const response = await fetch(`/api/profesores/estudiantes/${PROFESOR_ACTUAL_ID}`);
        if (!response.ok) return;
        const result = await response.json();
        
        const select = document.getElementById('estudiante_id');
        select.innerHTML = '<option value="">Seleccione un estudiante...</option>';
        
        (result.datos || []).forEach(est => {
            select.innerHTML += `<option value="${est.id}">${escapeHTML(est.nombre)} ${escapeHTML(est.apellido)} (${escapeHTML(est.curso_nombre)} - ${escapeHTML(est.seccion + (est.turno ? ' · ' + est.turno : ''))})</option>`;
        });
    } catch (e) { console.error("Error al cargar estudiantes:", e); }
}

async function procesarSolicitud(e) {
    e.preventDefault();
    const data = {
        estudiante_id: document.getElementById('estudiante_id').value,
        fecha_inicio: document.getElementById('fecha_inicio').value,
        fecha_fin: document.getElementById('fecha_fin').value,
        tipo: document.getElementById('tipo').value,
        descripcion: document.getElementById('descripcion').value
    };

    try {
        const response = await fetch('/api/profesores/justificaciones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const resp = await response.json().catch(() => ({}));
        if (response.ok) {
            cerrarModalSolicitar();
            document.getElementById('form-solicitar-justificacion').reset();
            await cargarJustificaciones();
            avisar(resp.mensaje || 'La dirección revisará la solicitud.', { tipo: 'ok', titulo: 'Justificación enviada' });
        } else {
            avisar(resp.mensaje || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo enviar la justificación' });
        }
    } catch (err) {
        avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
    }
}

function abrirModalSolicitar() { document.getElementById('modalSolicitar').classList.add('active'); }
function cerrarModalSolicitar() { document.getElementById('modalSolicitar').classList.remove('active'); }
function escapeHTML(str) { return (str !== null && str !== undefined) ? String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)) : ''; }
function toggleSubmenu(el) { const submenu = el.nextElementSibling; if (submenu) submenu.classList.toggle('open'); }