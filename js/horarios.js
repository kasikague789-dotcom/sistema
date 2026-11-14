const API_HORARIOS = '/api/horarios';
const API_PROFESORES = '/api/profesores';
const API_USUARIOS = '/api/usuarios';
const API_SECCIONES = '/api/secciones';

let profesoresList = [];
let cursosList = [];
let horariosList = [];

const ordenDias = { "Lunes": 1, "Martes": 2, "Miércoles": 3, "Jueves": 4, "Viernes": 5, "Sábado": 6 };

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

// Muestra choques de horario, secciones con estudiantes sin horario y materias asignadas sin horario
async function cargarRevision() {
    const caja = document.getElementById('revision-horarios');
    if (!caja) return;
    try {
        const res = await fetch(`${API_HORARIOS}/revision`);
        const data = await res.json();
        if (!res.ok) return;
        const partes = [];
        if (data.choques.length > 0) {
            partes.push('<strong>Choques de horario (corríjalos con "Editar"):</strong><ul style="margin:4px 0 8px 18px;">' +
                data.choques.map(c => `<li>${c.tipo === 'profesor' ? 'Profesor' : 'Sección'} <b>${escapeHTML(c.quien)}</b>, ${escapeHTML(c.dia_semana)}: ${escapeHTML(c.clase_a)} (${c.ini_a}-${c.fin_a}) y ${escapeHTML(c.clase_b)} (${c.ini_b}-${c.fin_b})</li>`).join('') + '</ul>');
        }
        if (data.seccionesSinHorario.length > 0) {
            partes.push('<strong>Secciones con estudiantes pero sin horario</strong> (sus estudiantes no ven clases): ' +
                data.seccionesSinHorario.map(s => `${escapeHTML(s.nombre)} ${escapeHTML(s.seccion + (s.turno ? ' · ' + s.turno : ''))} (${s.estudiantes})`).join(', ') + '.');
        }
        if (data.asignacionesSinHorario.length > 0) {
            partes.push('<strong>Materias asignadas sin horario:</strong> ' +
                data.asignacionesSinHorario.map(a => `${escapeHTML(a.materia)} - ${escapeHTML(a.nombre)} ${escapeHTML(a.seccion + (a.turno ? ' · ' + a.turno : ''))} (${escapeHTML(a.profesor)})`).join(', ') + '.');
        }
        if ((data.fueraDeTurno || []).length > 0) {
            partes.push(`<strong>Clases fuera del turno de su sección</strong> (cambio de turno: ${escapeHTML(data.hora_cambio_turno)}; el profesor no podrá pasar lista; corríjalas con "Editar"): ` +
                data.fueraDeTurno.map(b => `${escapeHTML(b.materia)} - ${escapeHTML(b.nombre)} ${escapeHTML(b.seccion)} · ${escapeHTML(b.turno)}, ${escapeHTML(b.dia_semana)} ${b.ini}-${b.fin}`).join('; ') + '.');
        }
        caja.innerHTML = partes.join('<br>');
        caja.style.display = partes.length > 0 ? 'block' : 'none';
    } catch (e) {
        console.error('Error al revisar horarios:', e);
    }
}

async function cargarDatosBD() {
    cargarRevision();
    try {
        const [resHorarios, resProf, resUsers, resCursos] = await Promise.allSettled([
            fetch(API_HORARIOS).then(r => r.json()),
            fetch(API_PROFESORES).then(r => r.json()),
            fetch(API_USUARIOS).then(r => r.json()),
            fetch(API_SECCIONES).then(r => r.json())
        ]);

        if (resHorarios.status === 'fulfilled' && resHorarios.value) {
            const dataH = resHorarios.value;
            horariosList = Array.isArray(dataH) ? dataH : (dataH.datos || []);
        }

        let profs = [];
        if (resProf.status === 'fulfilled' && resProf.value) {
            const dataP = resProf.value;
            profs = Array.isArray(dataP) ? dataP : (dataP.datos || []);
        }

        if (profs.length === 0 && resUsers.status === 'fulfilled' && resUsers.value) {
            const dataU = resUsers.value;
            const users = Array.isArray(dataU) ? dataU : (dataU.datos || []);
            profs = users.filter(u => u.rol && u.rol.toLowerCase() === 'profesor');
        }
        profesoresList = profs;

        if (resCursos.status === 'fulfilled' && resCursos.value) {
            const dataC = resCursos.value;
            cursosList = Array.isArray(dataC) ? dataC : (dataC.datos || []);
        }

        cargarSelects();
        renderHorarios();
    } catch (error) {
        console.error('Error al cargar datos de horarios:', error);
        mostrarAlerta('Error al conectar con el servidor', 'error');
    }
}

