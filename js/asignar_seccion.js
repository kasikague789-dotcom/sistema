// Rutas relativas listas para producción y desarrollo
const API_ESTUDIANTES = '/api/estudiantes';
const API_SECCIONES = '/api/secciones';
const API_ESTUDIANTE_CURSO = '/api/estudiante-curso';

let estudiantes = [];
let cursos = [];

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

async function cargarDatosBD() {
    try {
        const [resEst, resCursos] = await Promise.all([
            fetch(API_ESTUDIANTES),
            fetch(API_SECCIONES)
        ]);

        const dataEst = await resEst.json();
        const dataCursos = await resCursos.json();

        estudiantes = dataEst.datos || [];
        cursos = dataCursos.datos || [];

        renderSelects();
        renderListaEstudiantes();
    } catch (error) {
        console.error('Error al cargar datos de la BD:', error);
    }
}

function renderSelects() {
    const selectEst = document.getElementById('estudiante_id');
    const selectCurso = document.getElementById('curso_id');
    const selectAnio = document.getElementById('anio_academico');

    if (!selectEst || !selectCurso || !selectAnio) return;

    selectEst.innerHTML = '<option value="">Seleccione un estudiante...</option>';
    estudiantes.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;

        let nivelLabel = e.nivel;
        if (e.curso_nombre && e.curso_nombre.includes('6to Año')) {
            nivelLabel = 'Téc. Medio';
        }

        let texto = `${e.nombre} ${e.apellido}${e.cedula ? ' - V-' + e.cedula : ''}`;
        if (e.curso_nombre) {
            const prefix = nivelLabel ? nivelLabel + ' - ' : '';
            texto += ` (Actual: ${prefix}${e.curso_nombre} ${e.seccion}${e.turno ? ' · ' + e.turno : ''})`;
        } else {
            texto += ` (Sin Asignar)`;
        }

        opt.innerText = texto;
        selectEst.appendChild(opt);
    });

    selectCurso.innerHTML = '<option value="">Seleccione una sección...</option>';
    cursos.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;

        let nivelTexto = c.nivel;
        if (c.nombre && c.nombre.includes('6to Año')) {
            nivelTexto = 'Téc. Medio';
        }

        const prefix = nivelTexto ? `${nivelTexto} - ` : '';
        opt.innerText = `${prefix}${c.nombre} - Sección ${c.seccion}${c.turno ? ' · ' + c.turno : ''}`;
        selectCurso.appendChild(opt);
    });

    window.llenarSelectAnios(selectAnio);
}

function renderListaEstudiantes() {
    const contenedor = document.getElementById('contenedor-estudiantes');
    if (!contenedor) return;

    if (estudiantes.length === 0) {
        contenedor.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">No hay estudiantes registrados.</div>';
        return;
    }

    let html = '';
    estudiantes.forEach(e => {
        let nivelLabel = e.nivel;
        if (e.curso_nombre && e.curso_nombre.includes('6to Año')) {
            nivelLabel = 'Téc. Medio';
        }

        const seccionTexto = e.curso_nombre 
            ? `${nivelLabel ? nivelLabel + ' - ' : ''}${e.curso_nombre} ${e.seccion}${e.turno ? ' · ' + e.turno : ''}` 
            : null;

        let badgeHtml = '';
        if (seccionTexto) {
            badgeHtml = '<span class="badge-asignado">' + seccionTexto + '</span>';
        } else {
            badgeHtml = '<span class="badge-sin-asignar">Sin asignar</span>';
        }

        html += `
            <div class="estudiante-item">
                <div class="info">
                    <strong>${e.nombre} ${e.apellido}</strong>
                    <div style="font-size:12px; color:var(--text-muted);">Cédula: V-${e.cedula || 'N/A'}</div>
                    <div class="seccion-actual">
                        ${badgeHtml}
                    </div>
                </div>
                <div>
                    <button onclick="seleccionarEstudiante(${e.id})" class="btn btn-sm btn-primary">
                        Asignar
                    </button>
                </div>
            </div>
        `;
    });

    contenedor.innerHTML = html;
}

function seleccionarEstudiante(id) {
    const selectEst = document.getElementById('estudiante_id');
    if (!selectEst) return;
    selectEst.value = id;
    selectEst.scrollIntoView({ behavior: 'smooth' });
    selectEst.style.borderColor = '#48bb78';
    setTimeout(() => {
        selectEst.style.borderColor = 'var(--border-color, #ddd)';
    }, 2500);
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

    const form = document.getElementById('formAsignarEstudiante');
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();

            const estudianteId = parseInt(document.getElementById('estudiante_id').value);
            const cursoId = parseInt(document.getElementById('curso_id').value);
            const anioAcademico = parseInt(document.getElementById('anio_academico').value);

            if (!estudianteId || !cursoId) {
                mostrarAlerta('Seleccione un estudiante y una sección', 'error');
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

                const data = await res.json();

                if (data.estado === 'exitoso' || res.ok) {
                    mostrarAlerta('Estudiante asignado correctamente', 'success');
                    await cargarDatosBD();
                } else {
                    mostrarAlerta(`${data.mensaje || 'Error al asignar'}`, 'error');
                }
            } catch (err) {
                console.error('Error al guardar asignación:', err);
                mostrarAlerta('Error de comunicación con el servidor', 'error');
            }
        });
    }

    cargarDatosBD();
});