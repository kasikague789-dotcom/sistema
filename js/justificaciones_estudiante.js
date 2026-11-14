const ESTUDIANTE_ACTUAL_ID = window.USUARIO.id;

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
    }
    cargarMisJustificaciones();
    cargarMateriasEstudiante();

    const formSolicitud = document.getElementById('formSolicitudJustificacion');
    if (formSolicitud) {
        formSolicitud.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const fechaInicio = document.getElementById('fecha_inicio').value;
            const fechaFin = document.getElementById('fecha_fin').value;
            if (fechaFin < fechaInicio) {
                avisar('La fecha fin no puede ser antes de la fecha inicio.', { tipo: 'aviso', titulo: 'Revise las fechas' });
                return;
            }

            const nuevaJustificacion = {
                fecha_inicio: fechaInicio,
                fecha_fin: fechaFin,
                tipo_justificacion: document.getElementById('tipo').value,
                descripcion: document.getElementById('descripcion').value,
                materia: document.getElementById('materia_justificacion').value || null
            };

            const inputArchivo = document.getElementById('archivo');
            const archivo = inputArchivo && inputArchivo.files[0];
            if (archivo) {
                if (archivo.size > 5 * 1024 * 1024) {
                    avisar('La constancia no puede pasar de 5 MB. Use una foto más liviana o un PDF.', { tipo: 'aviso', titulo: 'Archivo muy grande' });
                    return;
                }
                nuevaJustificacion.archivo = {
                    nombre: archivo.name,
                    tipo: archivo.type,
                    base64: await leerComoBase64(archivo)
                };
            }

            try {
                const response = await fetch('/api/justificaciones/estudiante', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(nuevaJustificacion)
                });

                const resultado = await response.json();
                if (response.ok) {
                    cerrarModalSolicitar();
                    formSolicitud.reset();
                    cargarMisJustificaciones();
                    avisar(resultado.mensaje || 'La dirección revisará su solicitud.', { tipo: 'ok', titulo: 'Solicitud enviada' });
                } else {
                    avisar(resultado.mensaje || resultado.error || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo enviar la solicitud' });
                }
            } catch (err) {
                console.error('Error al enviar solicitud:', err);
                avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
            }
        });
    }
});

async function cargarMateriasEstudiante() {
    try {
        const response = await fetch(`/api/estudiante/horario/${ESTUDIANTE_ACTUAL_ID}`);
        const result = await response.json();
        const select = document.getElementById('materia_justificacion');
        if (!select || !result.datos) return;

        const materiasUnicas = [...new Set(result.datos.map(h => h.materia))];
        
        select.innerHTML = '<option value="">Todo el día (Falta general)</option>';
        materiasUnicas.forEach(m => {
            select.innerHTML += `<option value="${m}">${m}</option>`;
        });
    } catch (error) {
        console.error('Error al cargar materias:', error);
    }
}

