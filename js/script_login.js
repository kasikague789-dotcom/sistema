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

    // Si ya hay una sesión válida, ir directo al panel
    try {
        const guardado = JSON.parse(localStorage.getItem('usuario') || sessionStorage.getItem('usuario') || 'null');
        if (guardado && guardado.token && PANEL[guardado.rol]) {
            // CORRECCIÓN: Leemos la parte [0] (el cuerpo) y sin multiplicar por 1000
            const datos = JSON.parse(atob(guardado.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
            if (datos.exp > Date.now()) {
                window.location.replace(PANEL[guardado.rol]);
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

    document.getElementById('btnOlvido').addEventListener('click', () => {
        mostrar('info', 'Pida al director o a Control de Estudios una <strong>clave temporal</strong>. ' +
            'Ellos la asignan en Usuarios &gt; Editar &gt; Restablecer contraseña. Luego cámbiela en "Mi Perfil".');
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
                window.location.replace(PANEL[data.usuario.rol]);
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