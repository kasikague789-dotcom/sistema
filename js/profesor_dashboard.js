const PROFESOR_ACTUAL_ID = window.USUARIO.id; // usuario con sesión iniciada

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
    }
    
    actualizarReloj();
    setInterval(actualizarReloj, 60000);

    cargarDashboardProfesor();
    cargarSuplencias();
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

async function cargarDashboardProfesor() {
    try {
        // Usamos ruta relativa para que funcione perfecto en local y al subir a producción
        const response = await fetch(`/api/profesores/dashboard/${PROFESOR_ACTUAL_ID}`);
        if (!response.ok) throw new Error('No se pudo conectar con el servidor para obtener el dashboard.');
        
        const data = await response.json();
        
        document.getElementById('saludo-profesor').innerText = `Bienvenido, ${data.profesor.nombre} ${data.profesor.apellido}`;

        const seccionesData = data.secciones || [];
        const totalSecciones = seccionesData.length;
        let presentesTotales = 0;
        let marcadosTotales = 0;
        const estudiantesPorSeccion = {};

        seccionesData.forEach(s => {
            estudiantesPorSeccion[s.curso_id] = s.total_estudiantes; // una sección con 2 materias no cuenta doble
            presentesTotales += s.presentes_hoy;
            marcadosTotales += s.marcados_hoy || 0;
        });
        const totalEstudiantes = Object.values(estudiantesPorSeccion).reduce((a, b) => a + b, 0);

        // % sobre los estudiantes ya marcados hoy en sus clases
        const porcentajeGeneral = marcadosTotales > 0 ? ((presentesTotales / marcadosTotales) * 100).toFixed(1) : 0;

        document.getElementById('stat-total-secciones').innerText = totalSecciones;
        document.getElementById('stat-total-estudiantes').innerText = totalEstudiantes;
        document.getElementById('stat-porcentaje-hoy').innerText = `${porcentajeGeneral}%`;
        document.getElementById('stat-justificaciones-pendientes').innerText = data.justificacionesPendientesCount;

        const badgeJustMenu = document.getElementById('badge-justificaciones-menu');
        if (badgeJustMenu) {
            if (data.justificacionesPendientesCount > 0) {
                badgeJustMenu.innerText = data.justificacionesPendientesCount;
                badgeJustMenu.style.display = 'inline-block';
            } else {
                badgeJustMenu.style.display = 'none';
            }
        }

        const fab = document.getElementById('fab-pasar-lista');
        if (fab && totalSecciones > 0) {
            fab.classList.add('visible');
            document.getElementById('fab-badge-count').innerText = totalSecciones;
            // Primero la clase que está en horario ahora; si no, la primera
            const clase = seccionesData.find(s => s.en_horario) || seccionesData[0];
            fab.onclick = () => {
                window.location.href = `pasar_lista.html?curso_id=${clase.curso_id}&materia=${encodeURIComponent(clase.materia)}`;
            };
        } else if (fab) {
            fab.classList.remove('visible');
        }

        cargarSubmenuSecciones(seccionesData);

        const contenedorSecciones = document.getElementById('contenedor-tarjetas-secciones');
        contenedorSecciones.innerHTML = '';

        if (totalSecciones === 0) {
            contenedorSecciones.innerHTML = `
                <div style="text-align:center; padding:40px; background:var(--bg-card, #fff); border-radius:12px; box-shadow:var(--shadow-sm, 0 2px 4px rgba(0,0,0,0.05));">
                    <h3 style="color:var(--text-primary, #2d3748); margin:0;">No tienes secciones asignadas</h3>
                    <p style="color:var(--text-secondary, #718096);">Contacta al director para que te asigne secciones.</p>
                </div>
            `;
        } else {
            seccionesData.forEach(c => {
                let badgeHorarioHTML = data.esFeriado ? 
                    `<span class="badge-horario inactivo">Día feriado</span>` : 
                    (c.en_horario ? `<span class="badge-horario activo">En horario ahora</span>` : `<span class="badge-horario inactivo">Fuera de horario</span>`);

                let horariosHTML = `<div style="font-size:13px; color:var(--text-secondary, #718096); margin-top:3px;">${escapeHTML(c.horarios_text.join(', '))}</div>`;

                let clasePorcentaje = 'medio';
                if (c.porcentaje_asistencia >= 85) clasePorcentaje = 'alto';
                else if (c.porcentaje_asistencia < 70) clasePorcentaje = 'bajo';

                const materiaURL = encodeURIComponent(c.materia);
                let btnPasarListaHTML = `<a href="pasar_lista.html?curso_id=${c.curso_id}&materia=${materiaURL}" class="btn btn-pasar-lista">${c.lista_guardada_hoy ? 'Editar Lista' : 'Pasar Lista'}</a>`;
                // En horario: acceso directo para escanear carnets (abre la lista con el lector listo)
                if (c.en_horario && !data.esFeriado) {
                    btnPasarListaHTML = `<a href="pasar_lista.html?curso_id=${c.curso_id}&materia=${materiaURL}&escanear=1" class="btn btn-escanear-qr"><i class='bx bx-qr-scan'></i> Escanear QR</a>` + btnPasarListaHTML;
                }

                contenedorSecciones.innerHTML += `
                    <div class="seccion-card" id="curso-${c.curso_id}">
                        <div class="header-card">
                            <div>
                                <div class="titulo">
                                    ${escapeHTML(c.materia)}
                                    <span class="materia">- ${escapeHTML(c.curso_nombre + ' - ' + c.seccion + (c.turno ? ' · ' + c.turno : ''))}</span>
                                </div>
                                ${horariosHTML}
                            </div>
                            <div>${badgeHorarioHTML}</div>
                        </div>

                        <div class="info-grid">
                            <div class="item">
                                <span class="label">Estudiantes</span>
                                <span class="value">${c.total_estudiantes}</span>
                            </div>
                            <div class="item">
                                <span class="label">Asistencia Hoy</span>
                                <span class="value">
                                    ${c.marcados_hoy > 0
                                        ? `<span class="porcentaje ${clasePorcentaje}">${c.porcentaje_asistencia}%</span> (${c.presentes_hoy}/${c.marcados_hoy})`
                                        : '<span style="color:var(--text-muted);">Sin lista hoy</span>'}
                                </span>
                            </div>
                            <div class="item">
                                <span class="label">Justificaciones</span>
                                <span class="value">${c.justificaciones_count}</span>
                            </div>
                        </div>

                        <div class="acciones-card">
                            ${btnPasarListaHTML}
                            <a href="estudiantes.html?curso_id=${c.curso_id}&materia=${materiaURL}" class="btn btn-ver-estudiantes">Ver Estudiantes</a>
                            <a href="reportes.html?curso_id=${c.curso_id}&materia=${materiaURL}" class="btn btn-reporte">Reporte</a>
                        </div>
                    </div>
                `;
            });
        }

        const contenedorEventos = document.getElementById('contenedor-eventos-proximos');
        contenedorEventos.innerHTML = '';
        const eventos = data.eventosProximos || [];

        if (eventos.length === 0) {
            contenedorEventos.innerHTML = '<p style="color:var(--text-muted, #a0aec0); font-size:14px;">No hay eventos próximos</p>';
        } else {
            eventos.forEach(e => {
                const fechaInicioFmt = String(e.fecha_inicio || '').split('-').reverse().join('/');
                contenedorEventos.innerHTML += `
                    <div class="evento-mini" style="border-left-color: #3182ce;">
                        <div>
                            <div class="titulo">${escapeHTML(e.titulo)}</div>
                            <div class="fecha">${fechaInicioFmt}</div>
                        </div>
                        <span style="font-size:11px; padding:2px 10px; border-radius:12px; background:#e2e8f0; color:#4a5568;">${escapeHTML(e.tipo)}</span>
                    </div>
                `;
            });
        }

    } catch (err) {
        console.error('Error cargando dashboard del profesor:', err);
    }
}