async function cargarMisJustificaciones() {
    try {
        const response = await fetch(`/api/justificaciones/estudiante/${ESTUDIANTE_ACTUAL_ID}`);
        const data = await response.json();

        document.querySelector('.stat-just.total .numero').innerText = data.stats.total;
        document.querySelector('.stat-just.pendiente .numero').innerText = data.stats.pendientes;
        document.querySelector('.stat-just.aprobada .numero').innerText = data.stats.aprobadas;
        document.querySelector('.stat-just.rechazada .numero').innerText = data.stats.rechazadas;

        const contenedor = document.getElementById('contenedor-justificaciones');
        contenedor.innerHTML = ''; 

        if (data.datos.length === 0) {
            contenedor.innerHTML = `
                <div class="no-justificaciones" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class='bx bx-file-blank' style="font-size: 48px; opacity: 0.5; margin-bottom: 10px;"></i>
                    <h3>No tienes justificaciones registradas</h3>
                    <p>Haz clic en "Solicitar Justificación" para crear una nueva.</p>
                </div>
            `;
            return;
        }

        data.datos.forEach(j => {
            const fechaReg = new Date(j.fecha_registro).toLocaleDateString('es-ES');
            const aFecha = (t) => { const [a, m, d] = String(t).split('-').map(Number); return new Date(a, m - 1, d); };
            const fechaIni = aFecha(j.fecha_inicio).toLocaleDateString('es-ES');
            const fechaFin = aFecha(j.fecha_fin).toLocaleDateString('es-ES');

            const diffDays = Math.round((aFecha(j.fecha_fin) - aFecha(j.fecha_inicio)) / (1000 * 60 * 60 * 24)) + 1;

            const estadoClase = j.estado.toLowerCase();
            const textosEstado = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada', revision: 'En revisión' };

            let htmlObservaciones = '';
            if (j.observaciones_director) {
                htmlObservaciones = `
                    <div class="observaciones-director">
                        <div class="label" style="font-weight:700; font-size:12px; margin-bottom:4px;">Observaciones del Director</div>
                        <div class="texto" style="font-size:13px;">${escapeHTML(j.observaciones_director)}</div>
                    </div>
                `;
            }

            let htmlBotonRevocar = '';
            if (estadoClase === 'pendiente' || estadoClase === 'revision') {
                htmlBotonRevocar = `
                    <div style="margin-top: 15px; text-align: right;">
                        <button onclick="revocarJustificacion(${j.id})" class="btn-revocar">
                            <i class='bx bx-trash'></i> Revocar Solicitud
                        </button>
                    </div>
                `;
            }

            const badgeMateria = j.materia 
                ? `<span style="background:#e2e8f0; color:#4a5568; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; margin-left:8px;"><i class='bx bx-book'></i> ${escapeHTML(j.materia)}</span>`
                : `<span style="background:#c6f6d5; color:#22543d; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; margin-left:8px;"><i class='bx bx-time'></i> Todo el día</span>`;

            const card = document.createElement('div');
            card.className = `justificacion-card ${estadoClase}`;
            card.innerHTML = `
                <div class="header-card">
                    <div>
                        <strong style="color:var(--text-primary); font-size:16px;">
                            ${escapeHTML(j.tipo.charAt(0).toUpperCase() + j.tipo.slice(1))}
                        </strong>
                        <span style="font-size:13px; color:var(--text-muted);"> • Solicitud #${j.id}</span>
                        ${badgeMateria}
                    </div>
                    <div style="text-align:right;">
                        <span class="badge-estado ${estadoClase}">${textosEstado[estadoClase] || j.estado}</span>
                        <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${fechaReg}</div>
                    </div>
                </div>

                <div class="detalle-grid">
                    <div class="item">
                        <div class="label">Desde</div>
                        <div class="value">${fechaIni}</div>
                    </div>
                    <div class="item">
                        <div class="label">Hasta</div>
                        <div class="value">${fechaFin}</div>
                    </div>
                    <div class="item">
                        <div class="label">Días</div>
                        <div class="value">${diffDays}</div>
                    </div>
                </div>

                <div class="descripcion" style="font-size:14px; color:var(--text-primary); margin-bottom:10px;">
                    ${escapeHTML(j.descripcion)}
                </div>
                
                ${j.tiene_archivo ? `<div style="margin-bottom:10px;"><a href="#" onclick="abrirArchivoProtegido('/api/justificaciones/${j.id}/archivo'); return false;" style="font-size:13px; color:var(--border-focus); text-decoration:none; font-weight:600;"><i class='bx bx-paperclip'></i> Ver constancia adjunta</a></div>` : ''}

                ${htmlObservaciones}
                ${htmlBotonRevocar}
            `;

            contenedor.appendChild(card);
        });

    } catch (err) {
        console.error('Error al cargar justificaciones:', err);
    }
}

async function revocarJustificacion(id) {
    if (!(await confirmar('La solicitud se borrará y la dirección ya no la verá.', { titulo: '¿Revocar esta solicitud?', aceptar: 'Revocar solicitud', peligro: true }))) return;

    try {
        const response = await fetch(`/api/justificaciones/estudiante/${id}`, {
            method: 'DELETE'
        });
        const resultado = await response.json();

        if (response.ok) {
            avisar(resultado.mensaje || 'La solicitud se borró.', { tipo: 'ok', titulo: 'Solicitud revocada' });
            cargarMisJustificaciones();
        } else {
            avisar(resultado.mensaje || resultado.error || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo revocar' });
        }
    } catch (err) {
        console.error('Error al revocar:', err);
        avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
    }
}

function abrirModalSolicitar() {
    document.getElementById('modalSolicitar').classList.add('active');
}

function cerrarModalSolicitar() {
    document.getElementById('modalSolicitar').classList.remove('active');
}

function leerComoBase64(archivo) {
    return new Promise((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () => resolve(String(lector.result).split(',')[1] || '');
        lector.onerror = reject;
        lector.readAsDataURL(archivo);
    });
}

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}