function cargarSelects() {
    const selectFilterProf = document.getElementById('filter_profesor_id');
    const selectFormProf = document.getElementById('profesor_id');
    const selectFormCurso = document.getElementById('curso_id');

    if (!selectFilterProf || !selectFormProf || !selectFormCurso) return;

    const prevFilterVal = selectFilterProf.value;

    let htmlFilterProf = '<option value="0">Todos los profesores</option>';
    let htmlFormProf = '<option value="">Seleccione un profesor...</option>';

    profesoresList.forEach(p => {
        const cedulaTxt = p.cedula ? ` - V-${p.cedula}` : '';
        const nombreComp = `${escapeHTML(p.nombre)} ${escapeHTML(p.apellido)}`;
        htmlFilterProf += `<option value="${p.id}">${nombreComp}</option>`;
        htmlFormProf += `<option value="${p.id}">${nombreComp}${cedulaTxt}</option>`;
    });

    selectFilterProf.innerHTML = htmlFilterProf;
    selectFormProf.innerHTML = htmlFormProf;
    selectFilterProf.value = prevFilterVal || "0";

    let htmlFormCurso = '<option value="">Seleccione una sección...</option>';
    cursosList.forEach(c => {
        let nivelLabel = c.nivel || '';
        if (c.nombre && c.nombre.includes('6to Año')) nivelLabel = 'Téc. Medio';
        const prefix = nivelLabel ? `${nivelLabel} - ` : '';

        htmlFormCurso += `<option value="${c.id}">${escapeHTML(prefix)}${escapeHTML(c.nombre)} - Sección ${escapeHTML(c.seccion + (c.turno ? ' · ' + c.turno : ''))}</option>`;
    });

    selectFormCurso.innerHTML = htmlFormCurso;
}

function renderHorarios() {
    const profFiltroId = parseInt(document.getElementById('filter_profesor_id').value) || 0;
    const diaFiltro = document.getElementById('filter_dia').value;

    let filtrados = horariosList.filter(h => h.activo == 1 || h.activo === true || h.activo === undefined);

    if (profFiltroId > 0) {
        filtrados = filtrados.filter(h => parseInt(h.profesor_id) === profFiltroId);
    }

    if (diaFiltro && diaFiltro !== 'todos') {
        filtrados = filtrados.filter(h => (h.dia_semana || h.dia) === diaFiltro);
    }

    filtrados.sort((a, b) => {
        const diaA = a.dia_semana || a.dia || '';
        const diaB = b.dia_semana || b.dia || '';
        const dA = ordenDias[diaA] || 99;
        const dB = ordenDias[diaB] || 99;
        if (dA !== dB) return dA - dB;
        return (a.hora_inicio || '').localeCompare(b.hora_inicio || '');
    });

    document.getElementById('info-total-clases').innerText = `${filtrados.length} clases registradas`;

    const tbody = document.getElementById('tabla-body');
    if (!tbody) return;

    if (filtrados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">
                    <div class="empty-horario">
                        <p>No hay horarios registrados</p>
                        <small>Agrega un horario usando el formulario o ajusta los filtros</small>
                    </div>
                </td>
            </tr>
        `;
    } else {
        let html = '';
        filtrados.forEach(h => {
            let profNombre = h.profesor_nombre;
            if (!profNombre) {
                const pObj = profesoresList.find(p => p.id === h.profesor_id);
                profNombre = pObj ? `${pObj.nombre} ${pObj.apellido}` : 'Desconocido';
            }

            let cursoNombre = '';
            if (h.curso_nombre && h.curso_seccion) {
                let nivelLabel = h.curso_nivel || '';
                const prefix = nivelLabel ? `${nivelLabel} - ` : '';
                cursoNombre = `${prefix}${h.curso_nombre} - ${h.curso_seccion}${h.curso_turno ? ' · ' + h.curso_turno : ''}`;
            } else {
                const cObj = cursosList.find(c => c.id === h.curso_id);
                cursoNombre = cObj ? `${cObj.nombre} - ${cObj.seccion}${cObj.turno ? ' · ' + cObj.turno : ''}` : 'Desconocido';
            }

            const diaClase = h.dia_semana || h.dia || 'No especificado';
            const horaInicio = h.hora_inicio ? h.hora_inicio.substring(0, 5) : '--:--';
            const horaFin = h.hora_fin ? h.hora_fin.substring(0, 5) : '--:--';

            html += `
                <tr>
                    <td>${escapeHTML(profNombre)}</td>
                    <td>${escapeHTML(cursoNombre)}</td>
                    <td>${escapeHTML(h.materia || 'Sin materia')}</td>
                    <td><span class="badge-dia ${diaClase}">${escapeHTML(diaClase)}</span></td>
                    <td>${horaInicio} - ${horaFin}</td>
                    <td>${h.aula ? escapeHTML(h.aula) : '-'}</td>
                    <td>
                        <button onclick="cargarEdicion(${h.id})" class="btn-sm btn-primary" title="Editar">Editar</button>
                        <button onclick="eliminarHorario(${h.id})" class="btn-sm btn-danger" title="Eliminar">Eliminar</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    }

    const boxResumen = document.getElementById('resumen-profesor-container');
    if (profFiltroId > 0) {
        const profObj = profesoresList.find(p => p.id === profFiltroId);
        const clasesProf = horariosList.filter(h => parseInt(h.profesor_id) === profFiltroId);
        const diasDistintos = new Set(clasesProf.map(h => h.dia_semana || h.dia)).size;

        if (profObj && boxResumen) {
            document.getElementById('resumen-nombre-profesor').innerText = `${profObj.nombre} ${profObj.apellido}`;
            document.getElementById('resumen-clases-profesor').innerText = `${clasesProf.length} clases asignadas`;
            document.getElementById('resumen-dias-profesor').innerText = `${diasDistintos} días a la semana`;
            boxResumen.style.display = 'block';
        } else if (boxResumen) {
            boxResumen.style.display = 'none';
        }
    } else if (boxResumen) {
        boxResumen.style.display = 'none';
    }
}

