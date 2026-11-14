const API_CONFIG = '/api/configuracion';
let listaGroserias = [];
let configSistema = {};

async function cargarConfiguracionDB() {
    try {
        const res = await fetch(API_CONFIG);
        const data = await res.json();
        
        if (data.estado === 'exitoso') {
            configSistema = data.configuracion || {};
            listaGroserias = data.groserias || [];
            
            // Rellenar formulario general
            if (document.getElementById('hora_entrada')) document.getElementById('hora_entrada').value = configSistema.hora_entrada || "08:00";
            if (document.getElementById('porcentaje_asistencia_minimo')) document.getElementById('porcentaje_asistencia_minimo').value = configSistema.porcentaje_asistencia_minimo || "85";
            if (document.getElementById('dias_maximos_justificar')) document.getElementById('dias_maximos_justificar').value = configSistema.dias_maximos_justificar || "3";
            if (document.getElementById('notificaciones_activas')) document.getElementById('notificaciones_activas').value = configSistema.notificaciones_activas || "true";
            if (document.getElementById('permitir_edicion_asistencia')) document.getElementById('permitir_edicion_asistencia').value = configSistema.permitir_edicion_asistencia || "true";
            if (document.getElementById('filtro_groserias_activo')) document.getElementById('filtro_groserias_activo').value = configSistema.filtro_groserias_activo || "true";
            if (document.getElementById('minutos_tolerancia')) document.getElementById('minutos_tolerancia').value = configSistema.minutos_tolerancia || "10";
            if (document.getElementById('hora_cambio_turno')) document.getElementById('hora_cambio_turno').value = configSistema.hora_cambio_turno || "12:30";
            mostrarEstadoClave(!!data.clave_seguridad_configurada);

            renderGroserias();
        }
    } catch (error) {
        console.error('Error al cargar configuración desde la BD:', error);
    }
}

async function guardarConfiguracionGeneral(e) {
    e.preventDefault();

    const nuevosDatos = {
        hora_entrada: document.getElementById('hora_entrada').value,
        porcentaje_asistencia_minimo: document.getElementById('porcentaje_asistencia_minimo').value,
        dias_maximos_justificar: document.getElementById('dias_maximos_justificar').value,
        notificaciones_activas: document.getElementById('notificaciones_activas').value,
        permitir_edicion_asistencia: document.getElementById('permitir_edicion_asistencia').value,
        filtro_groserias_activo: document.getElementById('filtro_groserias_activo').value,
        minutos_tolerancia: document.getElementById('minutos_tolerancia').value,
        hora_cambio_turno: (document.getElementById('hora_cambio_turno') || {}).value || '12:30'
    };

    try {
        const res = await fetch(API_CONFIG, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nuevosDatos)
        });
        const data = await res.json();

        if (data.estado === 'exitoso') {
            mostrarMensaje('Configuración guardada en la base de datos');
        } else {
            avisar(data.mensaje || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo guardar la configuración' });
        }
    } catch (error) {
        console.error('Error de conexión:', error);
    }
}

function renderGroserias() {
    const tbody = document.getElementById('tabla-groserias');
    if (!tbody) return;

    if (listaGroserias.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No hay groserías registradas</td></tr>';
        return;
    }

    let html = '';
    const etiquetasNivel = { leve: 'Leve', moderado: 'Moderado', grave: 'Grave', muy_grave: 'Muy Grave' };

    listaGroserias.forEach(g => {
        html += `
            <tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:10px;"><strong>${escapeHTML(g.palabra)}</strong></td>
                <td style="padding:10px;"><span class="nivel nivel-${g.nivel}">${etiquetasNivel[g.nivel] || g.nivel}</span></td>
                <td style="padding:10px;">${escapeHTML(g.reemplazo)}</td>
                <td style="padding:10px;">
                    <button onclick="eliminarGroseria(${g.id})" class="btn btn-sm btn-danger" style="padding:4px 8px; font-size:12px; background:#fc8181; color:white; border:none; border-radius:4px; cursor:pointer;" title="Eliminar" aria-label="Eliminar"><i class='bx bx-trash'></i></button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

async function agregarGroseria(e) {
    e.preventDefault();
    const palabra = document.getElementById('palabra').value.trim();
    const nivel = document.getElementById('nivel').value;
    const reemplazo = document.getElementById('reemplazo').value.trim() || "***";

    if (!palabra) return;

    try {
        const res = await fetch(`${API_CONFIG}/groserias`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ palabra, nivel, reemplazo })
        });
        const data = await res.json();

        if (data.estado === 'exitoso') {
            document.getElementById('formGroseria').reset();
            document.getElementById('reemplazo').value = "***";
            await cargarConfiguracionDB();
            mostrarMensaje('Grosería agregada a la base de datos');
        } else {
            avisar(data.mensaje || 'Intente de nuevo en un momento.', { tipo: 'aviso', titulo: 'No se agregó la palabra' });
        }
    } catch (error) {
        console.error('Error al agregar grosería:', error);
    }
}

async function eliminarGroseria(id) {
    if (await confirmar('Esta palabra dejará de bloquearse en el sistema.', { titulo: '¿Quitar esta palabra del filtro?', aceptar: 'Quitar palabra', peligro: true })) {
        try {
            const res = await fetch(`${API_CONFIG}/groserias/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.estado === 'exitoso') {
                await cargarConfiguracionDB();
                mostrarMensaje('Grosería eliminada');
            }
        } catch (error) {
            console.error('Error al eliminar grosería:', error);
        }
    }
}

