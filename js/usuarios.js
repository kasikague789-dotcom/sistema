const API_USUARIOS = '/api/usuarios';
const API_SECCIONES = '/api/secciones';
const API_ESTUDIANTE_CURSO = '/api/estudiante-curso';

let listaUsuarios = [];
let listaSecciones = [];

// Función para inicializar y cargar los datos de la base de datos
async function cargarUsuariosBD() {
    try {
        const [resUser, resSec] = await Promise.all([
            fetch(API_USUARIOS),
            fetch(API_SECCIONES)
        ]);

        const dataUser = await resUser.json();
        const dataSec = await resSec.json();

        if (dataUser.estado === 'exitoso') {
            listaUsuarios = dataUser.datos || [];
        }
        if (dataSec.estado === 'exitoso') {
            listaSecciones = dataSec.datos || [];
        }

        actualizarEstadisticas();
        llenarSelectSecciones();
        renderTablaUsuarios(listaUsuarios);
    } catch (error) {
        console.error('Error al cargar datos de usuarios:', error);
    }
}

function actualizarEstadisticas() {
    const total = listaUsuarios.length;
    const directores = listaUsuarios.filter(u => u.rol === 'director').length;
    const profesores = listaUsuarios.filter(u => u.rol === 'profesor').length;
    const estudiantes = listaUsuarios.filter(u => u.rol === 'estudiante').length;
    const activos = listaUsuarios.filter(u => u.activo == 1 || u.activo === true).length;
    const inactivos = total - activos;

    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-directores').innerText = directores;
    document.getElementById('stat-profesores').innerText = profesores;
    document.getElementById('stat-estudiantes').innerText = estudiantes;
    document.getElementById('stat-activos').innerText = activos;
    document.getElementById('stat-inactivos').innerText = inactivos;
}

function llenarSelectSecciones() {
    const select = document.getElementById('seccion');
    if (select) {
        let options = '<option value="todos">Todas</option>';
        listaSecciones.forEach(s => {
            options += `<option value="${s.id}">${escapeHTML(s.nombre)} - ${escapeHTML(s.seccion)}</option>`;
        });
        select.innerHTML = options;
    }

    const selectModalCurso = document.getElementById('curso_id');
    if (selectModalCurso) {
        let opts = '<option value="">Seleccione una sección...</option>';
        listaSecciones.filter(s => s.activo == 1).forEach(s => {
            opts += `<option value="${s.id}">${escapeHTML(s.nombre)} - Sección ${escapeHTML(s.seccion)}</option>`;
        });
        selectModalCurso.innerHTML = opts;
    }

    const selectAnio = document.getElementById('anio_academico');
    if (selectAnio) {
        const anioActual = new Date().getFullYear();
        selectAnio.innerHTML = [anioActual, anioActual - 1, anioActual - 2]
            .map(a => `<option value="${a}">${a} - ${a + 1}</option>`).join('');
    }
}

