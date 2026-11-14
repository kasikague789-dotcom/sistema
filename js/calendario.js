const API_CALENDARIO = '/api/calendario/eventos';
const PROFESOR_ACTUAL_ID = window.USUARIO.id; 
let eventos = [];
let cursosList = [];

let mesVista = new Date().getMonth() + 1;
let anioVista = new Date().getFullYear();

const nombresMeses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

async function cargarCursosSelect() {
    // Solo el director crea eventos (el profesor solo mira el calendario)
    if (!window.USUARIO || window.USUARIO.rol !== 'director') return;
    try {
        const res = await fetch('/api/secciones');
        const data = await res.json();
        if (data.estado === 'exitoso') {
            cursosList = data.datos || [];
            const select = document.getElementById('curso_id');
            cursosList.forEach(c => {
                select.innerHTML += `<option value="${c.id}">${c.nivel || ''} ${c.nombre} - "${c.seccion}${c.turno ? ' · ' + c.turno : ''}"</option>`;
            });
        }
    } catch (e) {
        console.error('Error al cargar cursos', e);
    }
}

function toggleCamposHora() {
    const tipo = document.getElementById('tipo_evento').value;
    const div = document.getElementById('campos-hora');
    if (tipo === 'actividad_especial') {
        div.style.display = 'block';
    } else {
        div.style.display = 'none';
        document.getElementById('hora_inicio').value = '';
        document.getElementById('hora_fin').value = '';
        document.getElementById('materia').value = '';
        document.getElementById('curso_id').value = '';
    }
}

async function cargarSubmenuSecciones() {
    const ul = document.getElementById('submenu-secciones');
    if (!ul) return;

    try {
        const res = await fetch(`/api/profesores/mis-secciones/${PROFESOR_ACTUAL_ID}`);
        const data = await res.json();
        const secciones = data.datos || [];
        ul.innerHTML = ''; 
        
        if (secciones.length === 0) {
            ul.innerHTML = '<li><a href="#" style="color:var(--text-muted); font-style:italic; padding-left:15px; font-size:12px;">Sin secciones</a></li>';
        } else {
            secciones.forEach(s => {
                ul.innerHTML += `
                    <li><a href="secciones.html#${window.anclaClase(s.curso_id, s.materia)}">
                        ${s.materia} - ${s.curso_nombre} ${s.seccion}${s.turno ? ' · ' + s.turno : ''}
                    </a></li>
                `;
            });
        }
    } catch (error) {
        console.error('Error al cargar secciones en el submenú:', error);
    }
}

async function cargarEventosAPI() {
    try {
        const res = await fetch(API_CALENDARIO);
        const data = await res.json();
        if (data.estado === 'exitoso') {
            eventos = data.datos.map(e => ({
                ...e,
                fecha_inicio: typeof e.fecha_inicio === 'string' ? e.fecha_inicio.split('T')[0] : e.fecha_inicio,
                fecha_fin: typeof e.fecha_fin === 'string' ? e.fecha_fin.split('T')[0] : e.fecha_fin
            }));
            renderCalendario();
            renderListaEventos();
        }
    } catch (error) {
        console.error('Error al obtener eventos de la BD:', error);
    }
}

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