function cargarEdicion(id) {
    const h = horariosList.find(item => item.id == id);
    if (!h) return;

    document.getElementById('horario_id').value = h.id;
    document.getElementById('profesor_id').value = h.profesor_id;
    document.getElementById('curso_id').value = h.curso_id;
    document.getElementById('materia').value = h.materia || '';
    document.getElementById('dia_semana').value = h.dia_semana || h.dia || '';
    document.getElementById('hora_inicio').value = h.hora_inicio ? h.hora_inicio.substring(0, 5) : '';
    document.getElementById('hora_fin').value = h.hora_fin ? h.hora_fin.substring(0, 5) : '';
    revisarHoras();
    document.getElementById('aula').value = h.aula || '';

    document.getElementById('titulo-form').innerHTML = `<i class='bx bx-edit' style="color: #FF9500;"></i> Editar Horario`;
    document.getElementById('btn-submit').className = 'btn btn-warning';
    document.getElementById('btn-submit').innerHTML = `<i class='bx bx-check'></i> Actualizar Horario`;
    document.getElementById('btn-cancelar').style.display = 'block';

    document.getElementById('formHorario').scrollIntoView({ behavior: 'smooth' });
}

function cancelarEdicion() {
    document.getElementById('horario_id').value = '';
    document.getElementById('formHorario').reset();
    revisarHoras();

    document.getElementById('titulo-form').innerHTML = `<i class='bx bx-plus-circle' style="color: #34C759;"></i> Agregar Horario`;
    document.getElementById('btn-submit').className = 'btn btn-success';
    document.getElementById('btn-submit').innerHTML = `<i class='bx bx-check'></i> Agregar Horario`;
    document.getElementById('btn-cancelar').style.display = 'none';
}

async function eliminarHorario(id) {
    if (await confirmar('El bloque se borra del horario del profesor y de la sección.', { titulo: '¿Eliminar este horario?', aceptar: 'Eliminar horario', peligro: true })) {
        try {
            const res = await fetch(`${API_HORARIOS}/${id}`, { method: 'DELETE' });
            const data = await res.json();

            if (data.estado === 'exitoso' || res.ok) {
                mostrarAlerta('Horario eliminado correctamente', 'success');
                await cargarDatosBD();
            } else {
                mostrarAlerta(`${data.mensaje || 'Error al eliminar'}`, 'error');
            }
        } catch (err) {
            console.error('Error al eliminar horario:', err);
            mostrarAlerta('Error de comunicación al eliminar', 'error');
        }
    }
}

function limpiarFiltros() {
    document.getElementById('filter_profesor_id').value = "0";
    document.getElementById('filter_dia').value = "todos";
    renderHorarios();
}

function mostrarAlerta(msg, tipo, titulo) {
    // Los errores salen en una ventana (se ven aunque la página esté bajada)
    if (tipo === 'error' && typeof avisar === 'function') {
        const caja = document.createElement('div');
        caja.innerHTML = msg;
        avisar(caja.textContent, { tipo: 'error', titulo: titulo || 'No se pudo completar' });
        return;
    }
    const container = document.getElementById('alert-container');
    if (!container) return;
    const clase = tipo === 'error' ? 'alert-error' : 'alert-success';
    container.innerHTML = `<div class="alert ${clase}">${msg}</div>`;
    setTimeout(() => { container.innerHTML = ''; }, 5000);
}

