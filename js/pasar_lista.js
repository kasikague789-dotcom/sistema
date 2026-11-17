const PROFESOR_ACTUAL_ID = window.USUARIO.id; // usuario con sesión iniciada
let cursoSeleccionadoId = null;
let materiaSeleccionada = '';
let fechaSeleccionada = '';
let listaBloqueada = false;

document.addEventListener('DOMContentLoaded', async () => {
    actualizarReloj();
    setInterval(actualizarReloj, 60000);

    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
    }

    // Cargamos primero el menú lateral y luego la lista
    await cargarSubmenuSecciones();
    await cargarListaEstudiantes();

    const inputFecha = document.getElementById('fecha-lista');
    if (inputFecha) {
        inputFecha.addEventListener('change', () => {
            const params = new URLSearchParams(window.location.search);
            params.set('fecha', inputFecha.value);
            window.location.search = params.toString();
        });
    }
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

let misClases = [];

async function cargarSubmenuSecciones() {
    try {
        const response = await fetch(`/api/profesores/mis-secciones/${PROFESOR_ACTUAL_ID}`);
        const result = await response.json();
        misClases = result.datos || [];
        const ul = document.getElementById('submenu-secciones');
        if (!ul) return;
        ul.innerHTML = '';

        // FORZAR QUE EL MENÚ SE ABRA AUTOMÁTICAMENTE EN ESTA PÁGINA
        ul.classList.add('open');
        const toggleDiv = ul.previousElementSibling;
        if (toggleDiv && toggleDiv.classList.contains('toggle-submenu')) {
            const arrow = toggleDiv.querySelector('.arrow');
            if (arrow) arrow.classList.add('open');
        }

        const urlParams = new URLSearchParams(window.location.search);
        const cursoActivoId = urlParams.get('curso_id');
        const materiaActiva = urlParams.get('materia') || '';

        misClases.forEach(s => {
            const isActive = String(cursoActivoId) === String(s.curso_id) && (!materiaActiva || materiaActiva === s.materia);
            const style = isActive
                ? 'background: rgba(10, 132, 255, 0.15); color: var(--border-focus); font-weight: 600; border-radius: 8px;'
                : '';

            ul.innerHTML += `
                <li style="margin-bottom: 4px;">
                    <a href="pasar_lista.html?curso_id=${s.curso_id}&materia=${encodeURIComponent(s.materia)}"
                       style="${style} display: block; padding: 8px 12px; text-decoration: none; color: var(--text-secondary); transition: all 0.2s;">
                        ${escapeHTML(s.materia)} - ${escapeHTML(s.curso_nombre)} ${escapeHTML(s.seccion)}
                    </a>
                </li>
            `;
        });
    } catch (e) { console.error("Error al cargar submenú:", e); }
}

function mostrarAviso(texto) {
    const aviso = document.getElementById('aviso-lista');
    if (!aviso) return;
    aviso.style.display = texto ? 'block' : 'none';
    aviso.innerHTML = texto || '';
}

async function cargarListaEstudiantes() {
    const urlParams = new URLSearchParams(window.location.search);
    let cursoId = urlParams.get('curso_id');
    let materia = urlParams.get('materia') || '';
    const fecha = urlParams.get('fecha') || window.fechaLocalISO();

    try {
        // Si no hay clase en la URL, tomamos la primera del profesor
        if (!cursoId) {
            if (misClases.length === 0) {
                document.getElementById('titulo-curso').innerText = 'Sin secciones asignadas';
                document.getElementById('info-estudiantes-fecha').innerText = 'Pida al director que le asigne una sección.';
                return;
            }
            cursoId = misClases[0].curso_id;
            materia = misClases[0].materia;
        }

        cursoSeleccionadoId = parseInt(cursoId);

        const response = await fetch(`/api/profesores/pasar-lista/${cursoSeleccionadoId}?materia=${encodeURIComponent(materia)}&fecha=${fecha}`);
        const result = await response.json();
        if (!response.ok) {
            document.getElementById('titulo-curso').innerText = 'No se pudo abrir la lista';
            document.getElementById('info-estudiantes-fecha').innerText = result.mensaje || 'Error al cargar la lista.';
            return;
        }

        materiaSeleccionada = result.materia || materia;
        fechaSeleccionada = result.fecha;
        const listaEstudiantes = result.estudiantes || [];
        const nombreCurso = result.curso || "Sección";

        const [a, m, d] = fechaSeleccionada.split('-');
        document.getElementById('titulo-curso').innerHTML = `<i class='bx bx-book-content' style="color: var(--border-focus);"></i> ${escapeHTML(materiaSeleccionada)} - ${escapeHTML(nombreCurso)}`;
        document.getElementById('info-estudiantes-fecha').innerHTML = `<i class='bx bx-group'></i> ${listaEstudiantes.length} estudiantes • ${d}/${m}/${a}`
            + (result.hora_limite ? ` • <span title="Configurado por el director">Hora límite de entrada: <strong>${escapeHTML(result.hora_limite)}</strong> (quien llegue después: Tarde)</span>` : '');

        // Elegir otra fecha solo si el director lo permite (Configuración > Edición de asistencia)
        const selector = document.getElementById('selector-fecha');
        const inputFecha = document.getElementById('fecha-lista');
        if (selector && inputFecha && result.puede_editar_pasadas) {
            selector.style.display = 'block';
            inputFecha.value = fechaSeleccionada;
            inputFecha.max = result.hoy;
        }

        listaBloqueada = false;
        if (result.feriado) {
            listaBloqueada = true;
            mostrarAviso(`<strong>No hay clases ese día:</strong> ${escapeHTML(result.feriado)}. No se pasa lista.`);
        } else if (fechaSeleccionada < result.hoy && !result.puede_editar_pasadas) {
            listaBloqueada = true;
            mostrarAviso('El director no permite editar asistencias de días pasados.');
        } else {
            mostrarAviso('');
        }

        const tbody = document.getElementById('tbody-estudiantes-lista');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (listaEstudiantes.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted, #a0aec0);">
                        <i class='bx bx-info-circle' style="font-size:24px; margin-bottom:10px; display:block;"></i>
                        No hay estudiantes asignados en esta sección
                    </td>
                </tr>
            `;
            return;
        }

        listaEstudiantes.forEach((est, index) => {
            // Sin marcar por defecto: el profesor debe marcar a cada uno (o usar "Todos Presentes")
            const estEstado = est.estado || '';

            tbody.innerHTML += `
                <tr>
                    <td>${index + 1}</td>
                    <td><strong>${escapeHTML(est.nombre + ' ' + est.apellido)}</strong></td>
                    <td>${escapeHTML(est.cedula)}</td>
                    <td>
                        <select data-usuario-id="${est.id}" class="select-estado" onchange="cambiarBordeSelect(this)" ${listaBloqueada ? 'disabled' : ''}>
                            <option value="" ${estEstado === '' ? 'selected' : ''}>-- Marcar --</option>
                            <option value="presente" ${estEstado === 'presente' ? 'selected' : ''}>Presente</option>
                            <option value="ausente" ${estEstado === 'ausente' ? 'selected' : ''}>Ausente</option>
                            <option value="tarde" ${estEstado === 'tarde' ? 'selected' : ''}>Tarde</option>
                            <option value="justificada" ${estEstado === 'justificada' ? 'selected' : ''}>Justificado</option>
                        </select>
                    </td>
                    <td>
                        <input type="text" data-obs-id="${est.id}" class="input-obs" placeholder="Observación..." maxlength="500" value="${escapeHTML(est.observaciones || '')}" ${listaBloqueada ? 'disabled' : ''}>
                    </td>
                </tr>
            `;
        });

        document.querySelectorAll('.select-estado').forEach(select => cambiarBordeSelect(select));

    } catch (err) {
        console.error("Error al cargar la lista de asistencia:", err);
        document.getElementById('titulo-curso').innerText = "Error al cargar";
        document.getElementById('info-estudiantes-fecha').innerText = "No se pudo conectar con el servidor.";
    }
}

function cambiarBordeSelect(select) {
    const val = select.value;
    if (val === 'presente') select.style.borderColor = '#48bb78';
    else if (val === 'ausente') select.style.borderColor = '#fc8181';
    else if (val === 'tarde') select.style.borderColor = '#ed8936';
    else if (val === 'justificada') select.style.borderColor = '#4299e1';
    else select.style.borderColor = '';
}

function marcarTodos(estado) {
    if (listaBloqueada) return;
    const selects = document.querySelectorAll('.select-estado');
    selects.forEach(select => {
        select.value = estado;
        cambiarBordeSelect(select);
    });
}

async function guardarLista(e) {
    e.preventDefault();
    if (!cursoSeleccionadoId || listaBloqueada) return;

    const filas = document.querySelectorAll('#tbody-estudiantes-lista tr');
    const asistenciaData = [];
    let sinMarcar = 0;

    filas.forEach(tr => {
        const select = tr.querySelector('.select-estado');
        const inputObs = tr.querySelector('.input-obs');
        if (select && inputObs) {
            if (!select.value) sinMarcar++;
            asistenciaData.push({
                usuario_id: select.getAttribute('data-usuario-id'),
                estado: select.value,
                observaciones: inputObs.value
            });
        }
    });

    if (asistenciaData.length === 0) return;
    if (sinMarcar > 0) {
        avisar(`Faltan ${sinMarcar} estudiante(s) por marcar. Márquelos y vuelva a guardar.`, { tipo: 'aviso', titulo: 'Lista incompleta' });
        return;
    }

    try {
        const response = await fetch('/api/profesores/guardar-asistencia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ curso_id: cursoSeleccionadoId, materia: materiaSeleccionada, fecha: fechaSeleccionada, asistencia: asistenciaData })
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
            await avisar(data.mensaje || 'Lista de asistencia guardada correctamente.', { tipo: 'ok', titulo: 'Lista guardada', boton: 'Volver a mis secciones' });
            window.location.href = "secciones.html";
        } else {
            avisar(data.mensaje || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo guardar la lista' });
        }
    } catch (err) {
        console.error("Error de red:", err);
        avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
    }
}

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}
