const ESTUDIANTE_ACTUAL_ID = window.USUARIO.id; // usuario con sesión iniciada

async function cargarMiAsistencia() {
    try {
        console.log("Intentando conectar con la API de asistencia...");
        
        const response = await fetch(`/api/asistencia/estudiante/${ESTUDIANTE_ACTUAL_ID}`);
        
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status} - Verifica que la ruta exista en el backend`);
        }

        const data = await response.json();
        console.log("Datos recibidos del servidor:", data);
        
        if (data.error) throw new Error(data.error);

        document.getElementById('stat-presentes').innerText = data.stats.presentes;
        document.getElementById('stat-tardes').innerText = data.stats.tardes;
        document.getElementById('stat-ausentes').innerText = data.stats.ausentes;
        document.getElementById('stat-justificados').innerText = data.stats.justificados;

        const tbody = document.getElementById('tabla-body');
        if (!data.historial || data.historial.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);">
                        Aún no tienes registros de asistencia en el sistema.
                    </td>
                </tr>`;
            return;
        }

        let html = '';
        const textosEstado = { presente: 'Presente', ausente: 'Ausente', tarde: 'Tarde', justificada: 'Justificada', justificado: 'Justificado' };

        data.historial.forEach(reg => {
            const [fa, fm, fd] = String(reg.fecha).split('-').map(Number);
            const fechaObj = new Date(fa, fm - 1, fd);
            const fechaFormat = fechaObj.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
            
            const estado = (reg.estado || 'sin-marcar').toLowerCase();
            const badge = `<span class="badge-estado ${estado}">${textosEstado[estado] || estado.charAt(0).toUpperCase() + estado.slice(1)}</span>`;

            html += `
                <tr>
                    <td style="text-transform: capitalize;"><strong>${fechaFormat}</strong></td>
                    <td>${reg.materia ? escapeHTML(reg.materia) : '<em>General</em>'}</td>
                    <td>${reg.hora_entrada ? String(reg.hora_entrada).substring(0, 5) : '--:--'}</td>
                    <td>${badge}</td>
                    <td class="celda-texto" style="color:var(--text-secondary); font-size:13px;">${reg.observaciones ? escapeHTML(reg.observaciones) : '<em>Sin observaciones</em>'}</td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html;

    } catch (err) {
        console.error('Error cargando asistencia:', err);
        document.getElementById('tabla-body').innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center; color:#fc8181; padding:20px;">
                    Error de conexión: ${err.message}
                </td>
            </tr>`;
    }
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}


document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
    }
    cargarMiAsistencia();
});
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}
