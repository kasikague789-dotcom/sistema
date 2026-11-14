const PROFESOR_ACTUAL_ID = window.USUARIO.id; // usuario con sesión iniciada

// Antes esta página corría el código del panel de inicio y se quedaba en "Cargando...".
// Ahora muestra los estudiantes de la clase elegida (sección + materia).

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
    }
    actualizarReloj();
    setInterval(actualizarReloj, 60000);
    cargarEstudiantes();
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

const TEXTO_ESTADO = { presente: 'Presente', ausente: 'Ausente', tarde: 'Tarde', justificada: 'Justificado', 'sin-marcar': 'Sin marcar' };
const CLASE_ESTADO = { presente: 'presente', ausente: 'ausente', tarde: 'tarde', justificada: 'justificado', 'sin-marcar': 'sin-marcar' };

async function cargarEstudiantes() {
    const tbody = document.getElementById('tbody-estudiantes');
    try {
        const response = await fetch(`/api/profesores/mis-secciones/${PROFESOR_ACTUAL_ID}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.mensaje || 'Error al cargar');
        const clases = result.datos || [];

        cargarSubmenu(clases);

        if (clases.length === 0) {
            document.getElementById('subtitulo-curso').innerText = 'No tienes secciones asignadas';
            document.getElementById('titulo-curso-header').innerText = 'Sin secciones';
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">Contacta al director para que te asigne secciones.</td></tr>';
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const cursoId = params.get('curso_id');
        const materia = params.get('materia');
        const clase = clases.find(c => String(c.curso_id) === String(cursoId) && (!materia || c.materia === materia))
            || clases.find(c => String(c.curso_id) === String(cursoId))
            || clases[0];

        const hoy = new Date().toLocaleDateString('es-VE');
        document.getElementById('subtitulo-curso').innerText = `${clase.materia} - ${clase.curso_nombre} ${clase.seccion}${clase.turno ? ' · ' + clase.turno : ''}`;
        document.getElementById('titulo-curso-header').innerText = `${clase.materia} - ${clase.curso_nombre} ${clase.seccion}${clase.turno ? ' · ' + clase.turno : ''}`;
        document.getElementById('detalles-curso-header').innerText = `${clase.total_estudiantes} estudiantes • ${hoy}`;
        const btn = document.getElementById('btn-pasar-lista');
        if (btn) btn.href = `pasar_lista.html?curso_id=${clase.curso_id}&materia=${encodeURIComponent(clase.materia)}`;

        if (clase.estudiantes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">Esta sección no tiene estudiantes inscritos.</td></tr>';
            return;
        }

        tbody.innerHTML = clase.estudiantes.map((est, i) => {
            const iniciales = est.nombre.split(' ').map(p => p.charAt(0)).slice(0, 2).join('').toUpperCase();
            const ultimas = est.ultimas.length === 0
                ? '<div class="dia sin">-</div>'
                : est.ultimas.map(u => {
                    const ic = { presente: 'P', ausente: 'A', tarde: 'T', justificada: 'J' }[u] || '-';
                    return `<div class="dia ${CLASE_ESTADO[u] || 'sin'}" title="${TEXTO_ESTADO[u] || u}">${ic}</div>`;
                }).join('');
            return `
                <tr>
                    <td>${i + 1}</td>
                    <td><div class="avatar-mini">${escapeHTML(iniciales)}</div></td>
                    <td><strong>${escapeHTML(est.nombre)}</strong></td>
                    <td>${escapeHTML(est.cedula)}</td>
                    <td><span class="badge-asistencia ${CLASE_ESTADO[est.estado_hoy] || 'sin-marcar'}">${TEXTO_ESTADO[est.estado_hoy] || est.estado_hoy}</span></td>
                    <td><div class="ultimas-clases">${ultimas}</div></td>
                    <td><a href="justificaciones.html" class="btn-accion btn-justificar" title="Registrar justificación">Justificar</a></td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Error cargando estudiantes:', err);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:#e53e3e;">No se pudo cargar la lista de estudiantes.</td></tr>';
    }
}

function cargarSubmenu(clases) {
    const ul = document.getElementById('submenu-secciones');
    if (!ul) return;
    ul.innerHTML = clases.length === 0
        ? '<li><a href="#" style="color:var(--text-muted); font-style:italic;">Sin secciones</a></li>'
        : clases.map(s => `
            <li><a href="estudiantes.html?curso_id=${s.curso_id}&materia=${encodeURIComponent(s.materia)}">
                ${escapeHTML(s.materia)} - ${escapeHTML(s.curso_nombre)} ${escapeHTML(s.seccion + (s.turno ? ' · ' + s.turno : ''))}
            </a></li>`).join('');
}

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

function toggleSubmenu(el) {
    const submenu = el.nextElementSibling;
    const arrow = el.querySelector('.arrow');
    if (submenu) {
        submenu.classList.toggle('open');
        if (arrow) arrow.classList.toggle('open');
    }
}
