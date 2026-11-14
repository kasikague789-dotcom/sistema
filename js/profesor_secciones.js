const PROFESOR_ACTUAL_ID = window.USUARIO.id; // usuario con sesión iniciada

document.addEventListener('DOMContentLoaded', async () => {
    actualizarReloj();
    setInterval(actualizarReloj, 60000);

    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        const icon = document.getElementById('darkModeIcon');
        if (icon) icon.textContent = '';
    }

    await cargarSeccionesAcordeon();
    irASeccionDelEnlace();
    window.addEventListener('hashchange', irASeccionDelEnlace);
});

// Al venir desde "Mis Secciones" del menú: abre esa clase y la deja a la vista
function irASeccionDelEnlace() {
    const id = decodeURIComponent((location.hash || '').slice(1));
    if (!id) return;
    // Enlaces viejos (#seccion-5): se abre la primera clase de esa sección
    const card = document.getElementById(id) || document.querySelector(`.seccion-card[id^="${CSS.escape(id)}-"]`);
    if (!card) return;
    const cuerpo = card.querySelector('.seccion-header + *');
    const flecha = card.querySelector('.arrow-toggle');
    if (cuerpo && !cuerpo.classList.contains('open')) { cuerpo.classList.add('open'); if (flecha) flecha.classList.add('open'); }
    card.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    card.classList.remove('seccion-resaltada'); void card.offsetWidth; card.classList.add('seccion-resaltada');
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

async function cargarSeccionesAcordeon() {
    try {
        const response = await fetch(`/api/profesores/mis-secciones/${PROFESOR_ACTUAL_ID}`);
        if (!response.ok) throw new Error('No se pudo obtener las secciones');
        
        const result = await response.json();
        const seccionesData = result.datos || [];
        const listaContenedor = document.getElementById('lista-secciones');
        const submenuContenedor = document.getElementById('submenu-secciones');

        listaContenedor.innerHTML = '';
        if (submenuContenedor) submenuContenedor.innerHTML = '';

        if (seccionesData.length === 0) {
            listaContenedor.innerHTML = `
                <div style="text-align:center; padding:40px; background:var(--bg-card, #fff); border-radius:12px; box-shadow:var(--shadow-sm, 0 2px 4px rgba(0,0,0,0.05));">
                    <div style="font-size:48px; margin-bottom:10px;"></div>
                    <h3 style="color:var(--text-primary, #2d3748); margin:0;">No tienes secciones asignadas</h3>
                </div>
            `;
            return;
        }

        const hoyStr = new Date().toLocaleDateString('es-ES');

        seccionesData.forEach(s => {
            if (submenuContenedor) {
                submenuContenedor.innerHTML += `
                    <li><a href="#${window.anclaClase(s.curso_id, s.materia)}">
                        ${escapeHTML(s.materia)} - ${escapeHTML(s.curso_nombre)} ${escapeHTML(s.seccion + (s.turno ? ' · ' + s.turno : ''))}
                    </a></li>
                `;
            }

            let estudiantesHTML = '';
            
            if (s.estudiantes.length === 0) {
                estudiantesHTML = `<tr><td colspan="5" style="text-align:center; padding:20px;">Sin estudiantes asignados</td></tr>`;
            } else {
                s.estudiantes.forEach((est, index) => {
                    let estadoHoyHTML = `<span class="badge-asistencia-mini sin-marcar">Sin marcar</span>`;
                    if (est.estado_hoy === 'presente') estadoHoyHTML = `<span class="badge-asistencia-mini presente">Presente</span>`;
                    else if (est.estado_hoy === 'ausente') estadoHoyHTML = `<span class="badge-asistencia-mini ausente">Ausente</span>`;
                    else if (est.estado_hoy === 'tarde') estadoHoyHTML = `<span class="badge-asistencia-mini tarde">Tarde</span>`;
                    else if (est.estado_hoy === 'justificada') estadoHoyHTML = `<span class="badge-asistencia-mini justificado">Justificado</span>`;

                    let ultimasClasesHTML = '<div class="ultimas-clases">';
                    est.ultimas.forEach(u => {
                        let clase = 'sin'; let ic = '-';
                        if (u === 'presente') { clase = 'presente'; ic = 'P'; }
                        else if (u === 'ausente') { clase = 'ausente'; ic = 'A'; }
                        else if (u === 'tarde') { clase = 'tarde'; ic = 'T'; }
                        else if (u === 'justificada') { clase = 'justificado'; ic = 'J'; }
                        ultimasClasesHTML += `<div class="dia ${clase}" title="${u}">${ic}</div>`;
                    });
                    if (est.ultimas.length === 0) ultimasClasesHTML += `<div class="dia sin">-</div>`;
                    ultimasClasesHTML += '</div>';

                    estudiantesHTML += `
                        <tr>
                            <td>${index + 1}</td>
                            <td><strong>${escapeHTML(est.nombre)}</strong></td>
                            <td>${escapeHTML(est.cedula)}</td>
                            <td>${estadoHoyHTML}</td>
                            <td>${ultimasClasesHTML}</td>
                            <td>${hoyStr}</td>
                        </tr>
                    `;
                });
            }

            listaContenedor.innerHTML += `
                <div class="seccion-card" id="${window.anclaClase(s.curso_id, s.materia)}">
                    <div class="seccion-header" onclick="toggleSeccion(this)">
                        <div class="info">
                            <div class="titulo">
                                ${escapeHTML(s.materia)} <span class="materia">- ${escapeHTML(s.curso_nombre)} ${escapeHTML(s.seccion + (s.turno ? ' · ' + s.turno : ''))}</span>
                            </div>
                            <div class="horario">${escapeHTML(s.horario_texto)}</div>
                            <div class="stats-mini">
                                <div class="item"><span class="num">${s.estudiantes_count}</span> estudiantes</div>
                                <div class="item"><span class="num">${s.marcados_hoy > 0 ? s.porcentaje_asistencia + '%' : '—'}</span> asistencia hoy</div>
                            </div>
                        </div>
                        <div style="display:flex; align-items:center; gap:15px;">
                            ${s.es_feriado ? '<span class="badge-horario inactivo">Día feriado</span>' : (s.en_horario ? '<span class="badge-horario activo">En horario</span>' : '<span class="badge-horario inactivo">Fuera de horario</span>')}
                            <span class="arrow-toggle">▼</span>
                        </div>
                    </div>

                    <div class="seccion-body open">
                        <div class="acciones-rapidas">
                            <a href="pasar_lista.html?curso_id=${s.curso_id}&materia=${encodeURIComponent(s.materia)}" class="btn btn-pasar-lista">${s.lista_guardada_hoy ? 'Editar Lista' : 'Pasar Lista'}</a>
                            <a href="reportes.html?curso_id=${s.curso_id}&materia=${encodeURIComponent(s.materia)}" class="btn btn-reporte">Reporte</a>
                        </div>

                        <div style="overflow-x:auto;">
                            <table class="tabla-estudiantes-seccion">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Estudiante</th>
                                        <th>Cédula</th>
                                        <th>Asistencia Hoy</th>
                                        <th>Últimas 3</th>
                                        <th>Fecha</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${estudiantesHTML}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
        });

    } catch (err) {
        console.error('Error al cargar secciones:', err);
    }
}

function toggleSeccion(el) {
    const body = el.nextElementSibling;
    const arrow = el.querySelector('.arrow-toggle');
    if (body) {
        body.classList.toggle('open');
        if (arrow) arrow.classList.toggle('open');
    }
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

