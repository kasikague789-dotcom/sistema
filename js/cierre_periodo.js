// Director > Cierre de periodo
(function () {
    let plan = null;
    const decisiones = {}; // estudianteId -> 'pasa' | 'repite' | 'egresa'
    const destinos = {};   // cursoId -> 'auto' | id de otra sección
    const $ = (id) => document.getElementById(id);
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
    const nombreSec = (c) => `${c.nombre} ${c.seccion}${c.turno ? ' · ' + c.turno : ''}`;
    const TODOS = { pasa: 'Todos pasan', repite: 'Todos repiten', egresa: 'Todos egresan' };

    function textoOpcion(s, op) {
        if (op === 'pasa') return s.destino ? `Pasa a ${s.destino.nombre}` : 'Pasa';
        if (op === 'egresa') return /6to a/i.test(s.curso.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '')) ? 'Egresa (técnico medio)' : `Egresa en ${s.curso.nombre}`;
        return 'Repite el año';
    }

    function resumen() {
        const t = { pasa: 0, repite: 0, egresa: 0, total: 0 };
        plan.secciones.forEach(s => s.estudiantes.forEach(e => { t[decisiones[e.id]]++; t.total++; }));
        const nuevas = plan.secciones.filter(s => s.destino && s.destino.nuevo && (destinos[s.curso.id] || 'auto') === 'auto'
            && s.estudiantes.some(e => decisiones[e.id] === 'pasa')).length;
        $('resumen-cierre').innerHTML = `
            <span><strong>${t.total}</strong> estudiantes</span>
            <span><strong>${t.pasa}</strong> pasan</span>
            <span><strong>${t.repite}</strong> repiten</span>
            <span><strong>${t.egresa}</strong> egresan</span>
            <span><strong>${nuevas}</strong> secciones nuevas</span>`;
    }

    function pintar() {
        $('p-actual').textContent = plan.periodo;
        $('p-siguiente').textContent = plan.periodo_siguiente;
        $('txt-btn-cierre').textContent = `Pasar al periodo ${plan.periodo_siguiente}`;
        $('aviso-clave').hidden = plan.clave_configurada;
        $('nota-clave').hidden = plan.clave_configurada;
        $('btn-cierre').disabled = plan.secciones.length === 0;
        const cont = $('lista-secciones');
        if (!plan.secciones.length) { cont.innerHTML = '<p>No hay estudiantes activos asignados a secciones.</p>'; resumen(); return; }
        cont.innerHTML = plan.secciones.map((s, si) => {
            const dest = s.destino
                ? `${esc(nombreSec(s.destino))}${s.destino.nuevo ? ' <span class="chip nuevo">se creará</span>' : ''}`
                : s.conocido ? '<span class="chip">egreso</span>' : '<span class="chip nuevo">elija destino</span>';
            const opcionesDestino = s.destino
                ? `<label class="destino-fila">Los que pasan van a:
                        <select data-destino="${s.curso.id}">
                            <option value="auto">${esc(nombreSec(s.destino))}${s.destino.nuevo ? ' (se creará)' : ''}</option>
                            ${plan.cursos.filter(c => c.id !== s.curso.id && (!s.destino.id || c.id !== s.destino.id)).map(c => `<option value="${c.id}">${esc(nombreSec(c))}</option>`).join('')}
                        </select></label>`
                : !s.conocido
                    ? `<label class="destino-fila">Los que pasan van a:
                        <select data-destino="${s.curso.id}">
                            <option value="">Elija la sección…</option>
                            ${plan.cursos.filter(c => c.id !== s.curso.id).map(c => `<option value="${c.id}" ${String(destinos[s.curso.id]) === String(c.id) ? 'selected' : ''}>${esc(nombreSec(c))}</option>`).join('')}
                        </select></label>`
                    : '';
            const filas = s.estudiantes.map((e, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>${esc(e.cedula)}</td>
                    <td>${esc(e.apellido)}, ${esc(e.nombre)}</td>
                    <td><select data-est="${e.id}" aria-label="Decisión para ${esc(e.nombre)} ${esc(e.apellido)}">
                        ${s.opciones.map(op => `<option value="${op}" ${decisiones[e.id] === op ? 'selected' : ''}>${esc(textoOpcion(s, op))}</option>`).join('')}
                    </select></td>
                </tr>`).join('');
            const masivo = s.opciones.map(op => `<button type="button" class="btn btn-secondary" data-todos="${si}" data-op="${op}">${esc(TODOS[op])}</button>`).join('');
            return `
                <details class="seccion-cierre" ${si === 0 ? 'open' : ''}>
                    <summary>${esc(nombreSec(s.curso))} <span class="flecha">→</span> ${dest} <span class="chip">${s.estudiantes.length} estudiante${s.estudiantes.length === 1 ? '' : 's'}</span></summary>
                    <div class="cuerpo">
                        ${opcionesDestino}
                        ${s.conocido ? '' : '<p class="aviso-cierre">El nombre de esta sección no está en la lista de grados (1er Grado a 6to Año). Elija a dónde pasan.</p>'}
                        <div style="overflow-x:auto;"><table class="tabla-cierre">
                            <thead><tr><th>N°</th><th>Cédula</th><th>Estudiante</th><th>Decisión</th></tr></thead>
                            <tbody>${filas}</tbody>
                        </table></div>
                        <div class="acciones-seccion">${masivo}</div>
                    </div>
                </details>`;
        }).join('');
        cont.querySelectorAll('select[data-est]').forEach(sel => { colorSelect(sel); sel.addEventListener('change', () => { decisiones[sel.dataset.est] = sel.value; colorSelect(sel); resumen(); }); });
        cont.querySelectorAll('select[data-destino]').forEach(sel => sel.addEventListener('change', () => { destinos[sel.dataset.destino] = sel.value; resumen(); }));
        cont.querySelectorAll('button[data-todos]').forEach(b => b.addEventListener('click', () => {
            const s = plan.secciones[b.dataset.todos];
            s.estudiantes.forEach(e => { decisiones[e.id] = b.dataset.op; });
            b.closest('.cuerpo').querySelectorAll('select[data-est]').forEach(sel => { sel.value = b.dataset.op; colorSelect(sel); });
            resumen();
        }));
        resumen();
    }

    function colorSelect(sel) { sel.className = sel.value === 'repite' ? 'repite' : sel.value === 'egresa' ? 'egresa' : ''; }

    async function cargar() {
        try {
            const r = await fetch('/api/promocion/vista-previa');
            const d = await r.json();
            if (!r.ok) throw new Error(d.mensaje);
            plan = d;
            plan.secciones.forEach(s => s.estudiantes.forEach(e => { if (!decisiones[e.id]) decisiones[e.id] = s.defecto; }));
            pintar();
        } catch (err) {
            $('lista-secciones').innerHTML = `<p>${esc(err.message || 'No se pudo cargar.')}</p>`;
        }
    }

    async function descargarActa(id) {
        const r = await fetch(`/api/promocion/acta/${id}`);
        if (!r.ok) { avisar('Intente de nuevo.', { tipo: 'error', titulo: 'No se pudo descargar el acta' }); return; }
        const blob = await r.blob();
        const nombre = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nombre ? nombre[1] : 'acta.pdf';
        document.body.appendChild(a); a.click(); a.remove();
    }
    window.descargarActa = descargarActa;

    async function historial() {
        try {
            const r = await fetch('/api/promocion/historial');
            const d = await r.json();
            const filas = d.datos || [];
            $('historial').innerHTML = filas.length ? `<div style="overflow-x:auto;"><table class="tabla-historial">
                <thead><tr><th>Periodo</th><th>Fecha</th><th>Director</th><th>Pasan</th><th>Repiten</th><th>Egresan</th><th></th></tr></thead>
                <tbody>${filas.map(f => `<tr><td>${esc(f.periodo)} → ${esc(f.periodo_siguiente)}</td><td>${esc(new Date(f.fecha).toLocaleString('es-VE'))}</td>
                    <td>${esc(f.director || '')}</td><td>${f.totales.pasa || 0}</td><td>${f.totales.repite || 0}</td><td>${f.totales.egresa || 0}</td>
                    <td><button type="button" class="btn btn-secondary" onclick="descargarActa(${f.id})"><i class='bx bxs-file-pdf'></i> Acta PDF</button></td></tr>`).join('')}</tbody>
            </table></div>` : '<p>Todavía no se ha cerrado ningún periodo.</p>';
        } catch {
            $('historial').innerHTML = '<p>No se pudo cargar el historial.</p>';
        }
    }

    // ---- Deshacer el último cierre ----
    let vistaDeshacer = null;
    async function cargarDeshacer() {
        const panel = $('panel-deshacer');
        try {
            const r = await fetch('/api/promocion/deshacer');
            const v = await r.json().catch(() => ({}));
            vistaDeshacer = r.ok && v.posible ? v : null;
        } catch { vistaDeshacer = null; }
        panel.hidden = !vistaDeshacer;
        if (!vistaDeshacer) return;
        const v = vistaDeshacer;
        $('d-desde').textContent = v.periodo_siguiente;
        $('d-hasta').textContent = v.periodo;
        const cuando = new Date(v.fecha).toLocaleString('es-VE').replace(/\.\s*$/, '');
        $('d-texto').textContent = `Último cierre: ${v.periodo} → ${v.periodo_siguiente}, el ${cuando}. Si se hizo por error, puede volver atrás:`;
        const items = [
            `${v.estudiantes} estudiante(s) vuelven a su sección de ${v.periodo}` + (v.egresaron ? ` y ${v.egresaron} egresado(s) vuelven a estar activos` : '') + '.',
            `El periodo vuelve a ${v.periodo} y los carnets QR de antes vuelven a servir (los nuevos se anulan).`
        ];
        if (v.horarios_archivados) items.push('Los horarios y asignaciones de profesores que se archivaron vuelven a estar activos.');
        if (v.secciones_nuevas) items.push('Las secciones que creó el cierre se borran si siguen vacías.');
        items.push(v.asistencias_desde
            ? `Desde ese cierre se guardaron ${v.asistencias_desde} marca(s) de asistencia: se conservan.`
            : 'La asistencia, las justificaciones y el calendario no se tocan.');
        (v.avisos || []).forEach(a => items.push(a));
        $('d-lista').innerHTML = items.map(t => `<li>${esc(t)}</li>`).join('');
        $('txt-btn-deshacer').textContent = `Deshacer y volver a ${v.periodo}`;
    }

    document.addEventListener('DOMContentLoaded', () => {
        cargar();
        historial();
        cargarDeshacer();
        $('form-deshacer').addEventListener('submit', async (e) => {
            e.preventDefault();
            const v = vistaDeshacer;
            if (!v) return;
            if (!$('d-password').value || !$('d-clave').value) {
                avisar('Escriba su contraseña de entrada y su clave de seguridad.', { tipo: 'aviso', titulo: 'Faltan datos' });
                ($('d-password').value ? $('d-clave') : $('d-password')).focus();
                return;
            }
            if ($('d-frase').value.trim().toUpperCase() !== 'DESHACER') {
                avisar('Escriba la palabra DESHACER en el último campo.', { tipo: 'aviso', titulo: 'Falta confirmar' });
                return;
            }
            const ok = await confirmar(`Los estudiantes vuelven a su sección de ${v.periodo} y el periodo vuelve a ${v.periodo}. El acta de ese cierre sale del historial.`,
                { titulo: `¿Deshacer el paso a ${v.periodo_siguiente}?`, aceptar: 'Sí, deshacer', peligro: true, icono: 'bx-undo' });
            if (!ok) return;
            const btn = $('btn-deshacer');
            btn.disabled = true;
            try {
                const r = await fetch('/api/promocion/deshacer', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: $('d-password').value, clave_seguridad: $('d-clave').value, confirmacion: $('d-frase').value, id: v.id })
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) { avisar(d.mensaje || 'Intente de nuevo.', { tipo: 'error', titulo: 'No se deshizo el cierre' }); return; }
                $('form-deshacer').reset();
                await avisar(d.mensaje + (d.hay_otro ? ' Hubo otro cierre antes de ese: si también quiere deshacerlo, use el mismo botón otra vez.' : ''),
                    { tipo: 'ok', titulo: 'Cierre deshecho' });
                Object.keys(decisiones).forEach(k => delete decisiones[k]);
                Object.keys(destinos).forEach(k => delete destinos[k]);
                cargar(); historial(); cargarDeshacer();
            } catch {
                avisar('Revise la conexión. Si se cortó, recargue la página para ver si el cambio se hizo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
            } finally {
                btn.disabled = false;
            }
        });
        $('form-cierre').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!plan) return;
            if (!plan.clave_configurada) {
                const ir = await confirmar('Para pasar de año se pide una clave de seguridad aparte, que solo usted sabe. Créela en Configuración (mínimo 8 caracteres, distinta a su contraseña) y vuelva aquí.',
                    { titulo: 'Falta crear la clave de seguridad', aceptar: 'Ir a Configuración', cancelar: 'Ahora no', icono: 'bx-lock-alt' });
                if (ir) window.location.href = 'configuracion.html#card-clave-seguridad';
                return;
            }
            if (!$('c-password').value || !$('c-clave').value) {
                avisar('Escriba su contraseña de entrada y su clave de seguridad.', { tipo: 'aviso', titulo: 'Faltan datos' });
                ($('c-password').value ? $('c-clave') : $('c-password')).focus();
                return;
            }
            if ($('c-frase').value.trim().toUpperCase() !== 'PROMOVER') {
                avisar('Escriba la palabra PROMOVER en el último campo.', { tipo: 'aviso', titulo: 'Falta confirmar' });
                return;
            }
            const t = { pasa: 0, repite: 0, egresa: 0 };
            Object.values(decisiones).forEach(v => { t[v]++; });
            const ok = await confirmar(`Pasan ${t.pasa}, repiten ${t.repite} y egresan ${t.egresa}. Los carnets QR actuales dejan de servir. Si se equivoca, después puede usar "Deshacer el último cierre".`,
                { titulo: `¿Pasar al periodo ${plan.periodo_siguiente}?`, aceptar: 'Sí, pasar de año', peligro: true, icono: 'bx-transfer' });
            if (!ok) return;
            const btn = $('btn-cierre');
            btn.disabled = true;
            try {
                const r = await fetch('/api/promocion/ejecutar', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        password: $('c-password').value, clave_seguridad: $('c-clave').value, confirmacion: $('c-frase').value,
                        decisiones, destinos, archivar_horarios: $('chk-archivar').checked
                    })
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) { avisar(d.mensaje || 'Intente de nuevo.', { tipo: 'error', titulo: 'No se pasó de año' }); return; }
                $('form-cierre').reset();
                await avisar(`${d.mensaje} El acta en PDF quedó guardada en "Actas anteriores".`, { tipo: 'ok', titulo: 'Periodo cerrado', boton: 'Descargar el acta' });
                descargarActa(d.id);
                Object.keys(decisiones).forEach(k => delete decisiones[k]);
                cargar(); historial(); cargarDeshacer();
            } catch {
                avisar('Revise la conexión. Si se cortó, recargue la página para ver si el cambio se hizo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
            } finally {
                btn.disabled = !plan || plan.secciones.length === 0;
            }
        });
    });
})();
