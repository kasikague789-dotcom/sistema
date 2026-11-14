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
    const representantes = listaUsuarios.filter(u => u.rol === 'representante').length;
    const activos = listaUsuarios.filter(u => u.activo == 1 || u.activo === true).length;
    const inactivos = total - activos;

    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-directores').innerText = directores;
    document.getElementById('stat-profesores').innerText = profesores;
    document.getElementById('stat-estudiantes').innerText = estudiantes;
    document.getElementById('stat-representantes').innerText = representantes;
    document.getElementById('stat-activos').innerText = activos;
    document.getElementById('stat-inactivos').innerText = inactivos;
}

function llenarSelectSecciones() {
    const select = document.getElementById('seccion');
    if (!select) return;

    let options = '<option value="todos">Todas</option>';
    listaSecciones.forEach(s => {
        options += `<option value="${s.id}">${s.nombre} - ${s.seccion}${s.turno ? ' · ' + s.turno : ''}</option>`;
    });
    select.innerHTML = options;
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
        const estadoBadge = (u.activo == 1 || u.activo === true)
            ? '<span class="badge-activo">Activo</span>'
            : '<span class="badge-inactivo">Inactivo</span>';

        const seccionTexto = u.rol !== 'estudiante' ? '<span style="color:var(--text-muted);">—</span>'
            : (u.curso_nombre ? `${escapeHTML(u.curso_nombre)} - ${escapeHTML(u.seccion + (u.turno ? ' · ' + u.turno : ''))}` : '<span style="color:var(--text-muted);">Sin asignar</span>');

        html += `
            <tr>
                <td>${idx + 1}</td>
                <td><strong>${escapeHTML(u.nombre)} ${escapeHTML(u.apellido)}</strong>${u.tiene_cuenta ? '' : ' <small style="color:var(--text-muted);">(sin cuenta)</small>'}</td>
                <td>V-${escapeHTML(u.cedula)}</td>
                <td>${escapeHTML(u.email) || 'N/A'}</td>
                <td><span class="badge-rol ${u.rol}">${u.rol}</span></td>
                <td>${seccionTexto}</td>
                <td>${u.rol === 'estudiante' ? (u.faltas || 0) : '—'}</td>
                <td>${estadoBadge}</td>
                <td>
                    <button onclick="editarUsuario(${u.id})" class="btn-sm btn-primary" title="Editar">Editar</button>
                    <button onclick="eliminarUsuario(${u.id})" class="btn-sm btn-danger" title="Eliminar">Eliminar</button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function aplicarFiltros() {
    const busqueda = document.getElementById('busqueda').value.toLowerCase();
    const rolFiltro = document.getElementById('rol').value;
    const seccionFiltro = document.getElementById('seccion').value;
    const estadoFiltro = document.getElementById('estado').value;

    const filtrados = listaUsuarios.filter(u => {
        const coincideBusqueda = `${u.nombre} ${u.apellido} ${u.cedula} ${u.email}`.toLowerCase().includes(busqueda);
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

async function eliminarUsuario(id) {
    const u = listaUsuarios.find(x => x.id === id);
    const nombre = u ? `${u.nombre} ${u.apellido}`.trim() || `cédula ${u.cedula}` : 'este usuario';
    if (!(await confirmar('Si tiene historial de asistencia o justificaciones, solo se desactivará para no perder sus registros.', { titulo: `¿Eliminar a ${nombre}?`, aceptar: 'Eliminar usuario', peligro: true, icono: 'bx-user-x' }))) return;
    try {
        const res = await fetch(`${API_USUARIOS}/${id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        avisar(data.mensaje || (res.ok ? 'Usuario eliminado.' : 'Intente de nuevo en un momento.'), res.ok
            ? { tipo: 'ok', titulo: data.desactivado ? 'Usuario desactivado' : 'Usuario eliminado' }
            : { tipo: 'error', titulo: 'No se pudo eliminar' });
        if (res.ok) cargarUsuariosBD();
    } catch (err) {
        console.error('Error al eliminar usuario:', err);
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