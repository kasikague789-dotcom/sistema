const API_PROFESORES = '/api/profesores';
const API_SECCIONES = '/api/secciones';
const API_ASIGNACIONES = '/api/asignaciones';

let profesores = [];
let cursos = [];
let asignaciones = [];

function actualizarReloj() {
    const ahora = new Date();
    const dia = String(ahora.getDate()).padStart(2, '0');
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const anio = ahora.getFullYear();
    const horas = String(ahora.getHours()).padStart(2, '0');
    const minutos = String(ahora.getMinutes()).padStart(2, '0');
    const clock = document.getElementById('live-clock');
    if (clock) clock.innerText = `${dia}/${mes}/${anio} ${horas}:${minutos}`;
}

async function cargarSelectsBD() {
    const selectProfesor = document.getElementById('profesor_id');
    const selectCurso = document.getElementById('curso_id');
    const selectAnio = document.getElementById('anio_academico');
    const warningBox = document.getElementById('secciones-warning');
    const btnSubmit = document.getElementById('btn-submit-asignar');

    if (!selectProfesor || !selectCurso || !selectAnio) return;

    try {
        const [resProf, resCursos] = await Promise.all([
            fetch(API_PROFESORES),
            fetch(API_SECCIONES)
        ]);

        const dataProf = await resProf.json();
        const dataCursos = await resCursos.json();

        profesores = dataProf.datos || [];
        cursos = dataCursos.datos || [];

        selectProfesor.innerHTML = '<option value="">Seleccione un profesor...</option>';
        profesores.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.innerText = `${p.nombre} ${p.apellido}${p.cedula ? ' - V-' + p.cedula : ''}`;
            selectProfesor.appendChild(opt);
        });

        selectCurso.innerHTML = '<option value="">Seleccione una sección...</option>';
        if (cursos.length === 0) {
            if (warningBox) warningBox.style.display = 'block';
            if (btnSubmit) btnSubmit.disabled = true;
            selectCurso.innerHTML = '<option value="" disabled>No hay secciones creadas</option>';
        } else {
            if (warningBox) warningBox.style.display = 'none';
            if (btnSubmit) btnSubmit.disabled = false;
            cursos.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                const textoNivel = c.nivel ? `${c.nivel} - ` : '';
                opt.innerText = `${textoNivel}${c.nombre} - Sección ${c.seccion}${c.turno ? ' · ' + c.turno : ''}`;
                selectCurso.appendChild(opt);
            });
        }

        window.llenarSelectAnios(selectAnio);

    } catch (error) {
        console.error('Error cargando listas de la BD:', error);
    }
}

async function cargarAsignacionesBD() {
    try {
        const res = await fetch(API_ASIGNACIONES);
        const data = await res.json();
        if (data.estado === 'exitoso') {
            asignaciones = data.datos || [];
            renderTabla();
        }
    } catch (error) {
        console.error('Error al obtener asignaciones:', error);
    }
}

function renderTabla() {
    const contenedor = document.getElementById('contenedor-tabla');
    if (!contenedor) return;

    if (asignaciones.length === 0) {
        contenedor.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 20px;">
                    <div class="empty-state">
                        <div class="icon"></div>
                        <h4>No hay asignaciones registradas</h4>
                        <p>Asigna un profesor a una sección usando el formulario de arriba.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    asignaciones.forEach((a, idx) => {
        const anioBase = parseInt(a.anio_academico) || new Date().getFullYear();
        const periodoFormateado = `${anioBase} - ${anioBase + 1}`;

        html += `
            <tr>
                <td>${idx + 1}</td>
                <td><strong>${a.profesor_nombre}</strong></td>
                <td>${a.curso_nombre} - Sección ${a.seccion}${a.turno ? ' · ' + a.turno : ''}</td>
                <td>${a.materia}</td>
                <td>${periodoFormateado}</td>
                <td>
                    <a href="horarios.html?profesor_id=${a.profesor_id}" class="btn-sm btn-primary" title="Ver el horario de este profesor">Ver horario</a>
                    <button onclick="eliminarAsignacion(${a.id})" class="btn-sm btn-danger" title="Eliminar">Eliminar</button>
                </td>
            </tr>
        `;
    });

    contenedor.innerHTML = html;
}

async function eliminarAsignacion(id) {
    if (await confirmar('El profesor deja de dar esta materia en la sección y se quitan sus bloques de horario.', { titulo: '¿Quitar esta asignación?', aceptar: 'Quitar asignación', peligro: true })) {
        try {
            const res = await fetch(`${API_ASIGNACIONES}/${id}`, { method: 'DELETE' });
            const data = await res.json();

            if (data.estado === 'exitoso' || res.ok) {
                await cargarAsignacionesBD();
                mostrarAlerta('Asignación eliminada correctamente', 'success');
            } else {
                mostrarAlerta(`${data.mensaje || 'Error al eliminar'}`, 'error');
            }
        } catch (err) {
            console.error('Error al eliminar:', err);
            mostrarAlerta('Error de conexión', 'error');
        }
    }
}

function mostrarAlerta(mensaje, tipo = 'success') {
    const alertBox = document.getElementById('alert-container');
    if (!alertBox) return;

    const claseAlert = tipo === 'success' ? 'alert-success' : 'alert-danger';
    alertBox.innerHTML = `<div class="alert ${claseAlert}">${mensaje}</div>`;
    setTimeout(() => { alertBox.innerHTML = ''; }, 3000);
}

document.addEventListener('DOMContentLoaded', function() {
    actualizarReloj();
    setInterval(actualizarReloj, 60000);

    const form = document.getElementById('formAsignacion');
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();

            const profesorId = parseInt(document.getElementById('profesor_id').value);
            const cursoId = parseInt(document.getElementById('curso_id').value);
            const materia = document.getElementById('materia').value.trim();
            const anioAcademico = parseInt(document.getElementById('anio_academico').value);

            if (!profesorId || !cursoId || !materia) {
                mostrarAlerta('Complete todos los campos', 'error');
                return;
            }

            const payload = {
                profesor_id: profesorId,
                curso_id: cursoId,
                materia: materia,
                anio_academico: anioAcademico
            };

            try {
                const res = await fetch(API_ASIGNACIONES, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();

                if (data.estado === 'exitoso' || res.ok) {
                    document.getElementById('materia').value = '';
                    mostrarAlerta('Profesor asignado correctamente', 'success');
                    await cargarAsignacionesBD();
                } else {
                    mostrarAlerta(`${data.mensaje || 'Error al registrar'}`, 'error');
                }
            } catch (err) {
                console.error('Error al guardar:', err);
                mostrarAlerta('Error de comunicación con el servidor', 'error');
            }
        });
    }

    cargarSelectsBD();
    cargarAsignacionesBD();
});