function cargarSubmenuSecciones(secciones) {
    const ul = document.getElementById('submenu-secciones');
    if (!ul) return;
    ul.innerHTML = '';
    secciones.forEach(s => {
        ul.innerHTML += `
            <li><a href="secciones.html#${window.anclaClase(s.curso_id, s.materia)}">
                ${escapeHTML(s.materia)} - ${escapeHTML(s.curso_nombre)} ${escapeHTML(s.seccion + (s.turno ? ' · ' + s.turno : ''))}
            </a></li>
        `;
    });
    if (secciones.length === 0) {
        ul.innerHTML = '<li><a href="#" style="color:var(--text-muted); font-style:italic;">Sin secciones</a></li>';
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

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}



// Suplencias: clases de otro profesor que la dirección le asignó cubrir
async function cargarSuplencias() {
    const bloque = document.getElementById('bloque-suplencias');
    const lista = document.getElementById('lista-suplencias');
    if (!bloque || !lista) return;
    try {
        const r = await fetch('/api/clases/mis-suplencias');
        const d = await r.json().catch(() => ({}));
        const datos = (r.ok && d.datos) || [];
        if (datos.length === 0) { bloque.hidden = true; return; }
        lista.innerHTML = datos.map(s => {
            const [a, m, dd] = s.fecha.split('-');
            const cuando = s.hoy ? 'Hoy' : `${dd}/${m}/${a}`;
            const enlace = `pasar_lista.html?curso_id=${encodeURIComponent(s.curso_id)}&materia=${encodeURIComponent(s.materia)}`;
            let accion;
            if (s.estado === 'con_lista') accion = `<span class="estado-sup"><i class='bx bx-check-circle'></i> Lista pasada</span>`;
            else if (s.estado === 'no_dada') accion = `<span class="estado-sup">Clase no dada</span>`;
            else if (s.hoy) accion = `<a class="btn btn-primary" href="${enlace}"><i class='bx bx-edit'></i> Pasar lista</a>`;
            else accion = `<span class="estado-sup">Programada</span>`;
            return `
                <div class="suplencia-item">
                    <div>
                        <div><span class="cuando">${cuando}</span>${s.inicio ? ` · ${escapeHTML(s.inicio)} - ${escapeHTML(s.fin)}` : ''} · <strong>${escapeHTML(s.materia)}</strong></div>
                        <div class="det">${escapeHTML(s.curso)}${s.turno ? ' · ' + escapeHTML(s.turno) : ''} · Titular: ${escapeHTML(s.titular || '')}</div>
                    </div>
                    ${accion}
                </div>`;
        }).join('');
        bloque.hidden = false;
    } catch (e) {
        console.error('Error al cargar suplencias:', e);
        bloque.hidden = true;
    }
}
