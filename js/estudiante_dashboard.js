const API_ESTUDIANTE = '/api/estudiante/dashboard';

async function cargarDashboardEstudiante() {
    // Forzamos el ID 5 (Pedro Ramírez) si no hay sesión iniciada en localStorage
    const estudianteId = window.USUARIO.id;

    try {
        const response = await fetch(`${API_ESTUDIANTE}/${estudianteId}`);
        const data = await response.json();

        if (data.estado === 'exitoso') {
            const est = data.estudiante;
            const stats = data.stats;

            // Rellenar textos personales
            document.getElementById('saludo-estudiante').innerText = `Hola, ${est.nombre} ${est.apellido}`;
            document.getElementById('subtitulo-header').innerText = `Bienvenido, ${est.nombre} ${est.apellido}`;
            document.getElementById('detalles-estudiante').innerText = `Cédula: ${est.cedula} • Email: ${est.email}`;
            document.getElementById('badge-usuario').innerHTML = `<i class='bx bx-user-circle' style="font-size: 18px; color: var(--border-focus);"></i> ${est.nombre} ${est.apellido}`;
            document.getElementById('badge-curso').innerText = est.curso;

            // Asistencia de hoy
            const elEstadoHoy = document.getElementById('estado-asistencia-hoy');
            if (elEstadoHoy) {
                elEstadoHoy.className = `estado ${data.asistenciaHoy.estado}`;
                elEstadoHoy.innerText = data.asistenciaHoy.texto;
            }

            // Alerta de justificaciones
            const elAlertaJust = document.getElementById('alerta-justificaciones');
            if (elAlertaJust) {
                if (data.justificacionesPendientes > 0) {
                    elAlertaJust.innerText = `${data.justificacionesPendientes} justificación(es) pendiente(s)`;
                } else {
                    elAlertaJust.innerText = "";
                }
            }

            // Estadísticas (últimos 30 días, por clase)
            const totalClases = stats.presentes + stats.ausentes + stats.tardes + stats.justificados;
            const porcentaje = totalClases > 0 ? Math.round(((stats.presentes + stats.tardes + stats.justificados) / totalClases) * 100) : 0;
            const minimo = data.porcentajeMinimo || 85;

            const elPct = document.getElementById('stat-porcentaje');
            elPct.innerText = totalClases > 0 ? `${porcentaje}%` : '—';
            if (totalClases > 0 && porcentaje < minimo) {
                elPct.style.color = '#FF3B30';
                elPct.title = `Por debajo del mínimo (${minimo}%)`;
            }
            document.getElementById('stat-presentes').innerText = stats.presentes;
            document.getElementById('stat-ausentes').innerText = stats.ausentes;
            document.getElementById('stat-tardes').innerText = stats.tardes;
            document.getElementById('stat-justificados').innerText = stats.justificados;

            document.getElementById('texto-porcentaje-progreso').innerText = totalClases > 0
                ? `${porcentaje}%${porcentaje < minimo ? ` (mínimo ${minimo}%)` : ''}`
                : 'Sin clases registradas';
            const barra = document.getElementById('barra-fill');
            if (barra) barra.style.width = `${porcentaje}%`;

            // Próximos eventos
            const contEventos = document.getElementById('contenedor-proximos-eventos');
            if (contEventos) {
                if (!data.proximosEventos || data.proximosEventos.length === 0) {
                    contEventos.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">No hay eventos próximos</p>';
                } else {
                    let htmlEventos = '';
                    data.proximosEventos.forEach(e => {
                        htmlEventos += `
                            <div class="evento-mini" style="border-left-color: ${e.color || '#007AFF'};">
                                <div>
                                    <div class="titulo">${escapeHTML(e.titulo)}</div>
                                    <div class="fecha"><i class='bx bx-calendar'></i> ${e.fecha}</div>
                                </div>
                                <span style="font-size:11px; padding:3px 10px; border-radius:12px; background:var(--bg-input); color:var(--text-secondary); font-weight:600;">${escapeHTML(e.tipo)}</span>
                            </div>
                        `;
                    });
                    contEventos.innerHTML = htmlEventos;
                }
            }
        }
    } catch (error) {
        console.error('Error al cargar datos del estudiante:', error);
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}


document.addEventListener('DOMContentLoaded', cargarDashboardEstudiante);