function renderTablaUsuarios(usuarios) {
    const tbody = document.getElementById('tabla-usuarios-body');
    if (!tbody) return;

    if (usuarios.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px;">No se encontraron usuarios registrados.</td></tr>`;
        return;
    }

    let html = '';
    usuarios.forEach((u, idx) => {
        const esActivo = (u.activo == 1 || u.activo === true);
        const estadoBadge = esActivo
            ? '<span class="badge-activo">Activo</span>'
            : '<span class="badge-inactivo">Inactivo</span>';

        const seccionTexto = u.rol !== 'estudiante' ? '<span style="color:var(--text-muted);">—</span>'
            : (u.curso_nombre ? `${escapeHTML(u.curso_nombre)} - ${escapeHTML(u.seccion)}` : '<span style="color:var(--text-muted);">Sin asignar</span>');

        const nombreCompleto = `${u.nombre || ''} ${u.apellido || ''}`.trim() || 'Pre-registrado';

        let botonesAccion = `<button onclick="editarUsuario(${u.id})" class="btn-sm btn-primary" title="Editar usuario">Editar</button>`;
        
        if (u.rol !== 'director') {
            if (esActivo) {
                botonesAccion += `<button onclick="eliminarUsuario(${u.id})" class="btn-sm btn-warning" style="background:#ed8936; color:white;" title="Desactivar usuario (conservando su historial)">Desactivar</button>`;
            }
            botonesAccion += `<button onclick="eliminarUsuarioDefinitivo(${u.id})" class="btn-sm btn-danger" style="background:#e53e3e; color:white;" title="Eliminar permanentemente de la base de datos"><i class='bx bx-trash'></i> Eliminar Def.</button>`;
        }

        html += `
            <tr>
                <td>${idx + 1}</td>
                <td><strong>${escapeHTML(nombreCompleto)}</strong>${u.tiene_cuenta ? '' : ' <small style="color:var(--text-muted);">(sin cuenta activa)</small>'}</td>
                <td>V-${escapeHTML(u.cedula)}</td>
                <td>${escapeHTML(u.email) || 'N/A'}</td>
                <td><span class="badge-rol ${escapeHTML(u.rol)}">${escapeHTML(u.rol)}</span></td>
                <td>${seccionTexto}</td>
                <td>${u.rol === 'estudiante' ? (u.faltas || 0) : '—'}</td>
                <td>${estadoBadge}</td>
                <td style="white-space:nowrap;">${botonesAccion}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function aplicarFiltros(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const busqueda = document.getElementById('busqueda').value.toLowerCase();
    const rolFiltro = document.getElementById('rol').value;
    const seccionFiltro = document.getElementById('seccion').value;
    const estadoFiltro = document.getElementById('estado').value;

    const filtrados = listaUsuarios.filter(u => {
        const coincideBusqueda = `${u.nombre || ''} ${u.apellido || ''} ${u.cedula || ''} ${u.email || ''}`.toLowerCase().includes(busqueda);
        const coincideRol = rolFiltro === 'todos' || u.rol === rolFiltro;
        const coincideSeccion = seccionFiltro === 'todos' || String(u.curso_id) === seccionFiltro;

        let coincideEstado = true;
        if (estadoFiltro === 'activo') coincideEstado = (u.activo == 1 || u.activo === true);
        if (estadoFiltro === 'inactivo') coincideEstado = (u.activo == 0 || u.activo === false);

        return coincideBusqueda && coincideRol && coincideSeccion && coincideEstado;
    });

    renderTablaUsuarios(filtrados);
}

function limpiarFiltros() {
    document.getElementById('form-filtros').reset();
    renderTablaUsuarios(listaUsuarios);
}

function editarUsuario(id) {
    window.location.href = `usuario_form.html?id=${id}`;
}

function abrirModalAsignar(id) {
    const u = listaUsuarios.find(x => x.id === id);
    if (!u) return;
    document.getElementById('estudiante_id').value = u.id;
    document.getElementById('nombreEstudiante').textContent = `${u.nombre || ''} ${u.apellido || ''}`.trim() || u.cedula;
    if (u.curso_id) document.getElementById('curso_id').value = u.curso_id;
    document.getElementById('modalAsignar').classList.add('active');
}

function cerrarModalAsignar() {
    const modal = document.getElementById('modalAsignar');
    if (modal) modal.classList.remove('active');
}

async function guardarAsignacionSeccion(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const estudianteId = parseInt(document.getElementById('estudiante_id').value);
    const cursoId = parseInt(document.getElementById('curso_id').value);
    const anioAcademico = parseInt(document.getElementById('anio_academico').value);

    if (!estudianteId || !cursoId) {
        avisar('Seleccione una sección válida.', { tipo: 'aviso', titulo: 'Datos incompletos' });
        return;
    }

    try {
        const res = await fetch(API_ESTUDIANTE_CURSO, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                estudiante_id: estudianteId,
                curso_id: cursoId,
                anio_academico: anioAcademico
            })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.estado === 'exitoso') {
            cerrarModalAsignar();
            avisar(data.mensaje || 'Sección asignada correctamente.', { tipo: 'ok', titulo: 'Listo' });
            cargarUsuariosBD();
        } else {
            avisar(data.mensaje || 'No se pudo asignar la sección.', { tipo: 'error', titulo: 'Error' });
        }
    } catch (err) {
        console.error(err);
        avisar('Error de conexión con el servidor.', { tipo: 'error', titulo: 'Sin conexión' });
    }
}

async function eliminarUsuario(id) {
    const u = listaUsuarios.find(x => x.id === id);
    const nombre = u ? `${u.nombre || ''} ${u.apellido || ''}`.trim() || `cédula ${u.cedula}` : 'este usuario';
    if (!(await confirmar('Si tiene historial de asistencia o justificaciones, se desactivará para no perder sus registros. Si no tiene historial, se borrará.', { titulo: `¿Desactivar a ${nombre}?`, aceptar: 'Sí, continuar', peligro: true, icono: 'bx-user-x' }))) return;
    try {
        const res = await fetch(`${API_USUARIOS}/${id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        avisar(data.mensaje || (res.ok ? 'Operación realizada.' : 'Intente de nuevo en un momento.'), res.ok
            ? { tipo: 'ok', titulo: data.desactivado ? 'Usuario desactivado' : 'Usuario eliminado' }
            : { tipo: 'error', titulo: 'No se pudo completar' });
        if (res.ok) cargarUsuariosBD();
    } catch (err) {
        console.error('Error al desactivar usuario:', err);
        avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
    }
}

async function eliminarUsuarioDefinitivo(id) {
    const u = listaUsuarios.find(x => x.id === id);
    const nombre = u ? `${u.nombre || ''} ${u.apellido || ''}`.trim() || `cédula V-${u.cedula}` : 'este usuario';
    
    const confirmado = await confirmar(
        'Esta acción borrará al usuario permanentemente de la base de datos junto con todo su historial de asistencias, justificaciones, asignaciones y horarios. Esta acción no se puede deshacer.',
        { 
            titulo: `¿Eliminar definitivamente a ${nombre}?`,
            aceptar: 'Sí, eliminar para siempre',
            cancelar: 'Cancelar',
            peligro: true,
            icono: 'bx-trash'
        }
    );
    if (!confirmado) return;

    try {
        const res = await fetch(`${API_USUARIOS}/${id}?definitivo=1`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        avisar(
            data.mensaje || (res.ok ? 'Usuario eliminado permanentemente.' : 'No se pudo eliminar el usuario.'),
            res.ok
                ? { tipo: 'ok', titulo: 'Usuario eliminado para siempre' }
                : { tipo: 'error', titulo: 'No se pudo eliminar' }
        );
        if (res.ok) cargarUsuariosBD();
    } catch (err) {
        console.error('Error al eliminar definitivamente:', err);
        avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
    }
}

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

document.addEventListener('DOMContentLoaded', function() {
    // Mensaje que manda el formulario al volver (?msg=...)
    const msg = new URLSearchParams(window.location.search).get('msg');
    if (msg) {
        const cont = document.querySelector('.content');
        if (cont) {
            const aviso = document.createElement('div');
            aviso.className = 'alert alert-success';
            aviso.textContent = msg;
            cont.insertBefore(aviso, cont.children[1] || null);
            setTimeout(() => aviso.remove(), 5000);
        }
        history.replaceState(null, '', 'usuarios.html');
    }

    // Reloj en vivo
    const elClock = document.getElementById('live-clock');
    if (elClock) {
        const ahora = new Date();
        elClock.innerText = `${String(ahora.getDate()).padStart(2, '0')}/${String(ahora.getMonth() + 1).padStart(2, '0')}/${ahora.getFullYear()} ${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    }

    cargarUsuariosBD();
});
