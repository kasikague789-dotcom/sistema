let datosCompletos = [];
let cursosList = [];

function getFechaHoyStr() {
    return window.fechaLocalISO(); // hoy (antes estaba fijo en 2026-08-31)
}

async function cargarDatosAsistencia(fecha = null) {
    const inputFecha = document.getElementById('fecha');
    if (!fecha) {
        fecha = (inputFecha && inputFecha.value) ? inputFecha.value : getFechaHoyStr();
    }
    
    if (inputFecha && !inputFecha.value) {
        inputFecha.value = fecha;
    }
    
    try {
        const response = await fetch(`/api/asistencia?fecha=${fecha}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.mensaje || 'Error al cargar');
        
        datosCompletos = data.estudiantes || [];
        cursosList = data.cursos || [];
        
        actualizarSelectCursos();
        renderAsistencia();
        cargarClasesDelDia();
    } catch (error) {
        console.error('Error al cargar datos de asistencia:', error);
    }
}

function actualizarSelectCursos() {
    const selectCurso = document.getElementById('curso');
    if (!selectCurso) return;
    const valorActual = selectCurso.value; 
    
    selectCurso.innerHTML = '<option value="">Todas las secciones</option>';
    cursosList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.innerText = `${c.nombre} - Sección ${c.seccion}${c.turno ? ' · ' + c.turno : ''}`;
        selectCurso.appendChild(opt);
    });
    
    selectCurso.value = valorActual; 
}

function renderAsistencia() {
    const cursoVal = document.getElementById('curso')?.value || '';
    const busquedaVal = document.getElementById('busqueda')?.value.toLowerCase().trim() || '';

    let filtrados = datosCompletos.filter(e => {
        if (cursoVal && e.curso_id != cursoVal) return false;
        if (busquedaVal) {
            const completo = `${e.nombre || ''} ${e.apellido || ''} ${e.cedula || ''}`.toLowerCase();
            if (!completo.includes(busquedaVal)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('tabla-body');
    if (!tbody) return;

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:35px; color:var(--text-muted);">No hay estudiantes que coincidan con el filtro.</td></tr>`;
    } else {
        let html = '';
        const textosEstado = { presente: 'Presente', ausente: 'Ausente', tarde: 'Tarde', justificada: 'Justificada', sin_marcar: 'Sin marcar' };

        filtrados.forEach((e, idx) => {
            const estado = e.estado;
            const horaText = e.hora_entrada ? String(e.hora_entrada).substring(0, 5) : '--:--';
            const materiaText = e.estado === 'sin_marcar' ? '<em style="color:var(--text-muted);">Ninguna clase registrada</em>' : (e.materia ? escapeHTML(e.materia) : '<em style="color:var(--text-muted);">General</em>');

            let badgeEstado = `<span class="badge-estado-asist ${estado}">${textosEstado[estado] || estado}</span>`;

            html += `
                <tr>
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHTML(e.nombre)} ${escapeHTML(e.apellido)}</strong></td>
                    <td>${escapeHTML(e.cedula)}</td>
                    <td>${e.curso ? `${escapeHTML(e.curso)} - ${escapeHTML(e.seccion + (e.turno ? ' · ' + e.turno : ''))}` : 'Sin sección'}</td>
                    <td>${materiaText}</td>
                    <td>${horaText}${e.metodo === 'qr' ? ' <span title="Carnet escaneado" style="display:inline-block;padding:1px 6px;border-radius:6px;background:rgba(10,132,255,0.12);color:#0a64c8;font-weight:700;font-size:11px;">QR</span>' : ''}</td>
                    <td>${badgeEstado}</td>
                    <td>
                        <button onclick="editarAsistencia(${e.id}, ${e.asistencia_id || 0}, '${escapeHTML(e.nombre)} ${escapeHTML(e.apellido)}', '${e.estado === 'sin_marcar' ? '' : e.estado}')" class="btn btn-sm btn-primary" title="Editar asistencia">${e.estado === 'sin_marcar' ? 'Marcar' : 'Editar'}</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    }
}

function limpiarFiltros() {
    const inputFecha = document.getElementById('fecha');
    if (inputFecha) inputFecha.value = getFechaHoyStr();
    const fechaClases = document.getElementById('fecha-clases');
    if (fechaClases) fechaClases.value = getFechaHoyStr();
    if (document.getElementById('curso')) document.getElementById('curso').value = '';
    if (document.getElementById('busqueda')) document.getElementById('busqueda').value = '';
    cargarDatosAsistencia(getFechaHoyStr()); 
}

async function editarAsistencia(estudianteId, asistenciaId, nombreEstudiante, estadoActual) {
    const nuevoEstado = await elegirOpcion({
        titulo: 'Corregir asistencia',
        mensaje: `${nombreEstudiante}: elija el estado correcto.`,
        actual: estadoActual,
        aceptar: 'Guardar cambio',
        opciones: [
            { valor: 'presente', texto: 'Presente', icono: 'bx-check-circle', clase: 'op-presente' },
            { valor: 'ausente', texto: 'Ausente', icono: 'bx-x-circle', clase: 'op-ausente' },
            { valor: 'tarde', texto: 'Tarde', icono: 'bx-time-five', clase: 'op-tarde' },
            { valor: 'justificada', texto: 'Justificada', icono: 'bx-file', clase: 'op-justificada' }
        ]
    });
    if (!nuevoEstado || nuevoEstado === estadoActual) return;
    const estadoLimpio = nuevoEstado;

    const fechaVal = document.getElementById('fecha').value || getFechaHoyStr();

    try {
        const response = await fetch(`/api/asistencia/${estudianteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fecha: fechaVal, estado: estadoLimpio, asistencia_id: asistenciaId || undefined })
        });

        const resultado = await response.json();
        if (resultado.estado === 'exitoso') {
            cargarDatosAsistencia(fechaVal); 
        } else {
            avisar(resultado.mensaje || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo corregir la asistencia' });
        }
    } catch (error) {
        console.error('Error en la petición de actualización:', error);
        avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

document.addEventListener('DOMContentLoaded', function() {
    const inputFecha = document.getElementById('fecha');
    if (inputFecha) {
        inputFecha.value = getFechaHoyStr();
        inputFecha.max = getFechaHoyStr(); // no se registra asistencia a futuro
    }
    
    cargarDatosAsistencia(getFechaHoyStr()); 

    // El panel "Clases del día" usa su propio día (puede ser uno que viene, para dejar el suplente listo)
    const fechaClasesInput = document.getElementById('fecha-clases');
    if (fechaClasesInput) {
        fechaClasesInput.value = getFechaHoyStr();
        fechaClasesInput.addEventListener('change', () => { if (fechaClasesInput.value) cargarClasesDelDia(); });
    }

    if (inputFecha) {
        inputFecha.addEventListener('change', function(e) {
            if (fechaClasesInput) fechaClasesInput.value = e.target.value;
            cargarDatosAsistencia(e.target.value);
        });
    }

    document.getElementById('curso')?.addEventListener('change', () => { renderAsistencia(); cargarClasesDelDia(); });
    document.getElementById('busqueda')?.addEventListener('input', renderAsistencia);
});

// Exportar la lista del día (sección elegida o todas) a PDF o Excel
function exportarDia(formato) {
    const fecha = document.getElementById('fecha').value || window.fechaLocalISO();
    const curso = document.getElementById('curso').value || '';
    window.exportarListaDiaria({ fecha, curso_id: curso, formato });
}


// =====================================================================
// Clases del día: ver qué clases tienen lista, marcar "clase no dada"
// (profesor ausente, etc.: los estudiantes no quedan con falta) y poner suplente.
// =====================================================================
const TEXTO_ESTADO_CLASE = {
    con_lista: 'Lista pasada', en_curso: 'En curso', por_empezar: 'Por empezar',
    programada: 'Programada', sin_lista: 'Sin lista', no_dada: 'No dada', feriado: 'Sin clases'
};
let clasesDia = { clases: [], hoy: '', fecha: '' };
let motivosNoDada = null;

function fechaPanelClases() {
    return document.getElementById('fecha-clases')?.value || document.getElementById('fecha')?.value || getFechaHoyStr();
}

async function cargarClasesDelDia() {
    const tbody = document.getElementById('tbody-clases');
    const resumen = document.getElementById('resumen-clases');
    if (!tbody) return;
    const fecha = fechaPanelClases();
    const curso = document.getElementById('curso')?.value || '';
    try {
        const r = await fetch(`/api/clases/del-dia?fecha=${encodeURIComponent(fecha)}${curso ? '&curso_id=' + encodeURIComponent(curso) : ''}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.mensaje || 'Error');
        clasesDia = d;
        renderClasesDelDia();
    } catch (err) {
        console.error('Error al cargar clases del día:', err);
        clasesDia = { clases: [], hoy: '', fecha };
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted);">No se pudieron leer las clases del día. Recargue la página.</td></tr>`;
        if (resumen) resumen.textContent = '';
    }
}

function renderClasesDelDia() {
    const tbody = document.getElementById('tbody-clases');
    const resumen = document.getElementById('resumen-clases');
    const clases = clasesDia.clases || [];
    const [a, m, d] = String(clasesDia.fecha || '').split('-');
    const fechaTxt = d ? `${d}/${m}/${a}` : '';

    if (resumen) {
        if (clasesDia.feriado) {
            resumen.textContent = `${fechaTxt}: no hay clases (${clasesDia.feriado}).`;
        } else if (clases.length === 0) {
            resumen.textContent = `${fechaTxt}: no hay clases en el horario.`;
        } else {
            const cuenta = (e) => clases.filter(c => c.estado === e).length;
            const partes = [`${clases.length} clase(s)`, `${cuenta('con_lista')} con lista`];
            const sinLista = cuenta('sin_lista');
            if (sinLista) partes.push(`${sinLista} sin lista`);
            const noDadas = cuenta('no_dada');
            if (noDadas) partes.push(`${noDadas} no dada(s)`);
            const conSup = clases.filter(c => c.suplente).length;
            if (conSup) partes.push(`${conSup} con suplente`);
            resumen.textContent = `${fechaTxt}: ` + partes.join(' · ');
        }
    }

    if (clases.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted);">${clasesDia.feriado ? 'Día sin clases.' : 'No hay clases en el horario de este día.'}</td></tr>`;
        return;
    }

    const futuroOHoy = clasesDia.fecha >= clasesDia.hoy;
    tbody.innerHTML = clases.map((c, i) => {
        let sub = '';
        if (c.estado === 'con_lista') sub = `<span class="clase-sub">${c.marcados} de ${c.estudiantes} marcados</span>`;
        if (c.no_dada) sub = `<span class="clase-sub">${escapeHTML(c.no_dada.motivo)} · sin falta</span>`;
        const profesor = escapeHTML(c.profesor)
            + (c.suplente ? `<span class="clase-sub"><i class='bx bx-transfer-alt'></i> Suplente: <strong>${escapeHTML(c.suplente.nombre)}</strong></span>` : '');

        let acciones = '';
        if (c.estado === 'no_dada') {
            acciones = `<button type="button" class="btn btn-sm btn-secondary" onclick="quitarNoDada(${i})">Quitar no dada</button>`;
        } else if (c.estado !== 'feriado' && c.estado !== 'con_lista') {
            if (futuroOHoy) {
                acciones += c.suplente
                    ? `<button type="button" class="btn btn-sm btn-primary" onclick="asignarSuplente(${i})">Cambiar suplente</button><button type="button" class="btn btn-sm btn-secondary" onclick="quitarSuplente(${i})">Quitar suplente</button>`
                    : `<button type="button" class="btn btn-sm btn-primary" onclick="asignarSuplente(${i})">Suplente</button>`;
            }
            acciones += `<button type="button" class="btn btn-sm btn-warning" onclick="marcarNoDada(${i})">No dada</button>`;
        }
        if (!acciones) acciones = '<span style="color:var(--text-muted);">—</span>';

        return `
            <tr>
                <td><strong>${escapeHTML(c.inicio)} - ${escapeHTML(c.fin)}</strong></td>
                <td>${escapeHTML(c.curso)}${c.turno ? ' · ' + escapeHTML(c.turno) : ''}</td>
                <td>${escapeHTML(c.materia)}</td>
                <td>${profesor}</td>
                <td><span class="chip-clase ${c.estado}">${TEXTO_ESTADO_CLASE[c.estado] || c.estado}</span>${sub}</td>
                <td>${acciones}</td>
            </tr>`;
    }).join('');
}

function nombreClase(c) {
    return `${c.materia} · ${c.curso}${c.turno ? ' · ' + c.turno : ''} (${c.inicio}-${c.fin})`;
}

async function enviarClase(url, metodo, cuerpo, tituloError) {
    try {
        const r = await fetch(url, {
            method: metodo,
            headers: { 'Content-Type': 'application/json' },
            body: cuerpo ? JSON.stringify(cuerpo) : undefined
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
            avisar(d.mensaje || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: tituloError });
            return false;
        }
        await avisar(d.mensaje || 'Listo.', { tipo: 'ok' });
        return true;
    } catch (err) {
        avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
        return false;
    }
}

async function recargarTodo() {
    // Si el panel muestra el mismo día que la tabla, se recargan las dos
    const fechaTabla = document.getElementById('fecha')?.value;
    if (fechaTabla && fechaTabla === fechaPanelClases()) await cargarDatosAsistencia(fechaTabla);
    else await cargarClasesDelDia();
}

async function marcarNoDada(i) {
    const c = clasesDia.clases[i];
    if (!c) return;
    if (!motivosNoDada) {
        try {
            const r = await fetch('/api/clases/motivos');
            const d = await r.json();
            motivosNoDada = d.datos || [];
        } catch (e) { motivosNoDada = []; }
    }
    if (motivosNoDada.length === 0) motivosNoDada = ['Profesor ausente', 'Otro'];
    let motivo = await elegirOpcion({
        titulo: 'Clase no dada',
        icono: 'bx-calendar-x',
        mensaje: `${nombreClase(c)}. Los ${c.estudiantes} estudiantes no quedan con falta y reciben un aviso. ¿Por qué no se dio?`,
        aceptar: 'Marcar como no dada',
        enLista: true,
        opciones: motivosNoDada.map(t => ({ valor: t, texto: t }))
    });
    if (!motivo) return;
    if (motivo === 'Otro') {
        motivo = await pedirTexto({
            titulo: 'Motivo de la clase no dada',
            mensaje: nombreClase(c),
            etiqueta: 'Escriba el motivo',
            ejemplo: 'Ej.: Salida pedagógica',
            max: 200,
            aceptar: 'Marcar como no dada'
        });
        if (!motivo) return;
    }
    const ok = await enviarClase('/api/clases/no-dada', 'POST',
        { curso_id: c.curso_id, materia: c.materia, fecha: clasesDia.fecha, motivo }, 'No se pudo marcar la clase');
    if (ok) recargarTodo();
}

async function quitarNoDada(i) {
    const c = clasesDia.clases[i];
    if (!c || !c.no_dada) return;
    const si = await confirmar(`${nombreClase(c)} vuelve a ser una clase normal y el profesor podrá pasar lista.`, {
        titulo: '¿Quitar "no dada"?', aceptar: 'Quitar marca'
    });
    if (!si) return;
    const ok = await enviarClase(`/api/clases/no-dada/${c.no_dada.id}`, 'DELETE', null, 'No se pudo quitar la marca');
    if (ok) recargarTodo();
}

async function asignarSuplente(i) {
    const c = clasesDia.clases[i];
    if (!c) return;
    let datos;
    try {
        const r = await fetch(`/api/clases/suplentes?curso_id=${c.curso_id}&materia=${encodeURIComponent(c.materia)}&fecha=${clasesDia.fecha}`);
        datos = await r.json().catch(() => ({}));
        if (!r.ok) { avisar(datos.mensaje || 'Intente de nuevo.', { tipo: 'error', titulo: 'No se pudo abrir la lista de profesores' }); return; }
    } catch (e) {
        avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
        return;
    }
    const libres = datos.datos || [];
    if (libres.length === 0) {
        avisar(datos.ocupados
            ? `Todos los demás profesores tienen clase a esa hora (${c.inicio}-${c.fin}). Puede marcar la clase como no dada.`
            : 'No hay otros profesores activos. Regístrelos en Usuarios.', { tipo: 'aviso', titulo: 'No hay profesor libre' });
        return;
    }
    const elegido = await elegirOpcion({
        titulo: c.suplente ? 'Cambiar suplente' : 'Elegir suplente',
        icono: 'bx-transfer-alt',
        mensaje: `${nombreClase(c)}. Titular: ${c.profesor}. Solo salen los profesores libres a esa hora.`,
        aceptar: 'Asignar suplente',
        enLista: true,
        actual: datos.actual,
        opciones: libres.map(p => ({ valor: p.id, texto: p.nombre, icono: 'bx-user' }))
    });
    if (!elegido) return;
    if (c.suplente && String(elegido) === String(c.suplente.profesor_id)) return;
    const ok = await enviarClase('/api/clases/suplente', 'POST',
        { curso_id: c.curso_id, materia: c.materia, fecha: clasesDia.fecha, profesor_id: Number(elegido) }, 'No se pudo asignar el suplente');
    if (ok) recargarTodo();
}

async function quitarSuplente(i) {
    const c = clasesDia.clases[i];
    if (!c || !c.suplente) return;
    const si = await confirmar(`${c.suplente.nombre} ya no cubre ${nombreClase(c)}.`, { titulo: '¿Quitar suplente?', aceptar: 'Quitar suplente' });
    if (!si) return;
    const ok = await enviarClase(`/api/clases/suplente/${c.suplente.id}`, 'DELETE', null, 'No se pudo quitar el suplente');
    if (ok) recargarTodo();
}
