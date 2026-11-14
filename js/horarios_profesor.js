const PROFESOR_ACTUAL_ID = window.USUARIO.id; // usuario con sesión iniciada

document.addEventListener('DOMContentLoaded', async () => {
    actualizarReloj();
    setInterval(actualizarReloj, 60000);

    await cargarSubmenuSecciones();
    await cargarHorarioProfesor();
});

function actualizarReloj() {
    const ahora = new Date();
    const elClock = document.getElementById('live-clock');
    if (elClock) elClock.innerText = ahora.toLocaleString('es-ES', { 
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' 
    });
}

async function cargarSubmenuSecciones() {
    try {
        const response = await fetch(`/api/profesores/mis-secciones/${PROFESOR_ACTUAL_ID}`);
        const result = await response.json();
        const ul = document.getElementById('submenu-secciones');
        if(!ul) return;
        ul.innerHTML = '';
        (result.datos || []).forEach(s => {
            ul.innerHTML += `<li><a href="secciones.html#${window.anclaClase(s.curso_id, s.materia)}">${escapeHTML(s.materia)} - ${escapeHTML(s.curso_nombre)} ${escapeHTML(s.seccion + (s.turno ? ' · ' + s.turno : ''))}</a></li>`;
        });
    } catch (e) { console.error(e); }
}

async function cargarHorarioProfesor() {
    try {
        const response = await fetch(`/api/profesores/horario/${PROFESOR_ACTUAL_ID}`);
        const result = await response.json();
        
        const profesorNombre = document.getElementById('nombre-profesor');
        if(profesorNombre) profesorNombre.innerText = `Mi Horario Semanal`;

        if (!response.ok) throw new Error(result.mensaje || 'Error');
        const horarios = result.datos || [];
        
        document.getElementById('stat-total-clases').innerText = horarios.length;
        const diasUnicos = [...new Set(horarios.map(h => h.dia_semana))];
        document.getElementById('stat-dias-semana').innerText = diasUnicos.length;
        const seccionesUnicas = [...new Set(horarios.map(h => h.curso_nombre + h.seccion))];
        document.getElementById('stat-estudiantes-totales').innerText = seccionesUnicas.length;

        renderizarMatrizHorario(horarios);
    } catch (err) {
        console.error("Error al cargar horario:", err);
        document.getElementById('contenedor-tabla-horarios').innerHTML = `<p style="text-align:center; padding:30px; color:red;">Error al cargar el horario desde la base de datos.</p>`;
    }
}

function renderizarMatrizHorario(horarios) {
    const contenedor = document.getElementById('contenedor-tabla-horarios');
    if(!contenedor) return;

    if (horarios.length === 0) {
        contenedor.innerHTML = `
            <div class="no-horarios">
                <div class="icono"></div>
                <h3>No tienes clases asignadas</h3>
                <p>Actualmente no posees bloques de horarios registrados en el sistema.</p>
            </div>
        `;
        return;
    }

    const horasUnicas = [...new Set(horarios.map(h => `${h.hora_inicio} - ${h.hora_fin}`))].sort();
    const diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
    if (horarios.some(h => h.dia_semana === 'Sábado')) diasSemana.push('Sábado');

    const nombresDiasJS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const diaHoyStr = nombresDiasJS[new Date().getDay()];

    let html = `<table class="tabla-horario-profesor">
        <thead>
            <tr>
                <th>Hora</th>`;
    
    diasSemana.forEach(dia => {
        const esHoy = (dia === diaHoyStr);
        html += `<th class="${esHoy ? 'dia-actual' : ''}">${dia} ${esHoy ? '(Hoy)' : ''}</th>`;
    });

    html += `</tr></thead><tbody>`;

    horasUnicas.forEach(bloqueHora => {
        const [inicio, fin] = bloqueHora.split(' - ');
        html += `<tr><td style="font-weight:600; font-size:13px;">${inicio}<br><span style="font-size:11px; color:var(--text-secondary);">a</span><br>${fin}</td>`;

        diasSemana.forEach(dia => {
            // Puede haber más de una clase en el mismo bloque (choque): se muestran todas
            const clases = horarios.filter(h => h.dia_semana === dia && `${h.hora_inicio} - ${h.hora_fin}` === bloqueHora);
            const chocan = horarios.filter(h => h.dia_semana === dia && h.hora_inicio < fin && h.hora_fin > inicio).length > 1;

            if (clases.length > 0) {
                html += `<td>` + clases.map(clase => `
                    <div class="celda-horario" ${chocan ? 'style="border-left-color:#FF3B30;"' : ''}>
                        <div class="materia">${escapeHTML(clase.materia || 'Clase')}</div>
                        <div class="curso">${escapeHTML(clase.curso_nombre)} (${escapeHTML(clase.seccion + (clase.turno ? ' · ' + clase.turno : ''))})</div>
                        <div class="aula">Aula: ${escapeHTML(clase.aula || 'Principal')}</div>
                        ${chocan ? '<div style="color:#FF3B30; font-size:11px; font-weight:600;">Choque de horario: avise al director</div>' : ''}
                    </div>`).join('') + `</td>`;
            } else {
                html += `<td><span class="celda-vacia">- Libre -</span></td>`;
            }
        });

        html += `</tr>`;
    });

    html += `</tbody></table>`;
    contenedor.innerHTML = html;
}

function escapeHTML(str) { return (str !== null && str !== undefined) ? String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)) : ''; }
function toggleSubmenu(el) { const submenu = el.nextElementSibling; if (submenu) submenu.classList.toggle('open'); }