function renderCalendario() {
    const tituloMes = document.getElementById('titulo-mes');
    if (tituloMes) tituloMes.innerText = `${nombresMeses[mesVista]} ${anioVista}`;

    const grid = document.getElementById('grid-calendario');
    if (!grid) return;

    grid.innerHTML = `
        <div class="header-dia">Lun</div>
        <div class="header-dia">Mar</div>
        <div class="header-dia">Mié</div>
        <div class="header-dia">Jue</div>
        <div class="header-dia">Vie</div>
        <div class="header-dia">Sáb</div>
        <div class="header-dia">Dom</div>
    `;

    const primerDiaObj = new Date(anioVista, mesVista - 1, 1);
    let primerDiaSemana = (primerDiaObj.getDay() + 6) % 7; 
    const totalDiasMes = new Date(anioVista, mesVista, 0).getDate();

    const hoy = new Date();
    const hoyDia = hoy.getDate();
    const hoyMes = hoy.getMonth() + 1;
    const hoyAnio = hoy.getFullYear();

    for (let i = 0; i < primerDiaSemana; i++) {
        grid.innerHTML += '<div class="dia vacio"></div>';
    }

    const esDirector = !!document.getElementById('formEvento');

    for (let d = 1; d <= totalDiasMes; d++) {
        const mesPad = String(mesVista).padStart(2, '0');
        const diaPad = String(d).padStart(2, '0');
        const fechaStr = `${anioVista}-${mesPad}-${diaPad}`;

        const eventosDia = eventos.filter(e => e.fecha_inicio <= fechaStr && e.fecha_fin >= fechaStr);
        const tieneFeriado = eventosDia.some(e => e.afecta_asistencia == 1);
        const esHoy = (d === hoyDia && mesVista === hoyMes && anioVista === hoyAnio);

        let clases = 'dia';
        if (esHoy) clases += ' hoy';
        if (tieneFeriado) clases += ' feriado';

        let eventosHTML = '';
        if (eventosDia.length > 0) {
            eventosHTML += '<div class="eventos-dia">';
            eventosDia.forEach(ev => {
                const color = ev.color_evento || '#718096';
                const titCorto = ev.titulo.length > 12 ? ev.titulo.substring(0, 12) + '...' : ev.titulo;
                const descText = ev.descripcion ? `<div class="desc">${ev.descripcion.replace(/\n/g, '<br>')}</div>` : '';
                const fechaRango = ev.fecha_inicio !== ev.fecha_fin ? ` - ${formatearFechaSimple(ev.fecha_fin)}` : '';

                eventosHTML += `
                    <span class="evento-mini" style="background:${color};" onclick="event.stopPropagation(); abrirModalDia('${fechaStr}', ${d})">
                        ${titCorto}
                    </span>
                    <div class="tooltip">
                        <div class="titulo">${ev.titulo}</div>
                        ${descText}
                        <div class="fecha">${formatearFechaSimple(ev.fecha_inicio)}${fechaRango}</div>
                    </div>
                `;
            });
            eventosHTML += '</div>';
        }

        grid.innerHTML += `
            <div class="${clases}" onclick="abrirModalDia('${fechaStr}', ${d})">
                <div class="numero">${d}</div>
                ${eventosHTML}
            </div>
        `;
    }
}

function renderListaEventos() {
    const cont = document.getElementById('lista-eventos');
    if (!cont) return;

    if (eventos.length === 0) {
        cont.innerHTML = '<p style="text-align:center; padding:20px; color:var(--text-muted);">No hay eventos registrados</p>';
        return;
    }

    const ordenados = [...eventos].sort((a, b) => new Date(b.fecha_inicio) - new Date(a.fecha_inicio));
    const esDirector = !!document.getElementById('formEvento');

    let html = '';
    ordenados.forEach(e => {
        const color = e.color_evento || '#718096';
        const rango = e.fecha_inicio !== e.fecha_fin ? ` - ${formatearFechaSimple(e.fecha_fin)}` : '';
        const tipoCap = e.tipo_evento.charAt(0).toUpperCase() + e.tipo_evento.slice(1);

        const botonesAccion = esDirector ? `
            <div class="acciones">
                <button onclick="cargarEdicion(${e.id})" class="btn-sm btn-primary" title="Editar">Editar</button>
                <button onclick="eliminarEvento(${e.id})" class="btn-sm btn-danger" title="Eliminar">Eliminar</button>
            </div>
        ` : '';

        let infoExtra = '';
        if (e.hora_inicio && e.hora_fin) {
            infoExtra = `<br><small style="color:var(--text-muted);"><i class='bx bx-time'></i> ${e.hora_inicio} a ${e.hora_fin}</small>`;
        }
        if (e.materia) {
            infoExtra += `<br><small style="color:var(--text-muted);"><i class='bx bx-book'></i> ${e.materia}</small>`;
        }
        if (e.curso_id) {
            const curso = cursosList.find(c => c.id == e.curso_id);
            if (curso) {
                infoExtra += `<br><small style="color:var(--text-muted);"><i class='bx bx-group'></i> ${curso.nivel || ''} ${curso.nombre} - ${curso.seccion}${curso.turno ? ' · ' + curso.turno : ''}</small>`;
            }
        }

        html += `
            <div class="evento-item" style="border-left-color: ${color};">
                <div class="color-badge" style="background: ${color};"></div>
                <div class="info">
                    <div class="titulo">${e.titulo}</div>
                    <div class="fecha">
                        ${formatearFechaSimple(e.fecha_inicio)}${rango}
                        ${infoExtra}
                        <span class="badge-${e.tipo_evento}" style="margin-left:5px; font-size:9px; padding:1px 8px; border-radius:4px; background:var(--bg-card); color:var(--text-primary);">
                            ${tipoCap}
                        </span>
                    </div>
                </div>
                ${botonesAccion}
            </div>
        `;
    });

    cont.innerHTML = html;
}