function actualizarReloj() {
    const ahora = new Date();
    const dia = String(ahora.getDate()).padStart(2, '0');
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const anio = ahora.getFullYear();
    const horas = String(ahora.getHours()).padStart(2, '0');
    const minutos = String(ahora.getMinutes()).padStart(2, '0');
    const segundos = String(ahora.getSeconds()).padStart(2, '0');

    if (document.getElementById('live-clock')) document.getElementById('live-clock').innerText = `${dia}/${mes}/${anio} ${horas}:${minutos}`;
    if (document.getElementById('info-fecha-servidor')) document.getElementById('info-fecha-servidor').innerText = `${dia}/${mes}/${anio} ${horas}:${minutos}:${segundos}`;
}

function mostrarMensaje(msg) {
    const container = document.getElementById('alert-container');
    if (!container) return;
    container.innerHTML = `<div class="alert alert-success">${msg}</div>`;
    setTimeout(() => { container.innerHTML = ''; }, 3000);
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

document.addEventListener('DOMContentLoaded', function () {
    actualizarReloj();
    setInterval(actualizarReloj, 1000);

    cargarConfiguracionDB();

    const formConfig = document.getElementById('formConfiguracion');
    if (formConfig) formConfig.addEventListener('submit', guardarConfiguracionGeneral);

    const formGroseria = document.getElementById('formGroseria');
    if (formGroseria) formGroseria.addEventListener('submit', agregarGroseria);
});

// ---- Clave de seguridad del director ----
function mostrarEstadoClave(configurada) {
    const el = document.getElementById('estado-clave-seguridad');
    if (!el) return;
    el.textContent = configurada ? 'Estado: configurada.' : 'Estado: aún no configurada. Sin ella no se puede pasar de año.';
    el.style.color = configurada ? '#1e7b34' : '#a35f00';
    document.getElementById('grupo-cs-actual').style.display = configurada ? '' : 'none';
    document.getElementById('cs_actual').required = configurada;
    const olvido = document.getElementById('btn-olvido-clave');
    if (olvido) olvido.style.display = configurada ? '' : 'none';
}

// ¿Olvidó la clave de seguridad? Contraseña de entrada -> código al correo -> clave nueva
async function recuperarClaveSeguridad() {
    const pedir = async (url, metodo, cuerpo, tituloError) => {
        try {
            const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { await avisar(d.mensaje || 'Intente de nuevo.', { tipo: 'error', titulo: tituloError }); return null; }
            return d;
        } catch {
            await avisar('Revise la conexión e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
            return null;
        }
    };
    const password = await pedirTexto({
        titulo: 'Recuperar la clave de seguridad', icono: 'bx-envelope',
        mensaje: 'Le enviaremos un código a su correo. Primero escriba su contraseña de entrada (la de iniciar sesión).',
        etiqueta: 'Su contraseña de entrada', oculto: true, autocompletar: 'current-password', aceptar: 'Enviar código'
    });
    if (!password) return;
    const envio = await pedir('/api/configuracion/clave-seguridad/codigo', 'POST', { password }, 'No se envió el código');
    if (!envio) return;
    let guardado = false;
    while (!guardado) {
        const codigo = await pedirTexto({
            titulo: 'Escriba el código', icono: 'bx-envelope', mensaje: envio.mensaje,
            etiqueta: 'Código de 6 números', numerico: true, max: 6, minimo: 6, ejemplo: '123456', aceptar: 'Seguir'
        });
        if (!codigo) return;
        const nueva = await pedirTexto({
            titulo: 'Nueva clave de seguridad', icono: 'bx-lock-alt',
            mensaje: 'Mínimo 8 caracteres y distinta a su contraseña de entrada. Se pide para pasar de año y para deshacerlo.',
            etiqueta: 'Nueva clave de seguridad', oculto: true, autocompletar: 'new-password', minimo: 8, max: 100, aceptar: 'Seguir'
        });
        if (!nueva) return;
        const repetir = await pedirTexto({
            titulo: 'Repita la clave', icono: 'bx-lock-alt', etiqueta: 'Repita la nueva clave de seguridad',
            oculto: true, autocompletar: 'new-password', minimo: 8, max: 100, aceptar: 'Guardar clave'
        });
        if (!repetir) return;
        if (repetir !== nueva) { await avisar('Las dos claves no coinciden. Escríbalas otra vez.', { tipo: 'aviso', titulo: 'Revise la clave' }); continue; }
        const d = await pedir('/api/configuracion/clave-seguridad/recuperar', 'PUT', { codigo, nueva }, 'No se guardó la clave');
        if (!d) {
            const otra = await confirmar('¿Quiere escribir el código otra vez?', { titulo: 'Intentar de nuevo', aceptar: 'Sí', cancelar: 'No' });
            if (!otra) return;
            continue;
        }
        guardado = true;
        mostrarEstadoClave(true);
        avisar(d.mensaje, { tipo: 'ok', titulo: 'Clave de seguridad lista' });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('formClaveSeguridad');
    if (!form) return;
    const olvido = document.getElementById('btn-olvido-clave');
    if (olvido) olvido.addEventListener('click', recuperarClaveSeguridad);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nueva = document.getElementById('cs_nueva').value;
        if (nueva !== document.getElementById('cs_repetir').value) {
            avisar('Las dos claves nuevas no coinciden. Escríbalas otra vez.', { tipo: 'aviso', titulo: 'Revise la clave' });
            return;
        }
        try {
            const r = await fetch('/api/configuracion/clave-seguridad', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: document.getElementById('cs_password').value, actual: document.getElementById('cs_actual').value, nueva })
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { avisar(d.mensaje || 'Intente de nuevo.', { tipo: 'error', titulo: 'No se guardó la clave' }); return; }
            form.reset();
            mostrarEstadoClave(true);
            avisar(d.mensaje, { tipo: 'ok', titulo: 'Clave de seguridad lista' });
        } catch {
            avisar('Revise la conexión e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
        }
    });
});
