let horariosEstudiante = [];
let eventosEstudiante = [];
let tieneSeccion = true;
const diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
let diaEnfocado = obtenerDiaActualNombre(); 

function obtenerDiaActualNombre() {
    const diasEspanol = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const hoy = diasEspanol[new Date().getDay()];
    return diasSemana.includes(hoy) ? hoy : 'Lunes';
}

function obtenerFechaDeDia(diaNombre) {
    const hoy = new Date();
    const diaHoy = hoy.getDay() === 0 ? 7 : hoy.getDay();
    const indexDia = diasSemana.indexOf(diaNombre);
    if (indexDia === -1) return null;
    
    const fecha = new Date(hoy);
    const diff = indexDia + 1 - diaHoy;
    fecha.setDate(hoy.getDate() + diff);
    
    const yyyy = fecha.getFullYear();
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function obtenerEventoDelDia(diaNombre) {
    const fechaStr = obtenerFechaDeDia(diaNombre);
    if (!fechaStr) return null;
    return eventosEstudiante.find(e => fechaStr >= e.fecha_inicio && fechaStr <= e.fecha_fin);
}

async function cargarHorarioEstudiante() {
    try {
        const usuarioSesion = window.USUARIO;
        const estudianteId = usuarioSesion.id;

        const badgeUser = document.querySelector('.user-badge');
        if (badgeUser) {
            badgeUser.innerHTML = `${escapeHTML(usuarioSesion.nombre || 'Estudiante')} ${escapeHTML(usuarioSesion.apellido || '')}`;
        }

        const response = await fetch(`/api/estudiante/horario/${estudianteId}`);
        const result = await response.json();

        if (!response.ok) throw new Error(result.mensaje || 'Error');
        horariosEstudiante = result.datos || [];
        eventosEstudiante = result.eventos || [];
        const infoCurso = result.curso;

        const elInfoCurso = document.getElementById('info-curso-texto');
        if (elInfoCurso && infoCurso) {
            const nivelLabel = infoCurso.nivel || '';
            const prefix = nivelLabel ? `${nivelLabel} - ` : '';
            elInfoCurso.innerHTML = `Curso: ${escapeHTML(prefix)}${escapeHTML(infoCurso.nombre)} - Sección "${escapeHTML(infoCurso.seccion + (infoCurso.turno ? ' · ' + infoCurso.turno : ''))}"`;
        } else if (elInfoCurso) {
            elInfoCurso.innerHTML = `Aún no tienes sección asignada`;
        }
        tieneSeccion = !!infoCurso;

        calcularEstadisticas();
        renderizarTodo();

    } catch (error) {
        console.error('Error al cargar el horario del estudiante:', error);
        document.getElementById('cuerpoHorario').innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:red;">Error de conexión con el servidor.</td></tr>`;
    }
}

function enfocarDia(dia) {
    diaEnfocado = dia;
    renderizarTodo();
}

function renderizarTodo() {
    generarEncabezado();
    generarTablaCompacta();
}

function generarEncabezado() {
    const trHeader = document.getElementById('encabezadoDias');
    if (!trHeader) return;

    trHeader.innerHTML = '<th style="min-width:120px;">Bloque / Hora</th>';
    const diaHoyReal = obtenerDiaActualNombre();

    const elHoyLabel = document.getElementById('nombre-dia-hoy');
    if (elHoyLabel) elHoyLabel.innerText = diaHoyReal;

    diasSemana.forEach(dia => {
        const esSeleccionado = (dia === diaEnfocado);
        const esHoyReal = (dia === diaHoyReal);
        const abrev = dia.substring(0, 3).toUpperCase();
        
        const th = document.createElement('th');
        th.style.cursor = 'pointer';
        th.onclick = () => enfocarDia(dia);

        if (esSeleccionado) {
            th.classList.add('dia-actual');
        }

        let subtexto = '';
        if (esHoyReal) {
            subtexto = '<span style="display:block; font-size:9px; color:#ed8936; font-weight:bold;">(HOY)</span>';
        } else if (esSeleccionado) {
            subtexto = '<span style="display:block; font-size:9px; color:#4299e1;">(Visto)</span>';
        }

        const evento = obtenerEventoDelDia(dia);
        if (evento) {
            const esFestivo = evento.afecta_asistencia == 1;
            const icono = esFestivo ? 'bx-calendar-x' : 'bx-star';
            subtexto += `<span style="display:block; font-size:10px; color:${evento.color_evento || '#FF3B30'}; font-weight:bold;"><i class='bx ${icono}'></i></span>`;
        }

        th.innerHTML = `${abrev} ${subtexto}`;
        trHeader.appendChild(th);
    });
}

function calcularEstadisticas() {
    const elTotal = document.getElementById('stat-total-clases');
    const elDias = document.getElementById('stat-dias-semana');
    const elProfs = document.getElementById('stat-profesores');

    if (elTotal) elTotal.innerText = horariosEstudiante.length;

    const diasConClase = new Set(horariosEstudiante.map(h => h.dia_semana));
    if (elDias) elDias.innerText = diasConClase.size;

    const profesoresUnicos = new Set(horariosEstudiante.map(h => h.profesor_nombre || h.profesor_id));
    if (elProfs) elProfs.innerText = profesoresUnicos.size;
}

function generarTablaCompacta() {
    const tbody = document.getElementById('cuerpoHorario');
    if (!tbody) return;

    if (horariosEstudiante.length === 0) {
        const texto = tieneSeccion
            ? 'Tu sección todavía no tiene horario cargado. Consulta con el director.'
            : 'Aún no tienes sección asignada. Consulta con el director.';
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px;">${texto}</td></tr>`;
        return;
    }

    const BloquesHoras = [];
    horariosEstudiante.forEach(h => {
        if (h.hora_inicio && h.hora_fin) {
            const rango = `${h.hora_inicio.substring(0, 5)} - ${h.hora_fin.substring(0, 5)}`;
            if (!BloquesHoras.includes(rango)) BloquesHoras.push(rango);
        }
    });
    BloquesHoras.sort();

    let html = '';
    
    if (BloquesHoras.length === 0) BloquesHoras.push('Horario');

    BloquesHoras.forEach((rango, indexBloque) => {
        html += '<tr>';
        html += `<td style="font-weight:700; color:var(--text-secondary); font-size:12px; background:var(--bg-table-hover); vertical-align:middle;">${rango}</td>`;

        diasSemana.forEach(dia => {
            const esSeleccionado = (dia === diaEnfocado);
            const estiloFondo = esSeleccionado ? 'background: rgba(236, 201, 75, 0.1);' : '';
            
            const evento = obtenerEventoDelDia(dia);
            const esFestivo = evento && evento.afecta_asistencia == 1;

            if (esFestivo) {
                const colorEvento = evento.color_evento || '#FF3B30';
                html += `<td style="background:${colorEvento}15; border: 1px solid ${colorEvento}40; vertical-align:middle; text-align:center;">`;
                if (indexBloque === 0) {
                    html += `<div style="color:${colorEvento}; font-weight:bold; font-size:12px; padding:5px;">`;
                    html += `<i class='bx bx-party'></i> ${escapeHTML(evento.titulo)}`;
                    html += `<div style="font-size:10px; text-transform:capitalize; opacity:0.8;">${escapeHTML(evento.tipo_evento)}</div>`;
                    html += `</div>`;
                }
                html += `</td>`;
                return; 
            }

            let badgeEvento = '';
            if (evento) {
                const colorEvento = evento.color_evento || '#007AFF';
                let infoEvento = escapeHTML(evento.titulo);
                
                if (evento.hora_inicio && evento.hora_fin) {
                    infoEvento += ` (${evento.hora_inicio} a ${evento.hora_fin})`;
                }
                if (evento.materia) {
                    infoEvento += ` - ${escapeHTML(evento.materia)}`;
                }

                const horaE = evento.hora_inicio ? evento.hora_inicio.substring(0, 5) : null;
                
                let esSuHora = false;
                if (horaE) {
                    const [hE, mE] = horaE.split(':').map(Number);
                    const minE = hE * 60 + mE;
                    const [hIni, mIni] = rango.split(' - ')[0].split(':').map(Number);
                    const [hFin, mFin] = rango.split(' - ')[1].split(':').map(Number);
                    const minIni = hIni * 60 + mIni;
                    const minFin = hFin * 60 + mFin;
                    
                    if (minE >= minIni && minE <= minFin) {
                        esSuHora = true;
                    }
                } else {
                    esSuHora = (indexBloque === 0);
                }

                if (esSuHora) {
                    badgeEvento = `<div style="background:${colorEvento}15; color:${colorEvento}; font-size:11px; padding:6px; margin-bottom:6px; border-radius:6px; border:1px solid ${colorEvento}40; text-align:center; font-weight:600; line-height:1.2;"><i class='bx bx-star'></i> ${infoEvento}</div>`;
                }
            }

            const clases = horariosEstudiante.filter(item => {
                if (!item.hora_inicio || !item.hora_fin) return false;
                const inicio = item.hora_inicio.substring(0, 5);
                const fin = item.hora_fin.substring(0, 5);
                return item.dia_semana === dia && `${inicio} - ${fin}` === rango;
            });

            if (clases.length > 0) {
                html += `<td style="${estiloFondo}">`;
                html += badgeEvento;
                clases.forEach(clase => {
                    html += `<div class="celda-clase" ${clases.length > 1 ? 'style="border-left-color:#FF3B30;"' : ''}>`;
                    html += `<div class="materia" style="font-weight:600; color:var(--text-primary);">${escapeHTML(clase.materia)}</div>`;
                    html += `<div class="profesor" style="font-size:12px; color:var(--text-secondary);">${escapeHTML(clase.profesor_nombre || 'Profesor')}</div>`;
                    if (clase.aula) html += `<div class="aula" style="font-size:11px; color:var(--border-focus); margin-top:2px;"><i class='bx bx-door-open'></i> ${escapeHTML(clase.aula)}</div>`;
                    html += '</div>';
                });
                html += '</td>';
            } else {
                // AQUI ESTA EL CAMBIO: Cambiamos el '-' por 'Sin clase' con un poquito de opacidad
                html += `<td style="${estiloFondo}">`;
                html += badgeEvento;
                html += `<span class="celda-vacia" style="color:var(--text-muted); font-size: 11px; opacity: 0.6; font-style: italic;">Sin clase</span></td>`;
            }
        });

        html += '</tr>';
    });

    tbody.innerHTML = html;
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

document.addEventListener('DOMContentLoaded', function() {
    cargarHorarioEstudiante();
});