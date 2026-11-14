// =====================================================================
// Ventanas de aviso del sistema (reemplazan alert / confirm / prompt del
// navegador, que muestran "localhost:3000 dice").
//
//   await avisar('Lista guardada.', { tipo: 'ok', titulo: 'Listo' });
//   if (await confirmar('Se borra del calendario.', { titulo: '¿Eliminar?', aceptar: 'Eliminar', peligro: true })) {...}
//   const valor = await elegirOpcion({ titulo, mensaje, opciones: [{ valor, texto }], actual });
//   const texto = await pedirTexto({ titulo, mensaje, etiqueta, max, oculto, numerico, minimo });
//
// Tipos: 'info' | 'ok' | 'error' | 'aviso'. Esc o "Cancelar" cierran. El foco queda
// dentro de la ventana y vuelve al botón que la abrió.
// =====================================================================
(function () {
    const ICONOS = { info: 'bx-info-circle', ok: 'bx-check-circle', error: 'bx-error-circle', aviso: 'bx-error', peligro: 'bx-trash' };
    const TITULOS = { info: 'Aviso', ok: 'Listo', error: 'No se pudo completar', aviso: 'Revise los datos' };

    let fondo = null;
    let cola = Promise.resolve();

    function crearFondo() {
        if (fondo) return fondo;
        fondo = document.createElement('div');
        fondo.className = 'dlg-fondo';
        fondo.hidden = true;
        fondo.innerHTML =
            '<div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dlg-titulo" aria-describedby="dlg-texto">' +
            '  <div class="dlg-cabeza"><span class="dlg-icono" aria-hidden="true"><i class="bx"></i></span>' +
            '  <h2 id="dlg-titulo" class="dlg-titulo"></h2></div>' +
            '  <p id="dlg-texto" class="dlg-texto"></p>' +
            '  <div class="dlg-extra"></div>' +
            '  <div class="dlg-botones"></div>' +
            '</div>';
        document.body.appendChild(fondo);
        return fondo;
    }

    function boton(texto, clase) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dlg-btn ' + clase;
        b.textContent = texto;
        return b;
    }

    // Abre una ventana y devuelve una promesa con lo que eligió la persona.
    // Las ventanas se muestran de a una (si llega otra, espera su turno).
    function abrir(cfg) {
        const turno = cola.then(() => new Promise((resolver) => {
            const f = crearFondo();
            const caja = f.querySelector('.dlg');
            const tipo = cfg.tipo || 'info';
            const antes = document.activeElement;

            caja.className = 'dlg dlg--' + tipo;
            f.querySelector('.dlg-icono i').className = 'bx ' + (cfg.icono || ICONOS[tipo] || ICONOS.info);
            f.querySelector('.dlg-titulo').textContent = cfg.titulo || TITULOS[tipo] || TITULOS.info;
            const texto = f.querySelector('.dlg-texto');
            texto.textContent = cfg.mensaje || '';
            texto.hidden = !cfg.mensaje;

            const zona = f.querySelector('.dlg-botones');
            zona.innerHTML = '';
            const bCancelar = cfg.cancelar ? boton(cfg.cancelar, 'dlg-btn--sec') : null;
            const bAceptar = boton(cfg.aceptar || 'Entendido', cfg.peligro ? 'dlg-btn--peligro' : 'dlg-btn--pri');
            if (bCancelar) zona.appendChild(bCancelar);
            zona.appendChild(bAceptar);

            const extra = f.querySelector('.dlg-extra');
            extra.innerHTML = '';
            extra.hidden = !cfg.armarExtra;
            // permitir(false) deja el botón principal apagado hasta que se elija algo
            const leerExtra = cfg.armarExtra ? cfg.armarExtra(extra, { permitir: (si) => { bAceptar.disabled = !si; }, aceptar: () => { if (!bAceptar.disabled) aceptar(); } }) : null;

            function cerrar(valor) {
                document.removeEventListener('keydown', teclas, true);
                f.classList.remove('dlg-visible');
                document.documentElement.classList.remove('dlg-abierto');
                setTimeout(() => {
                    f.hidden = true;
                    if (antes && typeof antes.focus === 'function' && document.contains(antes)) antes.focus();
                    resolver(valor);
                }, 120);
            }
            const cancelar = () => cerrar(cfg.valorCancelar !== undefined ? cfg.valorCancelar : false);
            const aceptar = () => cerrar(leerExtra ? leerExtra() : true);

            function teclas(e) {
                if (e.key === 'Escape') { e.preventDefault(); cancelar(); return; }
                if (e.key === 'Tab') {
                    const enfocables = [...caja.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
                    if (enfocables.length === 0) return;
                    const primero = enfocables[0], ultimo = enfocables[enfocables.length - 1];
                    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
                    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
                }
            }

            bAceptar.addEventListener('click', aceptar);
            if (bCancelar) bCancelar.addEventListener('click', cancelar);
            f.onclick = (e) => { if (e.target === f) cancelar(); };
            document.addEventListener('keydown', teclas, true);

            f.hidden = false;
            document.documentElement.classList.add('dlg-abierto');
            requestAnimationFrame(() => f.classList.add('dlg-visible'));
            // En acciones que borran, el foco empieza en "Cancelar" (más seguro)
            const inicial = cfg.armarExtra ? (extra.querySelector('[aria-checked="true"]') || extra.querySelector('button, input')) : null;
            (inicial || (cfg.peligro && bCancelar) || bAceptar).focus();
        }));
        cola = turno.catch(() => {});
        return turno;
    }

    function opciones(o) {
        if (typeof o === 'string') return { tipo: o };
        return o || {};
    }

    window.avisar = function (mensaje, o) {
        o = opciones(o);
        return abrir({ tipo: o.tipo || 'info', titulo: o.titulo, mensaje: String(mensaje == null ? '' : mensaje), aceptar: o.boton || 'Entendido', icono: o.icono })
            .then(() => undefined);
    };

    window.confirmar = function (mensaje, o) {
        o = opciones(o);
        return abrir({
            tipo: o.peligro ? 'peligro' : (o.tipo || 'info'),
            icono: o.icono || (o.peligro ? ICONOS.peligro : 'bx-help-circle'),
            titulo: o.titulo || '¿Desea continuar?',
            mensaje: String(mensaje == null ? '' : mensaje),
            aceptar: o.aceptar || 'Continuar',
            cancelar: o.cancelar || 'Cancelar',
            peligro: !!o.peligro
        });
    };

    // Elegir una opción de una lista corta (ej. estado de asistencia). Devuelve el valor o null.
    window.elegirOpcion = function (o) {
        o = o || {};
        const lista = o.opciones || [];
        let elegido = o.actual != null ? String(o.actual) : '';
        if (!lista.some(op => String(op.valor) === elegido)) elegido = '';
        return abrir({
            tipo: o.tipo || 'info',
            icono: o.icono || 'bx-edit',
            titulo: o.titulo || 'Elija una opción',
            mensaje: o.mensaje || '',
            aceptar: o.aceptar || 'Guardar',
            cancelar: o.cancelar || 'Cancelar',
            valorCancelar: null,
            armarExtra: (zona, api) => {
                const grupo = document.createElement('div');
                grupo.className = 'dlg-opciones' + (o.enLista ? ' dlg-opciones--lista' : '');
                grupo.setAttribute('role', 'radiogroup');
                grupo.setAttribute('aria-label', o.titulo || 'Opciones');
                const botones = lista.map((op) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'dlg-opcion' + (op.clase ? ' ' + op.clase : '');
                    b.setAttribute('role', 'radio');
                    b.dataset.valor = String(op.valor);
                    b.innerHTML = (op.icono ? '<i class="bx ' + op.icono + '" aria-hidden="true"></i>' : '') + '<span></span>';
                    b.querySelector('span').textContent = op.texto;
                    return b;
                });
                const marcar = () => {
                    botones.forEach((b) => {
                        const si = b.dataset.valor === elegido;
                        b.setAttribute('aria-checked', si ? 'true' : 'false');
                        b.tabIndex = si || (!elegido && b === botones[0]) ? 0 : -1;
                    });
                    api.permitir(!!elegido);
                };
                botones.forEach((b, i) => {
                    b.addEventListener('click', () => { elegido = b.dataset.valor; marcar(); });
                    b.addEventListener('keydown', (e) => {
                        const mover = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
                        if (!mover) return;
                        e.preventDefault();
                        const sig = botones[(i + mover + botones.length) % botones.length];
                        elegido = sig.dataset.valor; marcar(); sig.focus();
                    });
                    grupo.appendChild(b);
                });
                marcar();
                zona.appendChild(grupo);
                return () => elegido || null;
            }
        });
    };

    // Pedir un texto corto (ej. el motivo cuando se elige "Otro"). Devuelve el texto o null.
    window.pedirTexto = function (o) {
        o = o || {};
        return abrir({
            tipo: o.tipo || 'info',
            icono: o.icono || 'bx-edit',
            titulo: o.titulo || 'Escriba el dato',
            mensaje: o.mensaje || '',
            aceptar: o.aceptar || 'Guardar',
            cancelar: o.cancelar || 'Cancelar',
            valorCancelar: null,
            armarExtra: (zona, api) => {
                const campo = document.createElement('div');
                campo.className = 'dlg-campo';
                const id = 'dlg-entrada-' + Date.now();
                campo.innerHTML = '<label></label><input type="text" autocomplete="off">';
                const label = campo.querySelector('label');
                const input = campo.querySelector('input');
                label.textContent = o.etiqueta || 'Texto';
                label.htmlFor = id;
                input.id = id;
                input.maxLength = o.max || 200;
                if (o.oculto) { input.type = 'password'; input.autocomplete = o.autocompletar || 'off'; }
                if (o.numerico) { input.inputMode = 'numeric'; input.autocomplete = 'one-time-code'; }
                if (o.ejemplo) input.placeholder = o.ejemplo;
                input.value = o.valor || '';
                const revisar = () => api.permitir(input.value.trim().length >= (o.minimo || 1));
                input.addEventListener('input', revisar);
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); api.aceptar(); } });
                revisar();
                zona.appendChild(campo);
                return () => input.value.trim() || null;
            }
        });
    };

    // Respaldo: cualquier alert() que quede en el sistema también sale con este diseño
    window.alert = function (mensaje) {
        const t = String(mensaje == null ? '' : mensaje);
        const tipo = /error|no se pudo|incorrect|inválid|no puede|no permitid/i.test(t) ? 'error'
            : /correctamente|exitos|guardad|enviad|listo/i.test(t) ? 'ok' : 'info';
        window.avisar(t, { tipo });
    };
})();