function formatearFechaSimple(fechaStr) {
    if (!fechaStr) return '';
    const p = fechaStr.split('-');
    return `${p[2]}/${p[1]}/${p[0]}`;
}

function cambiarMes(delta) {
    mesVista += delta;
    if (mesVista < 1) {
        mesVista = 12;
        anioVista--;
    } else if (mesVista > 12) {
        mesVista = 1;
        anioVista++;
    }
    renderCalendario();
}

function irHoy() {
    const h = new Date();
    mesVista = h.getMonth() + 1;
    anioVista = h.getFullYear();
    renderCalendario();
}

function cargarEdicion(id) {
    const form = document.getElementById('formEvento');
    if (!form) return;

    const ev = eventos.find(e => e.id == id);
    if (!ev) return;

    document.getElementById('evento_id').value = ev.id;
    document.getElementById('titulo').value = ev.titulo;
    document.getElementById('descripcion').value = ev.descripcion || '';
    document.getElementById('fecha_inicio').value = ev.fecha_inicio;
    document.getElementById('fecha_fin').value = ev.fecha_fin;
    document.getElementById('tipo_evento').value = ev.tipo_evento;
    document.getElementById('color_evento').value = ev.color_evento || '#FF0000';
    
    document.getElementById('hora_inicio').value = ev.hora_inicio || '';
    document.getElementById('hora_fin').value = ev.hora_fin || '';
    document.getElementById('materia').value = ev.materia || '';
    document.getElementById('curso_id').value = ev.curso_id || '';
    toggleCamposHora();

    document.getElementById('titulo-form').innerText = 'Editar Evento';
    document.getElementById('btn-submit-form').className = 'btn btn-warning';
    document.getElementById('btn-submit-form').innerText = 'Actualizar Evento';
    document.getElementById('btn-cancelar-edicion').style.display = 'block';

    cerrarModalDia();
    form.scrollIntoView({ behavior: 'smooth' });
}

function cancelarEdicion() {
    const form = document.getElementById('formEvento');
    if (!form) return;

    document.getElementById('evento_id').value = '';
    form.reset();

    const hoyStr = window.fechaLocalISO();
    document.getElementById('fecha_inicio').value = hoyStr;
    document.getElementById('fecha_fin').value = hoyStr;
    
    toggleCamposHora();

    document.getElementById('titulo-form').innerText = 'Agregar Evento';
    document.getElementById('btn-submit-form').className = 'btn btn-success';
    document.getElementById('btn-submit-form').innerText = 'Agregar Evento';
    document.getElementById('btn-cancelar-edicion').style.display = 'none';
}

