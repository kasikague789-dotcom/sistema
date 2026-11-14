const PROFESOR_ACTUAL_ID = window.USUARIO.id; // usuario con sesión iniciada
let cursoSeleccionadoId = null;
let materiaSeleccionada = '';
let fechaSeleccionada = '';
let listaBloqueada = false;
let fechaHoyServidor = '';
let totalEstudiantes = 0;

document.addEventListener('DOMContentLoaded', async () => {
    actualizarReloj();
    setInterval(actualizarReloj, 60000);

    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
    }

    // Cargamos primero el menú lateral y luego la lista
    await cargarSubmenuSecciones();
    await cargarListaEstudiantes();

    const inputFecha = document.getElementById('fecha-lista');
    if (inputFecha) {
        inputFecha.addEventListener('change', () => {
            const params = new URLSearchParams(window.location.search);
            params.set('fecha', inputFecha.value);
            window.location.search = params.toString();
        });
    }
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

let misClases = [];

async function cargarSubmenuSecciones() {
    try {
        const response = await fetch(`/api/profesores/mis-secciones/${PROFESOR_ACTUAL_ID}`);
        const result = await response.json();
        misClases = result.datos || [];
        const ul = document.getElementById('submenu-secciones');
        if (!ul) return;
        ul.innerHTML = '';

        // FORZAR QUE EL MENÚ SE ABRA AUTOMÁTICAMENTE EN ESTA PÁGINA
        ul.classList.add('open');
        const toggleDiv = ul.previousElementSibling;
        if (toggleDiv && toggleDiv.classList.contains('toggle-submenu')) {
            const arrow = toggleDiv.querySelector('.arrow');
            if (arrow) arrow.classList.add('open');
        }

        const urlParams = new URLSearchParams(window.location.search);
        const cursoActivoId = urlParams.get('curso_id');
        const materiaActiva = urlParams.get('materia') || '';

        misClases.forEach(s => {
            const isActive = String(cursoActivoId) === String(s.curso_id) && (!materiaActiva || materiaActiva === s.materia);
            const style = isActive
                ? 'background: rgba(10, 132, 255, 0.15); color: var(--border-focus); font-weight: 600; border-radius: 8px;'
                : '';

            ul.innerHTML += `
                <li style="margin-bottom: 4px;">
                    <a href="pasar_lista.html?curso_id=${s.curso_id}&materia=${encodeURIComponent(s.materia)}"
                       style="${style} display: block; padding: 8px 12px; text-decoration: none; color: var(--text-secondary); transition: all 0.2s;">
                        ${escapeHTML(s.materia)} - ${escapeHTML(s.curso_nombre)} ${escapeHTML(s.seccion + (s.turno ? ' · ' + s.turno : ''))}
                    </a>
                </li>
            `;
        });
    } catch (e) { console.error("Error al cargar submenú:", e); }
}

function mostrarAviso(texto) {
    const aviso = document.getElementById('aviso-lista');
    if (!aviso) return;
    aviso.style.display = texto ? 'block' : 'none';
    aviso.innerHTML = texto || '';
}

async function cargarListaEstudiantes() {
    const urlParams = new URLSearchParams(window.location.search);
    let cursoId = urlParams.get('curso_id');
    let materia = urlParams.get('materia') || '';
    const fecha = urlParams.get('fecha') || window.fechaLocalISO();

    try {
        // Si no hay clase en la URL, tomamos la primera del profesor
        if (!cursoId) {
            if (misClases.length === 0) {
                document.getElementById('titulo-curso').innerText = 'Sin secciones asignadas';
                document.getElementById('info-estudiantes-fecha').innerText = 'Pida al director que le asigne una sección.';
                return;
            }
            cursoId = misClases[0].curso_id;
            materia = misClases[0].materia;
        }

        cursoSeleccionadoId = parseInt(cursoId);

        const response = await fetch(`/api/profesores/pasar-lista/${cursoSeleccionadoId}?materia=${encodeURIComponent(materia)}&fecha=${fecha}`);
        const result = await response.json();
        if (!response.ok) {
            document.getElementById('titulo-curso').innerText = 'No se pudo abrir la lista';
            document.getElementById('info-estudiantes-fecha').innerText = result.mensaje || 'Error al cargar la lista.';
            return;
        }

        materiaSeleccionada = result.materia || materia;
        fechaSeleccionada = result.fecha;
        fechaHoyServidor = result.hoy;
        const listaEstudiantes = result.estudiantes || [];
        const nombreCurso = result.curso || "Sección";

        const [a, m, d] = fechaSeleccionada.split('-');
        document.getElementById('titulo-curso').innerHTML = `<i class='bx bx-book-content' style="color: var(--border-focus);"></i> ${escapeHTML(materiaSeleccionada)} - ${escapeHTML(nombreCurso)}`;
        document.getElementById('info-estudiantes-fecha').innerHTML = `<i class='bx bx-group'></i> ${listaEstudiantes.length} estudiantes • ${d}/${m}/${a}`
            + (result.clase
                ? ` • Clase: <strong>${escapeHTML(result.clase.inicio)} - ${escapeHTML(result.clase.fin)}</strong> (después de las <strong>${escapeHTML(result.clase.tarde_desde)}</strong>: Tarde)`
                : (result.hora_limite ? ` • <span title="Configurado por el director">Hora límite de entrada: <strong>${escapeHTML(result.hora_limite)}</strong> (quien llegue después: Tarde)</span>` : ''))
            + (result.suplencia
                ? ` • <span class="chip-suplencia"><i class='bx bx-transfer-alt'></i> Usted es suplente de ${escapeHTML(result.suplencia.titular || 'el titular')}</span>`
                : '');

        // Elegir otra fecha solo si el director lo permite (Configuración > Edición de asistencia)
        const selector = document.getElementById('selector-fecha');
        const inputFecha = document.getElementById('fecha-lista');
        if (selector && inputFecha && result.puede_editar_pasadas) {
            selector.style.display = 'block';
            inputFecha.value = fechaSeleccionada;
            inputFecha.max = result.hoy;
        }

        listaBloqueada = false;
        if (result.feriado) {
            listaBloqueada = true;
            mostrarAviso(`<strong>No hay clases ese día:</strong> ${escapeHTML(result.feriado)}. No se pasa lista.`);
        } else if (result.clase_no_dada) {
            listaBloqueada = true;
            mostrarAviso(`<strong>Clase no dada:</strong> ${escapeHTML(result.clase_no_dada)}`);
        } else if (result.turno_bloqueado) {
            listaBloqueada = true;
            mostrarAviso(`<strong>Fuera de turno:</strong> ${escapeHTML(result.turno_bloqueado)}`);
        } else if (fechaSeleccionada < result.hoy && !result.puede_editar_pasadas) {
            listaBloqueada = true;
            mostrarAviso('El director no permite editar asistencias de días pasados.');
        } else {
            mostrarAviso('');
        }

        // Con la lista bloqueada (feriado, clase no dada, fuera de turno, día pasado) los botones de marcar y guardar se ven apagados
        document.querySelectorAll('button[onclick^="marcarTodos"], #form-pasar-lista button[type="submit"]').forEach(btn => {
            btn.disabled = listaBloqueada;
            btn.style.opacity = listaBloqueada ? '0.45' : '';
            btn.style.cursor = listaBloqueada ? 'not-allowed' : '';
        });

        // Escanear carnets: se ve siempre que haya estudiantes; solo funciona en la lista de HOY sin bloqueo
        const btnEsc = document.getElementById('btn-escanear');
        motivoSinEscaneo = listaBloqueada
            ? (document.getElementById('aviso-lista').textContent.trim() || 'Esta lista está cerrada.')
            : (fechaSeleccionada !== result.hoy ? 'Solo se escanean carnets en la lista de hoy. Cambie la fecha a hoy.' : null);
        if (btnEsc) {
            btnEsc.style.display = listaEstudiantes.length > 0 ? 'flex' : 'none';
            btnEsc.style.opacity = motivoSinEscaneo ? '0.55' : '';
            btnEsc.title = motivoSinEscaneo || 'Marcar asistencia leyendo el QR del carnet';
        }
        if (motivoSinEscaneo) cerrarEscaneo();
        else if (!escaneoAutoAbierto && listaEstudiantes.length > 0 && new URLSearchParams(location.search).get('escanear') === '1') {
            escaneoAutoAbierto = true; // vino del botón "Escanear QR" del Inicio
            setTimeout(abrirEscaneo, 300);
        }
        totalEstudiantes = listaEstudiantes.length;

        const tbody = document.getElementById('tbody-estudiantes-lista');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (listaEstudiantes.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted, #a0aec0);">
                        <i class='bx bx-info-circle' style="font-size:24px; margin-bottom:10px; display:block;"></i>
                        No hay estudiantes asignados en esta sección
                    </td>
                </tr>
            `;
            return;
        }

        listaEstudiantes.forEach((est, index) => {
            // Sin marcar por defecto: el profesor debe marcar a cada uno (o usar "Todos Presentes")
            const estEstado = est.estado || '';

            const conHora = est.hora && (est.metodo === 'qr' || estEstado === 'presente' || estEstado === 'tarde');
            const marca = conHora ? `<small class="marca-hora" id="marca-${est.id}">${est.metodo === 'qr' ? '<span class="chip-qr">QR</span> ' : ''}${escapeHTML(est.hora)}</small>` : `<small class="marca-hora" id="marca-${est.id}"></small>`;
            tbody.innerHTML += `
                <tr data-fila="${est.id}">
                    <td>${index + 1}</td>
                    <td><strong>${escapeHTML(est.nombre + ' ' + est.apellido)}</strong></td>
                    <td>${escapeHTML(est.cedula)}</td>
                    <td>
                        <select data-usuario-id="${est.id}" class="select-estado" onchange="cambiarBordeSelect(this)" ${listaBloqueada ? 'disabled' : ''}>
                            <option value="" ${estEstado === '' ? 'selected' : ''}>-- Marcar --</option>
                            <option value="presente" ${estEstado === 'presente' ? 'selected' : ''}>Presente</option>
                            <option value="ausente" ${estEstado === 'ausente' ? 'selected' : ''}>Ausente</option>
                            <option value="tarde" ${estEstado === 'tarde' ? 'selected' : ''}>Tarde</option>
                            <option value="justificada" ${estEstado === 'justificada' ? 'selected' : ''}>Justificado</option>
                        </select>
                        ${marca}
                    </td>
                    <td>
                        <input type="text" data-obs-id="${est.id}" class="input-obs" placeholder="Observación..." maxlength="500" value="${escapeHTML(est.observaciones || '')}" ${listaBloqueada ? 'disabled' : ''}>
                    </td>
                </tr>
            `;
        });

        document.querySelectorAll('.select-estado').forEach(select => {
            cambiarBordeSelect(select);
            select.addEventListener('change', actualizarContador);
        });
        actualizarContador();

    } catch (err) {
        console.error("Error al cargar la lista de asistencia:", err);
        document.getElementById('titulo-curso').innerText = "Error al cargar";
        document.getElementById('info-estudiantes-fecha').innerText = "No se pudo conectar con el servidor.";
    }
}

function cambiarBordeSelect(select) {
    const val = select.value;
    if (val === 'presente') select.style.borderColor = '#48bb78';
    else if (val === 'ausente') select.style.borderColor = '#fc8181';
    else if (val === 'tarde') select.style.borderColor = '#ed8936';
    else if (val === 'justificada') select.style.borderColor = '#4299e1';
    else select.style.borderColor = '';
}

function marcarTodos(estado) {
    if (listaBloqueada) return;
    const selects = document.querySelectorAll('.select-estado');
    selects.forEach(select => {
        select.value = estado;
        cambiarBordeSelect(select);
    });
}

async function guardarLista(e) {
    e.preventDefault();
    if (!cursoSeleccionadoId || listaBloqueada) return;

    const filas = document.querySelectorAll('#tbody-estudiantes-lista tr');
    const asistenciaData = [];
    let sinMarcar = 0;

    filas.forEach(tr => {
        const select = tr.querySelector('.select-estado');
        const inputObs = tr.querySelector('.input-obs');
        if (select && inputObs) {
            if (!select.value) sinMarcar++;
            asistenciaData.push({
                usuario_id: select.getAttribute('data-usuario-id'),
                estado: select.value,
                observaciones: inputObs.value
            });
        }
    });

    if (asistenciaData.length === 0) return;
    if (sinMarcar > 0) {
        avisar(`Faltan ${sinMarcar} estudiante(s) por marcar. Márquelos y vuelva a guardar.`, { tipo: 'aviso', titulo: 'Lista incompleta' });
        return;
    }

    try {
        const response = await fetch('/api/profesores/guardar-asistencia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ curso_id: cursoSeleccionadoId, materia: materiaSeleccionada, fecha: fechaSeleccionada, asistencia: asistenciaData })
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
            await avisar(data.mensaje || 'Lista de asistencia guardada correctamente.', { tipo: 'ok', titulo: 'Lista guardada', boton: 'Volver a mis secciones' });
            window.location.href = "secciones.html";
        } else {
            avisar(data.mensaje || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo guardar la lista' });
        }
    } catch (err) {
        console.error("Error de red:", err);
        avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
    }
}

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}


// ===================== Escanear carnets (QR) =====================
let escaner = null;
let motivoSinEscaneo = null;
let escaneoAutoAbierto = false;
const RE_CARNET = /IEB-?[2-9A-HJ-NP-Z]{4}-?[2-9A-HJ-NP-Z]{4}-?[2-9A-HJ-NP-Z]{4}/i;

function actualizarContador() {
    const el = document.getElementById('esc-contador');
    if (!el) return;
    const marcados = [...document.querySelectorAll('.select-estado')].filter(s => s.value).length;
    el.innerHTML = `<strong>${marcados}</strong> de ${totalEstudiantes} marcados`;
}

function mostrarResultado(tipo, nombre, detalle, estudiante) {
    const caja = document.getElementById('esc-resultado');
    caja.className = 'esc-resultado ' + (tipo || '');
    document.getElementById('esc-nombre').textContent = nombre;
    document.getElementById('esc-detalle').textContent = detalle || '';
    const foto = document.getElementById('esc-foto');
    foto.innerHTML = `<i class='bx ${tipo === 'error' ? 'bx-error' : 'bx-id-card'}' aria-hidden="true"></i>`;
    if (estudiante && estudiante.tiene_foto) {
        fetch(`/api/carnets/foto/${estudiante.id}`).then(r => (r.ok ? r.blob() : null)).then(b => {
            if (!b) return;
            const img = document.createElement('img');
            img.alt = `Foto de ${nombre}`;
            img.src = URL.createObjectURL(b);
            foto.innerHTML = '';
            foto.appendChild(img);
        }).catch(() => {});
    }
}

async function abrirEscaneo() {
    if (motivoSinEscaneo) {
        avisar(motivoSinEscaneo, { tipo: 'aviso', titulo: 'No se puede escanear ahora' });
        return;
    }
    const panel = document.getElementById('panel-escaneo');
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const entrada = document.getElementById('esc-entrada');
    entrada.value = '';
    // En la PC el cursor queda listo para el lector USB. En el teléfono no: abriría el teclado encima de la cámara.
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) entrada.focus();
    actualizarContador();
    const estado = document.getElementById('esc-estado-camara');
    const motivo = EscanerQR.motivoNoDisponible();
    if (motivo) { modoFoto(true); estado.textContent = motivo; ofrecerHttps(); return; }
    modoFoto(false);
    try {
        if (!escaner) escaner = new EscanerQR(document.getElementById('esc-video'), (t) => procesarLectura(t, 'camara'));
        estado.textContent = 'Abriendo la cámara…';
        await escaner.iniciar();
        estado.textContent = 'Apunte al código QR del carnet.';
        document.getElementById('esc-cambiar').style.display = escaner.camaras.length > 1 ? '' : 'none';
        mostrarLinterna();
    } catch (err) {
        modoFoto(true);
        estado.textContent = err.message + ' Puede tomar una foto del carnet, usar el lector USB o escribir el código.';
    }
}

// Sin cámara en vivo (sin https o sin permiso): botón grande para tomar una foto del carnet
function modoFoto(si) {
    document.getElementById('esc-foto-grande').hidden = !si;
    document.getElementById('esc-marco').hidden = si;
    document.getElementById('esc-btn-foto').style.display = si ? 'none' : '';
    document.querySelector('.esc-camara').classList.toggle('modo-foto', si);
    const nombre = document.getElementById('esc-nombre');
    if (/^(Muestre|Tome)/.test(nombre.textContent)) {
        nombre.textContent = si ? 'Tome una foto del carnet' : 'Muestre el carnet a la cámara';
    }
}

// Prueba en la red local por http: si el servidor abrió también https (PROBAR_EN_MI_PC.bat),
// se ofrece el botón "Usar cámara en vivo", que abre esta misma lista por https.
let puertoHttps; // undefined = todavía no se preguntó
async function ofrecerHttps() {
    const enlace = document.getElementById('esc-ir-https');
    if (!enlace || window.isSecureContext) return;
    if (puertoHttps === undefined) {
        try {
            const r = await fetch('/api/https-local');
            puertoHttps = r.ok ? ((await r.json()).puerto || null) : null;
        } catch (e) { puertoHttps = null; }
    }
    if (!puertoHttps) return;
    const destino = new URL(window.location.href);
    destino.protocol = 'https:';
    destino.port = String(puertoHttps);
    destino.searchParams.set('escanear', '1');
    enlace.href = destino.toString();
    enlace.hidden = false;
    enlace.onclick = async (e) => {
        e.preventDefault();
        const seguir = await confirmar('Se abre esta lista en la dirección segura (https) de la misma computadora.\n\n' +
            'La primera vez el navegador dice "La conexión no es privada". Es normal: el certificado es de esta PC. ' +
            'Toque "Configuración avanzada" y luego "Acceder a ' + destino.hostname + ' (no seguro)".\n\n' +
            'Después entre con su usuario: vuelve aquí con la cámara en vivo.', { titulo: 'Cámara en vivo', aceptar: 'Abrir', cancelar: 'Ahora no', icono: 'bx-video' });
        if (seguir) window.location.href = enlace.href;
    };
}

function tomarFotoCarnet() {
    const input = document.getElementById('esc-archivo');
    input.value = '';
    input.click();
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('esc-archivo');
    if (!input) return;
    input.addEventListener('change', async () => {
        const archivo = input.files && input.files[0];
        if (!archivo) return;
        const caja = document.getElementById('esc-resultado');
        caja.classList.add('esc-leyendo');
        mostrarResultado('', 'Leyendo la foto…', 'Buscando el código QR del carnet.');
        try {
            const texto = await EscanerQR.leerImagen(archivo);
            if (!texto) {
                window.pitidoEscaner(false);
                mostrarResultado('error', 'No se encontró el QR en la foto', 'Tome otra foto más cerca, con buena luz y sin reflejo. El QR debe verse completo y nítido.');
            } else {
                procesarLectura(texto, 'camara');
            }
        } catch (err) {
            window.pitidoEscaner(false);
            mostrarResultado('error', 'No se pudo leer la foto', err.message || 'Intente otra vez.');
        } finally {
            caja.classList.remove('esc-leyendo');
            input.value = '';
        }
    });
});

function cerrarEscaneo() {
    if (escaner) escaner.detener();
    mostrarLinterna();
    document.getElementById('panel-escaneo').hidden = true;
}

async function cambiarCamara() {
    if (!escaner) return;
    try { await escaner.cambiarCamara(); } catch (err) { document.getElementById('esc-estado-camara').textContent = err.message; }
    mostrarLinterna();
}

// Linterna del teléfono (para salones oscuros), solo si la cámara la tiene
function mostrarLinterna() {
    const b = document.getElementById('esc-linterna');
    if (!b) return;
    const hay = !!(escaner && escaner.tieneLinterna && escaner.activo);
    b.style.display = hay ? '' : 'none';
    const prendida = hay && escaner.linterna;
    b.setAttribute('aria-pressed', prendida ? 'true' : 'false');
    b.querySelector('span').textContent = prendida ? 'Apagar linterna' : 'Prender linterna';
}

async function cambiarLinterna() {
    if (!escaner) return;
    await escaner.cambiarLinterna();
    mostrarLinterna();
}

document.addEventListener('visibilitychange', () => {
    const panel = document.getElementById('panel-escaneo');
    if (!escaner || !panel || panel.hidden) return;
    if (document.hidden) escaner.detener();
    else abrirEscaneo();
});

// Lector USB: escribe el texto del QR y presiona Enter (a veces una línea por vez).
// Solo se envía cuando la línea trae un código de carnet; las otras líneas se ignoran.
document.addEventListener('DOMContentLoaded', () => {
    const entrada = document.getElementById('esc-entrada');
    if (!entrada) return;
    entrada.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const texto = entrada.value;
        entrada.value = '';
        if (RE_CARNET.test(texto)) procesarLectura(texto, 'teclado');
        else if (texto.trim() && texto.trim().length <= 20) mostrarResultado('error', 'Código incompleto', 'Revise el código: debe verse como IEB-XXXX-XXXX-XXXX.');
    });
});

let enviando = Promise.resolve();
function procesarLectura(texto, origen) {
    // De a uno: si llegan dos lecturas seguidas, la segunda espera a la primera
    enviando = enviando.then(() => enviarLectura(texto, origen)).catch(() => {});
}

async function enviarLectura(texto, origen) {
    if (!RE_CARNET.test(texto)) {
        if (origen === 'camara') { window.pitidoEscaner(false); mostrarResultado('error', 'Este QR no es un carnet', 'Use el carnet del instituto.'); }
        return;
    }
    try {
        const r = await fetch('/api/profesores/escanear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ curso_id: cursoSeleccionadoId, materia: materiaSeleccionada, codigo: texto })
        });
        const d = await r.json().catch(() => ({}));
        const est = d.estudiante;
        const nombre = est ? `${est.nombre} ${est.apellido}` : 'Carnet no válido';
        if (r.ok && d.resultado === 'marcado') {
            window.pitidoEscaner(true);
            marcarFila(est.id, d.marca, d.hora);
            const detalle = `${d.marca === 'tarde' ? 'TARDE' : 'PRESENTE'} · ${d.hora} · C.I. ${est.cedula}` + (d.marca === 'tarde' ? ` · ${d.mensaje}` : '');
            mostrarResultado(d.marca === 'tarde' ? 'tarde' : 'ok', nombre, detalle, est);
            if (d.alerta) avisar(d.alerta, { tipo: 'aviso', titulo: 'Revise este carnet' });
        } else if (r.ok && d.resultado === 'ya_marcado') {
            window.pitidoEscaner(true);
            mostrarResultado('info', nombre, d.mensaje, est);
        } else {
            window.pitidoEscaner(false);
            mostrarResultado('error', nombre, d.mensaje || 'No se pudo marcar.', est);
        }
    } catch (err) {
        window.pitidoEscaner(false);
        mostrarResultado('error', 'Sin conexión', 'No se pudo enviar. Revise el internet y vuelva a escanear.');
    } finally {
        // Listo para el siguiente con el lector USB. Con la cámara del teléfono no: abriría el teclado.
        const entrada = document.getElementById('esc-entrada');
        const fino = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
        if (entrada && !document.getElementById('panel-escaneo').hidden && (origen !== 'camara' || fino)) entrada.focus({ preventScroll: true });
    }
}

function marcarFila(id, estado, hora) {
    const select = document.querySelector(`.select-estado[data-usuario-id="${id}"]`);
    if (select) { select.value = estado; cambiarBordeSelect(select); }
    const marca = document.getElementById(`marca-${id}`);
    if (marca) marca.innerHTML = `<span class="chip-qr">QR</span> ${escapeHTML(hora)}`;
    const fila = document.querySelector(`tr[data-fila="${id}"]`);
    if (fila) { fila.classList.remove('fila-escaneada'); void fila.offsetWidth; fila.classList.add('fila-escaneada'); }
    actualizarContador();
}

function faltantesAusentes() {
    if (listaBloqueada) return;
    let n = 0;
    document.querySelectorAll('.select-estado').forEach(s => {
        if (!s.value) { s.value = 'ausente'; cambiarBordeSelect(s); n++; }
    });
    actualizarContador();
    avisar(n ? `${n} estudiante(s) quedaron como Ausente. Revise la lista y presione "Guardar Lista".` : 'Todos ya estaban marcados.', { tipo: n ? 'info' : 'ok', titulo: n ? 'Faltantes marcados' : 'Lista completa' });
}

function exportarClase(formato) {
    if (!cursoSeleccionadoId) return;
    window.exportarListaDiaria({ fecha: fechaSeleccionada, curso_id: cursoSeleccionadoId, materia: materiaSeleccionada, formato });
}