// "14:00" -> "2:00 PM". Aclara medianoche y mediodía (12:00 AM / 12:00 PM confunden)
function hora12(hhmm) {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return hhmm || '';
    const txt = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    if (h === 0) return txt + ' (medianoche)';
    if (h === 12) return txt + ' (mediodía)';
    return txt;
}

// Aviso debajo de las horas mientras se escriben
function revisarHoras() {
    const ini = document.getElementById('hora_inicio').value;
    const fin = document.getElementById('hora_fin').value;
    const aviso = document.getElementById('aviso-horas');
    if (!aviso) return;
    let txt = '';
    if (ini && fin && fin <= ini) {
        txt = `La hora fin (${hora12(fin)}) tiene que ser después de la hora inicio (${hora12(ini)}).`;
        if (fin.startsWith('00:')) txt += ' Para el mediodía elija 12:00 PM.';
    }
    aviso.textContent = txt;
    aviso.hidden = !txt;
    document.getElementById('hora_fin').classList.toggle('campo-error', !!txt);
}

// Antes de guardar: si la hora fin quedó antes que la de inicio, avisa.
// Si eligió 12 AM (medianoche) en una clase de la mañana, ofrece cambiarla a 12 PM (mediodía).
async function horasCorrectas() {
    const iniEl = document.getElementById('hora_inicio'), finEl = document.getElementById('hora_fin');
    const ini = iniEl.value;
    let fin = finEl.value;
    if (fin > ini) return true;
    if (fin.startsWith('00:') && ini < '12:00') {
        const mediodia = '12:' + fin.slice(3, 5);
        if (mediodia > ini) {
            const si = await confirmar(
                `Puso la hora fin a las ${hora12(fin).replace(' (medianoche)', '')}: eso es medianoche (12 de la noche).\n¿Quiso decir ${hora12(mediodia)}?`,
                { titulo: 'Revise la hora fin', aceptar: 'Sí, ' + hora12(mediodia).replace(' (mediodía)', ''), cancelar: 'No, la corrijo yo', icono: 'bx-time-five' });
            if (si) { finEl.value = mediodia; revisarHoras(); return true; }
            finEl.focus();
            return false;
        }
    }
    await avisar(`La hora fin (${hora12(fin)}) tiene que ser después de la hora inicio (${hora12(ini)}).`, { tipo: 'error', titulo: 'Revise las horas' });
    finEl.focus();
    return false;
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

    const form = document.getElementById('formHorario');
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();

            const id = document.getElementById('horario_id').value;
            const profesor_id = parseInt(document.getElementById('profesor_id').value);
            const curso_id = parseInt(document.getElementById('curso_id').value);
            const materia = document.getElementById('materia').value.trim();
            const dia_semana = document.getElementById('dia_semana').value;
            const hora_inicio = document.getElementById('hora_inicio').value;
            const aula = document.getElementById('aula').value.trim();

            if (!profesor_id || !curso_id || !materia || !dia_semana || !hora_inicio || !document.getElementById('hora_fin').value) {
                mostrarAlerta('Complete todos los campos obligatorios: profesor, sección, materia, día y horas.', 'error', 'Faltan datos');
                return;
            }
            if (!(await horasCorrectas())) return;
            const hora_fin = document.getElementById('hora_fin').value;

            const payload = { profesor_id, curso_id, materia, dia_semana, hora_inicio, hora_fin, aula };

            try {
                let res;
                if (id) {
                    res = await fetch(`${API_HORARIOS}/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } else {
                    res = await fetch(API_HORARIOS, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }

                const data = await res.json();

                if (data.estado === 'exitoso' || res.ok) {
                    mostrarAlerta(escapeHTML(data.mensaje || `Horario ${id ? 'actualizado' : 'agregado'} correctamente`), 'success');
                    cancelarEdicion();
                    await cargarDatosBD();
                } else {
                    mostrarAlerta(`${data.mensaje || 'Intente de nuevo en un momento.'}`, 'error', 'No se pudo guardar el horario');
                }
            } catch (err) {
                console.error('Error al guardar horario:', err);
                mostrarAlerta('No hubo conexión con el servidor. Revise que esté encendido e intente de nuevo.', 'error', 'No se pudo guardar el horario');
            }
        });
    }

    ['hora_inicio', 'hora_fin'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.addEventListener('input', revisarHoras); el.addEventListener('change', revisarHoras); }
    });

    const filterProf = document.getElementById('filter_profesor_id');
    const filterDia = document.getElementById('filter_dia');

    if (filterProf) filterProf.addEventListener('change', renderHorarios);
    if (filterDia) filterDia.addEventListener('change', renderHorarios);

    cargarDatosBD();
});