async function eliminarEvento(id) {
    if (await confirmar('El evento se borra del calendario de todos los usuarios.', { titulo: '¿Eliminar este evento?', aceptar: 'Eliminar evento', peligro: true })) {
        try {
            const res = await fetch(`${API_CALENDARIO}/${id}`, { method: 'DELETE' });
            const data = await res.json();

            if (data.estado === 'exitoso') {
                cerrarModalDia();
                await cargarEventosAPI();
                const alertBox = document.getElementById('alert-container');
                if (alertBox) {
                    alertBox.innerHTML = '<div class="alert alert-success">Evento eliminado correctamente</div>';
                    setTimeout(() => { alertBox.innerHTML = ''; }, 3000);
                }
            } else {
                avisar(data.mensaje || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo eliminar el evento' });
            }
        } catch (err) {
            console.error('Error eliminando evento:', err);
        }
    }
}

function abrirModalDia(fechaStr, dia) {
    const modal = document.getElementById('modalDia');
    if (!modal) return;

    const p = fechaStr.split('-');
    const mesNom = nombresMeses[parseInt(p[1])];

    const modalFecha = document.getElementById('modalFechaDia');
    if (modalFecha) modalFecha.innerText = `${dia} de ${mesNom} de ${p[0]}`;

    const evsDelDia = eventos.filter(e => e.fecha_inicio <= fechaStr && e.fecha_fin >= fechaStr);
    const eventosDiv = document.getElementById('modalEventosDia');
    const accionesDiv = document.getElementById('modalAccionesDia');
    const esDirector = !!document.getElementById('formEvento');

    if (eventosDiv) {
        if (evsDelDia.length > 0) {
            let html = '';
            evsDelDia.forEach(ev => {
                const color = ev.color_evento || '#718096';
                const tipo = ev.tipo_evento.charAt(0).toUpperCase() + ev.tipo_evento.slice(1);
                const desc = ev.descripcion ? `<br><small style="color:var(--text-muted);">${ev.descripcion}</small>` : '';
                
                let infoExtra = '';
                if (ev.hora_inicio && ev.hora_fin) {
                    infoExtra = `<br><small style="color:var(--text-muted);"><i class='bx bx-time'></i> ${ev.hora_inicio} a ${ev.hora_fin}</small>`;
                }
                if (ev.materia) {
                    infoExtra += `<br><small style="color:var(--text-muted);"><i class='bx bx-book'></i> ${ev.materia}</small>`;
                }
                if (ev.curso_id) {
                    const curso = cursosList.find(c => c.id == ev.curso_id);
                    if (curso) infoExtra += `<br><small style="color:var(--text-muted);"><i class='bx bx-group'></i> ${curso.nivel || ''} ${curso.nombre} - ${curso.seccion}${curso.turno ? ' · ' + curso.turno : ''}</small>`;
                }

                html += `
                    <div class="evento-info">
                        <span class="color-dot" style="background:${color};"></span>
                        <div>
                            <strong>${ev.titulo}</strong>
                            <br>
                            <small style="color:var(--text-muted);">
                                ${tipo} • ${formatearFechaSimple(ev.fecha_inicio)} ${ev.fecha_inicio !== ev.fecha_fin ? '- ' + formatearFechaSimple(ev.fecha_fin) : ''}
                            </small>
                            ${infoExtra}
                            ${desc}
                        </div>
                    </div>
                `;
            });
            eventosDiv.innerHTML = html;
        } else {
            eventosDiv.innerHTML = '<div class="no-eventos">No hay eventos en este día</div>';
        }
    }

    if (accionesDiv) {
        let accionesHtml = '';
        if (esDirector) {
            if (evsDelDia.length > 0) {
                evsDelDia.forEach(ev => {
                    const titCorto = ev.titulo.length > 15 ? ev.titulo.substring(0, 15) + '...' : ev.titulo;
                    accionesHtml += `
                        <button onclick="cargarEdicion(${ev.id})" class="btn btn-primary">Editar "${titCorto}"</button>
                        <button onclick="eliminarEvento(${ev.id})" class="btn btn-danger">Eliminar "${titCorto}"</button>
                    `;
                });
            }
            accionesHtml += `
                <button onclick="prepararNuevoEventoEnFecha('${fechaStr}')" class="btn btn-success" style="flex:1;">
                    Agregar evento en este día
                </button>
            `;
        }

        accionesHtml += `
            <button onclick="cerrarModalDia()" class="btn btn-secondary" style="flex:1;">
                Cerrar
            </button>
        `;

        accionesDiv.innerHTML = accionesHtml;
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function prepararNuevoEventoEnFecha(fechaStr) {
    cancelarEdicion();
    const fInicio = document.getElementById('fecha_inicio');
    const fFin = document.getElementById('fecha_fin');
    if (fInicio) fInicio.value = fechaStr;
    if (fFin) fFin.value = fechaStr;
    cerrarModalDia();
    const form = document.getElementById('formEvento');
    if (form) form.scrollIntoView({ behavior: 'smooth' });
}

function cerrarModalDia() {
    const modal = document.getElementById('modalDia');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

document.addEventListener('DOMContentLoaded', async function () {
    actualizarReloj();
    setInterval(actualizarReloj, 60000);
    
    await cargarCursosSelect(); // Cargamos los cursos al iniciar
    cargarSubmenuSecciones();

    const modalDia = document.getElementById('modalDia');
    if (modalDia) {
        modalDia.addEventListener('click', function (e) {
            if (e.target === this) cerrarModalDia();
        });
    }

    const formEvento = document.getElementById('formEvento');
    if (formEvento) {
        const hoyStr = window.fechaLocalISO();
        const fInicio = document.getElementById('fecha_inicio');
        const fFin = document.getElementById('fecha_fin');
        if (fInicio) fInicio.value = hoyStr;
        if (fFin) fFin.value = hoyStr;

        if (fInicio && fFin) {
            fInicio.addEventListener('change', function () {
                if (!fFin.value || fFin.value < this.value) {
                    fFin.value = this.value;
                }
            });
        }

        formEvento.addEventListener('submit', async function (e) {
            e.preventDefault();

            const id = document.getElementById('evento_id').value;
            const titulo = document.getElementById('titulo').value.trim();
            const descripcion = document.getElementById('descripcion').value.trim();
            const fecha_inicio = document.getElementById('fecha_inicio').value;
            const fecha_fin = document.getElementById('fecha_fin').value;
            const tipo_evento = document.getElementById('tipo_evento').value;
            const color_evento = document.getElementById('color_evento').value;
            
            const hora_inicio = document.getElementById('hora_inicio').value;
            const hora_fin = document.getElementById('hora_fin').value;
            const materia = document.getElementById('materia').value.trim();
            const curso_id = document.getElementById('curso_id').value;

            const alertBox = document.getElementById('alert-container');
            const payload = { titulo, descripcion, fecha_inicio, fecha_fin, hora_inicio, hora_fin, materia, curso_id, tipo_evento, color_evento };

            try {
                let res;
                if (id) {
                    res = await fetch(`${API_CALENDARIO}/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } else {
                    res = await fetch(API_CALENDARIO, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }

                const data = await res.json();

                if (data.estado === 'exitoso') {
                    if (alertBox) alertBox.innerHTML = `<div class="alert alert-success">${data.mensaje || 'Operación realizada correctamente'}</div>`;
                    cancelarEdicion();
                    await cargarEventosAPI();
                } else {
                    if (alertBox) alertBox.innerHTML = `<div class="alert alert-danger">${data.mensaje}</div>`;
                }
            } catch (err) {
                console.error('Error al enviar datos:', err);
                if (alertBox) alertBox.innerHTML = '<div class="alert alert-danger">Error de comunicación con el servidor Node.js</div>';
            }

            if (alertBox) setTimeout(() => { alertBox.innerHTML = ''; }, 3000);
        });
    }

    cargarEventosAPI();
});