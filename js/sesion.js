// =====================================================================
// Sesión del usuario en el navegador. Se carga PRIMERO en cada pantalla
// de /interfaces/. Hace 4 cosas:
//  1. Si no hay sesión (o venció), manda al login.
//  2. Si el rol no corresponde a la carpeta (ej. estudiante en /director/), lo manda a su panel.
//  3. Agrega el token a todas las llamadas a /api/ (y quita "http://localhost:3000").
//  4. Define cerrarSesion() para todo el sistema.
// =====================================================================
(function () {
    const LOGIN = '/login.html';
    const PANEL = {
        director: '/interfaces/director/index.html',
        profesor: '/interfaces/profesor/index.html',
        estudiante: '/interfaces/estudiante/index.html'
    };

    function leerSesion() {
        try {
            const u = JSON.parse(localStorage.getItem('usuario') || sessionStorage.getItem('usuario') || 'null');
            if (!u || !u.token || !u.id || !u.rol) return null;
            
            // CORRECCIÓN: Tu compañero usa un token de 2 partes (cuerpo.firma). El cuerpo es [0].
            const cuerpo = u.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
            const datos = JSON.parse(atob(cuerpo));
            
            // Tu compañero ya guarda la expiración en milisegundos, no hay que multiplicar por 1000.
            if (!datos.exp || datos.exp < Date.now()) return null;
            
            return u;
        } catch (e) {
            return null;
        }
    }

    // vencida: muestra "Su sesión venció". volver: después de entrar, regresa a esta misma pantalla.
    function irAlLogin(vencida, volver) {
        const habia = localStorage.getItem('usuario') || sessionStorage.getItem('usuario');
        localStorage.removeItem('usuario');
        sessionStorage.removeItem('usuario');
        const q = new URLSearchParams();
        if (vencida && habia) q.set('vencida', '1');
        if (volver) q.set('volver', window.location.pathname + window.location.search);
        const texto = q.toString();
        window.location.replace(LOGIN + (texto ? '?' + texto : ''));
    }

    const VACIO = Object.freeze({ id: 0, rol: '', nombre: '', apellido: '', email: '' });
    window.cerrarSesion = () => irAlLogin(false, false);
    
    window.fechaLocalISO = function (d) {
        d = d || new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };

    const usuario = leerSesion();
    if (!usuario) {
        window.USUARIO = VACIO;
        irAlLogin(true, true);
        return;
    }

    const carpeta = (window.location.pathname.match(/\/interfaces\/(director|profesor|estudiante)\//) || [])[1];
    if (carpeta && carpeta !== usuario.rol) {
        window.USUARIO = VACIO;
        window.location.replace(PANEL[usuario.rol] || LOGIN);
        return;
    }

    window.USUARIO = Object.freeze({
        id: usuario.id,
        rol: usuario.rol,
        nombre: usuario.nombre || '',
        apellido: usuario.apellido || '',
        email: usuario.email || ''
    });

    const fetchOriginal = window.fetch.bind(window);
    window.fetch = function (entrada, opciones) {
        let url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
        url = url.replace(/^https?:\/\/localhost:3000/, '');
        const op = Object.assign({}, opciones || {});
        if (url.startsWith('/api/')) {
            const headers = new Headers(op.headers || {});
            headers.set('Authorization', 'Bearer ' + usuario.token);
            op.headers = headers;
        }
        return fetchOriginal(typeof entrada === 'string' ? url : entrada, op).then(function (resp) {
            if (resp.status === 401 && url.startsWith('/api/')) {
                irAlLogin(true);
            }
            return resp;
        });
    };

    window.abrirArchivoProtegido = async function (url) {
        const ventana = window.open('', '_blank');
        try {
            const r = await window.fetch(url);
            if (!r.ok) {
                const data = await r.json().catch(function () { return {}; });
                if (ventana) ventana.close();
                window.avisar(data.mensaje || 'Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo abrir el archivo' });
                return;
            }
            const blob = await r.blob();
            const enlace = URL.createObjectURL(blob);
            if (ventana) ventana.location.href = enlace; else window.location.href = enlace;
        } catch (e) {
            if (ventana) ventana.close();
            window.avisar('Revise que el servidor esté encendido e intente de nuevo.', { tipo: 'error', titulo: 'Sin conexión con el servidor' });
        }
    };

    // Año escolar en curso según el servidor (cambia con el cierre de periodo)
    let promesaAnio = null;
    window.anioEscolarActual = function () {
        if (!promesaAnio) {
            const respaldo = () => { const h = new Date(); return h.getMonth() >= 8 ? h.getFullYear() : h.getFullYear() - 1; };
            promesaAnio = window.fetch('/api/configuracion').then(r => r.json())
                .then(d => Number(d.anio_escolar_actual) || respaldo()).catch(respaldo);
        }
        return promesaAnio;
    };
    // Llena un <select> de años escolares: el siguiente, el actual y dos anteriores
    window.llenarSelectAnios = async function (select, valor) {
        if (!select) return;
        const a = await window.anioEscolarActual();
        const anios = [a + 1, a, a - 1, a - 2];
        if (valor && !anios.includes(Number(valor))) anios.push(Number(valor));
        select.innerHTML = anios.map(y => `<option value="${y}">${y} - ${y + 1}${y === a ? ' (actual)' : ''}</option>`).join('');
        select.value = String(valor || a);
    };

    window.cerrarSesion = async function () {
        const seguir = window.confirmar
            ? await window.confirmar('Para volver a entrar necesitará su correo o cédula y su contraseña.', { titulo: '¿Cerrar sesión?', aceptar: 'Cerrar sesión', peligro: true, icono: 'bx-log-out' })
            : window.confirm('¿Cerrar sesión?');
        if (!seguir) return;
        const modoOscuro = localStorage.getItem('darkMode');
        localStorage.clear();
        sessionStorage.clear();
        if (modoOscuro !== null) localStorage.setItem('darkMode', modoOscuro);
        window.location.replace(LOGIN);
    };

    // ---------------- Campana de notificaciones ----------------
    const esc = (t) => String(t === null || t === undefined ? '' : t).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

    function montarCampana() {
        const header = document.querySelector('main header, .content header, header');
        if (!header || document.getElementById('campana-notif')) return;

        const estilo = document.createElement('style');
        estilo.textContent = `
            #campana-notif { position: relative; display: none; }
            #campana-notif > button { position: relative; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--border-color, #e2e8f0);
                background: var(--bg-card, #fff); cursor: pointer; line-height: 0; color: var(--text-primary, #1a202c); display: inline-flex; align-items: center; justify-content: center; }
            #campana-notif > button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
            #campana-notif .contador { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px;
                background: #FF3B30; color: #fff; font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; }
            #campana-notif .lista { position: absolute; right: 0; top: 52px; width: min(340px, 86vw); max-height: 420px; overflow-y: auto; z-index: 1000;
                background: var(--bg-card, #fff); color: var(--text-primary, #1a202c); border: 1px solid var(--border-color, #e2e8f0);
                border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,.15); display: none; text-align: left; }
            #campana-notif .lista.abierta { display: block; }
            #campana-notif .titulo-lista { padding: 12px 14px; font-weight: 700; font-size: 14px; border-bottom: 1px solid var(--border-color, #e2e8f0); }
            #campana-notif .item { display: block; padding: 10px 14px; border-bottom: 1px solid var(--border-color, #edf2f7); text-decoration: none; color: inherit; font-size: 13px; }
            #campana-notif .item:hover { background: rgba(59,130,246,.06); }
            #campana-notif .item.nueva { border-left: 3px solid #3b82f6; }
            #campana-notif .item strong { display: block; margin-bottom: 2px; }
            #campana-notif .item small { color: var(--text-secondary, #718096); }
            #campana-notif .vacio { padding: 18px 14px; color: var(--text-secondary, #718096); font-size: 13px; }`;
        document.head.appendChild(estilo);

        const cont = document.createElement('div');
        cont.id = 'campana-notif';
        cont.innerHTML = `<button type="button" aria-label="Notificaciones" aria-expanded="false" aria-controls="lista-notif"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span class="contador" hidden></span></button>
            <div class="lista" id="lista-notif" role="region" aria-label="Notificaciones"></div>`;
        let destino = header.lastElementChild && header.lastElementChild !== header.firstElementChild ? header.lastElementChild : header;
        if (destino !== header && destino.id) {
            const envoltura = document.createElement('div');
            envoltura.style.cssText = 'display:flex; align-items:center; gap:12px; flex-wrap:wrap;';
            destino.parentNode.insertBefore(envoltura, destino);
            envoltura.appendChild(destino);
            destino = envoltura;
        }
        destino.appendChild(cont);

        const boton = cont.querySelector('button');
        const contador = cont.querySelector('.contador');
        const lista = cont.querySelector('.lista');

        async function cargar() {
            try {
                const r = await window.fetch('/api/notificaciones');
                if (!r.ok) return;
                const d = await r.json();
                cont.style.display = d.activas ? 'inline-block' : 'none';
                contador.hidden = !d.sin_leer;
                contador.textContent = d.sin_leer > 9 ? '9+' : d.sin_leer;
                boton.setAttribute('aria-label', d.sin_leer ? `Notificaciones: ${d.sin_leer} sin leer` : 'Notificaciones');
                lista.innerHTML = '<div class="titulo-lista">Notificaciones</div>' + (d.datos.length === 0
                    ? '<div class="vacio">No tiene notificaciones.</div>'
                    : d.datos.map(n => `<a class="item ${n.leida ? '' : 'nueva'}" href="${n.enlace ? esc(n.enlace) : '#'}">
                        <strong>${esc(n.titulo)}</strong>${esc(n.mensaje)}<br><small>${esc(n.fecha)}</small></a>`).join(''));
            } catch (e) { /* sin conexión: se intenta luego */ }
        }

        boton.addEventListener('click', async (e) => {
            e.stopPropagation();
            const abrir = !lista.classList.contains('abierta');
            lista.classList.toggle('abierta', abrir);
            boton.setAttribute('aria-expanded', String(abrir));
            if (abrir && !contador.hidden) {
                await window.fetch('/api/notificaciones/leidas', { method: 'PUT' });
                contador.hidden = true;
            }
        });
        document.addEventListener('click', (e) => {
            if (!cont.contains(e.target)) { lista.classList.remove('abierta'); boton.setAttribute('aria-expanded', 'false'); }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && lista.classList.contains('abierta')) { lista.classList.remove('abierta'); boton.setAttribute('aria-expanded', 'false'); boton.focus(); }
        });

        cargar();
        setInterval(cargar, 60000);
    }

    // ---------------- Menú en celular ----------------
    function montarMenuMovil() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar || document.getElementById('barra-movil')) return;
        if (!sidebar.id) sidebar.id = 'menu-lateral';

        const barra = document.createElement('div');
        barra.id = 'barra-movil';
        barra.className = 'barra-movil';
        barra.innerHTML = `<button type="button" class="btn-menu" aria-label="Abrir menú" aria-expanded="false" aria-controls="${sidebar.id}">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <img src="/css/escudo_elena.png" alt="" class="barra-escudo">
            <span class="barra-titulo">${esc(document.title.split(' - ')[0] || 'U.E. Instituto Elena de Bueno')}</span>`;
        document.body.insertBefore(barra, document.body.firstChild);

        const fondo = document.createElement('div');
        fondo.className = 'fondo-menu';
        document.body.appendChild(fondo);

        const boton = barra.querySelector('.btn-menu');
        const abrir = (si) => {
            document.body.classList.toggle('menu-abierto', si);
            boton.setAttribute('aria-expanded', String(si));
            boton.setAttribute('aria-label', si ? 'Cerrar menú' : 'Abrir menú');
            if (si) {
                const primero = sidebar.querySelector('a, button, [tabindex]');
                if (primero) primero.focus();
            } else {
                boton.focus();
            }
        };
        boton.addEventListener('click', () => abrir(!document.body.classList.contains('menu-abierto')));
        fondo.addEventListener('click', () => abrir(false));
        sidebar.addEventListener('click', (e) => { if (e.target.closest('a[href]:not([href="#"])')) document.body.classList.remove('menu-abierto'); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.body.classList.contains('menu-abierto')) abrir(false);
        });
    }

    // Ancla de cada clase en "Mis Secciones": sección + materia (un profesor puede dar 2 materias en la misma sección)
    window.anclaClase = function (cursoId, materia) {
        const m = String(materia || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return 'seccion-' + cursoId + (m ? '-' + m : '');
    };

    // ---------------- Menú lateral: se queda donde estaba ----------------
    // Al tocar una opción la página cambia; el menú vuelve a quedar en la misma
    // posición (no salta arriba) y los submenús que estaban abiertos siguen abiertos.
    function recordarMenu() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        const K_SCROLL = 'menu:scroll', K_SUB = 'menu:submenus';
        const leer = (k, d) => { try { const v = JSON.parse(sessionStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
        const guardar = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
        const aqui = (location.pathname.split('/').pop() || '') + location.search + location.hash;

        // Submenús abiertos (por ejemplo "Mis Secciones" del profesor)
        const abiertos = leer(K_SUB, {});
        const abrirSub = (t, sub) => { sub.classList.add('open'); const a = t.querySelector('.arrow'); if (a) a.classList.add('open'); };
        sidebar.querySelectorAll('.toggle-submenu').forEach((t, i) => {
            const sub = t.nextElementSibling;
            if (!sub) return;
            const clave = sub.id || ('submenu-' + i);
            if (abiertos[clave]) abrirSub(t, sub);
            t.addEventListener('click', () => setTimeout(() => {
                const m = leer(K_SUB, {}); m[clave] = sub.classList.contains('open'); guardar(K_SUB, m);
            }, 0));
        });

        // Marca la opción de la página actual dentro de los submenús
        const marcar = () => {
            sidebar.querySelectorAll('.submenu a[href]').forEach(a => {
                const h = a.getAttribute('href');
                const si = h !== '#' && (h === aqui || (h.startsWith('#') && h === location.hash));
                a.classList.toggle('active', si);
                if (si) { const sub = a.closest('.submenu'); if (sub && sub.previousElementSibling) abrirSub(sub.previousElementSibling, sub); }
            });
        };

        let tocado = false;
        ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(ev => sidebar.addEventListener(ev, () => { tocado = true; }, { passive: true }));
        const y = leer(K_SCROLL, null);
        const restaurar = () => {
            if (tocado) return;
            if (typeof y === 'number') sidebar.scrollTop = y;
            const act = sidebar.querySelector('.submenu a.active') || sidebar.querySelector('.menu a.active');
            if (act) {
                const r = act.getBoundingClientRect(), s = sidebar.getBoundingClientRect();
                if (r.top < s.top || r.bottom > s.bottom) act.scrollIntoView({ block: 'nearest' });
            }
        };
        marcar();
        restaurar();
        // Los submenús se llenan después (vienen del servidor): se vuelve a acomodar
        sidebar.querySelectorAll('.submenu').forEach(sub => new MutationObserver(() => { marcar(); restaurar(); }).observe(sub, { childList: true }));
        window.addEventListener('hashchange', marcar);

        const guardarPos = () => guardar(K_SCROLL, sidebar.scrollTop);
        sidebar.addEventListener('click', (e) => { if (e.target.closest('a[href]')) guardarPos(); }, true);
        window.addEventListener('pagehide', guardarPos);
    }

    // ---- Tablas en el celular: cada dato lleva su título ("Cédula", "Sección"...) ----
    // En el celular las tablas se ven como tarjetas; aquí se copia el título de cada columna
    // a sus celdas (data-label) para que el CSS lo muestre al lado del dato.
    const SIN_ETIQUETA = /^(#|acciones?|opciones)$/i;
    const EXCLUIDAS = '.tabla-lista, .tabla-reporte-mensual, .tabla-horario-profesor, #tablaHorario';
    function etiquetarTabla(tabla) {
        if (tabla.matches(EXCLUIDAS) || !tabla.tHead) return;
        const fila = tabla.tHead.rows[tabla.tHead.rows.length - 1];
        if (!fila) return;
        const titulos = [];
        for (const th of fila.cells) {
            const t = th.textContent.replace(/\s+/g, ' ').trim();
            for (let i = 0; i < (th.colSpan || 1); i++) titulos.push(t);
        }
        tabla.classList.add('con-etiquetas');
        for (const cuerpo of tabla.tBodies) {
            for (const tr of cuerpo.rows) {
                let col = 0;
                for (const td of tr.cells) {
                    const t = titulos[col] || '';
                    if (td.colSpan > 1 || !t || SIN_ETIQUETA.test(t)) td.removeAttribute('data-label');
                    else if (td.getAttribute('data-label') !== t) td.setAttribute('data-label', t);
                    col += td.colSpan || 1;
                }
            }
        }
    }
    function etiquetarTablas() {
        const contenido = document.querySelector('.content') || document.body;
        const todas = () => contenido.querySelectorAll('table').forEach(etiquetarTabla);
        todas();
        // Las filas llegan después (fetch): se vuelve a etiquetar cuando cambian
        let pendiente = false;
        new MutationObserver((cambios) => {
            if (pendiente) return;
            if (!cambios.some(c => c.type === 'childList' && [...c.addedNodes].some(n => n.nodeType === 1))) return;
            pendiente = true;
            requestAnimationFrame(() => { pendiente = false; todas(); });
        }).observe(contenido, { childList: true, subtree: true });
    }

    // Los mensajes de "guardado" flotan arriba de la ventana. El contenido tiene una animación
    // que impide que algo dentro quede fijo en pantalla, por eso la caja se pasa al <body>.
    function moverAvisos() {
        const caja = document.getElementById('alert-container');
        if (caja && caja.parentElement !== document.body) document.body.appendChild(caja);
    }

    function montarTodo() { montarMenuMovil(); montarCampana(); recordarMenu(); etiquetarTablas(); moverAvisos(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarTodo);
    else montarTodo();
})();