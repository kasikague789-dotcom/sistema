document.addEventListener('DOMContentLoaded', () => {
    const PANEL = {
        estudiante: 'interfaces/estudiante/index.html',
        profesor: 'interfaces/profesor/index.html',
        director: 'interfaces/director/index.html'
    };
    const loginForm = document.getElementById('loginForm');
    const inputUsuario = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    const togglePassword = document.getElementById('togglePassword');
    const recordar = document.getElementById('rememberMe');
    const caja = document.getElementById('mensaje-login');

    function mostrar(tipo, html) {
        caja.className = `mensaje visible ${tipo}`;
        caja.innerHTML = html;
    }
    function ocultar() {
        caja.className = 'mensaje';
        caja.innerHTML = '';
    }

    // Después de entrar: volver a la pantalla que se pidió (solo pantallas del sistema y del mismo rol)
    function destino(rol) {
        const volver = new URLSearchParams(window.location.search).get('volver') || '';
        const valido = /^\/interfaces\/(director|profesor|estudiante)\/[a-z_]+\.html(\?[\w=&%.+\-]*)?$/i.test(volver);
        return valido && volver.startsWith('/interfaces/' + rol + '/') ? volver : PANEL[rol];
    }

    // Si ya hay una sesión válida, ir directo al panel
    try {
        const guardado = JSON.parse(localStorage.getItem('usuario') || sessionStorage.getItem('usuario') || 'null');
        if (guardado && guardado.token && PANEL[guardado.rol]) {
            // CORRECCIÓN: Leemos la parte [0] (el cuerpo) y sin multiplicar por 1000
            const datos = JSON.parse(atob(guardado.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
            if (datos.exp > Date.now()) {
                window.location.replace(destino(guardado.rol));
                return;
            }
        }
    } catch (e) { /* sesión vieja o dañada: se ignora */ }

    const params = new URLSearchParams(window.location.search);
    if (params.get('registrado')) mostrar('ok', 'Cuenta creada. Ya puede iniciar sesión.');
    if (params.get('vencida')) mostrar('info', 'Su sesión venció. Inicie sesión de nuevo.');

    togglePassword.addEventListener('click', () => {
        const ver = passwordInput.type === 'password';
        passwordInput.type = ver ? 'text' : 'password';
        togglePassword.textContent = ver ? 'Ocultar' : 'Ver';
        togglePassword.setAttribute('aria-pressed', String(ver));
        togglePassword.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });

    // ---- ¿Olvidó su contraseña? ----
    const recForm = document.getElementById('recuperarForm');
    const recUsuario = document.getElementById('recUsuario');
    const pasoCodigo = document.getElementById('pasoCodigo');
    const btnRec = document.getElementById('btnRecuperar');
    const btnReenviar = document.getElementById('btnReenviar');
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
    let enPasoCodigo = false;

    function verRecuperar(si) {
        loginForm.hidden = si;
        recForm.hidden = !si;
        ocultar();
        if (si) {
            enPasoCodigo = false;
            pasoCodigo.hidden = true;
            btnReenviar.hidden = true;
            recUsuario.readOnly = false;
            btnRec.textContent = 'Enviar código';
            recUsuario.value = inputUsuario.value.trim();
            recUsuario.focus();
        } else {
            inputUsuario.focus();
        }
    }
    async function postJSON(url, cuerpo) {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
        return { ok: r.ok, d: await r.json().catch(() => ({})) };
    }
    async function pedirCodigo() {
        const usuario = recUsuario.value.trim();
        if (!usuario) { mostrar('error', 'Escriba su correo o su cédula.'); recUsuario.focus(); return; }
        btnRec.disabled = true;
        try {
            const { ok, d } = await postJSON('/api/auth/recuperar', { usuario });
            if (!ok) { mostrar('error', esc(d.mensaje || 'No se pudo enviar el código.')); return; }
            if (!d.enviado) { mostrar('info', esc(d.mensaje)); return; }
            enPasoCodigo = true;
            pasoCodigo.hidden = false;
            btnReenviar.hidden = false;
            recUsuario.readOnly = true;
            btnRec.textContent = 'Cambiar contraseña';
            mostrar('ok', esc(d.mensaje));
            document.getElementById('recCodigo').focus();
        } catch {
            mostrar('error', 'No se pudo conectar con el servidor.');
        } finally {
            btnRec.disabled = false;
        }
    }

    document.getElementById('btnOlvido').addEventListener('click', () => verRecuperar(true));
    document.getElementById('btnVolverLogin').addEventListener('click', () => verRecuperar(false));
    btnReenviar.addEventListener('click', pedirCodigo);
    recForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!enPasoCodigo) { pedirCodigo(); return; }
        const codigo = document.getElementById('recCodigo').value.replace(/\D/g, '');
        const nueva = document.getElementById('recNueva').value;
        const repetir = document.getElementById('recRepetir').value;
        if (codigo.length !== 6) { mostrar('error', 'El código tiene 6 números. Revise su correo.'); document.getElementById('recCodigo').focus(); return; }
        if (nueva.length < 6) { mostrar('error', 'La contraseña nueva debe tener al menos 6 caracteres.'); document.getElementById('recNueva').focus(); return; }
        if (nueva !== repetir) { mostrar('error', 'Las dos contraseñas no coinciden.'); document.getElementById('recRepetir').focus(); return; }
        btnRec.disabled = true;
        try {
            const { ok, d } = await postJSON('/api/auth/recuperar/cambiar', { usuario: recUsuario.value.trim(), codigo, nueva });
            if (!ok) { mostrar('error', esc(d.mensaje || 'No se pudo cambiar la contraseña.')); return; }
            const usuario = recUsuario.value.trim();
            recForm.reset();
            verRecuperar(false);
            inputUsuario.value = usuario;
            mostrar('ok', esc(d.mensaje));
            passwordInput.focus();
        } catch {
            mostrar('error', 'No se pudo conectar con el servidor.');
        } finally {
            btnRec.disabled = false;
        }
    });

    [inputUsuario, passwordInput].forEach(el => el.addEventListener('input', () => {
        if (caja.classList.contains('error')) ocultar();
    }));

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usuario = inputUsuario.value.trim();
        const password = passwordInput.value;

        if (!usuario || !password) {
            mostrar('error', 'Escriba su correo (o cédula) y su contraseña.');
            (usuario ? passwordInput : inputUsuario).focus();
            return;
        }

        const btnSubmit = loginForm.querySelector('button[type="submit"]');
        const textoOriginal = btnSubmit.textContent;
        btnSubmit.textContent = 'Ingresando...';
        btnSubmit.disabled = true;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario, password, recordar: recordar.checked })
            });
            const data = await response.json().catch(() => ({}));

            if (data.estado === 'exitoso' && PANEL[data.usuario.rol]) {
                const sesion = JSON.stringify(Object.assign({}, data.usuario, { token: data.token }));
                localStorage.removeItem('usuario');
                sessionStorage.removeItem('usuario');
                (recordar.checked ? localStorage : sessionStorage).setItem('usuario', sesion);
                window.location.replace(destino(data.usuario.rol));
                return;
            }

            if (data.sin_cuenta) {
                mostrar('error', `${data.mensaje} <a href="index2.html">Ir a registrarse</a>`);
            } else {
                mostrar('error', data.mensaje || 'No se pudo iniciar sesión.');
            }
            passwordInput.select();
        } catch (error) {
            console.error(error);
            mostrar('error', 'No hay conexión con el servidor. Revise que esté encendido.');
        } finally {
            btnSubmit.textContent = textoOriginal;
            btnSubmit.disabled = false;
        }
    });
});