let emailEnVerificacion = '';
let cedulaEnVerificacion = '';
let timeoutToast;
let timeoutModalToast;
let intervaloReenvio;

document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('registerForm');
    const inputs = Array.from(document.querySelectorAll('#modalVerificacion .inputs-codigo input'));

    inputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            // Primero filtramos solo números para evitar saltar de casilla con letras o espacios
            const limpio = e.target.value.replace(/[^0-9]/g, '');
            e.target.value = limpio ? limpio.slice(-1) : '';
            if (e.target.value.length === 1 && index < inputs.length - 1) {
                inputs[index + 1].focus();
                inputs[index + 1].select();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
                inputs[index - 1].focus();
                inputs[index - 1].value = '';
                e.preventDefault();
            } else if (e.key === 'ArrowLeft' && index > 0) {
                inputs[index - 1].focus();
                e.preventDefault();
            } else if (e.key === 'ArrowRight' && index < inputs.length - 1) {
                inputs[index + 1].focus();
                e.preventDefault();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                verificarCodigo();
            }
        });

        // Permitir pegar el código completo de 6 dígitos directamente (Ctrl+V o pegar en móvil)
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const textoPegado = (e.clipboardData || window.clipboardData).getData('text') || '';
            const digitos = textoPegado.replace(/[^0-9]/g, '').slice(0, inputs.length);
            if (!digitos) return;
            digitos.split('').forEach((d, i) => {
                if (inputs[i]) inputs[i].value = d;
            });
            const siguienteIndice = Math.min(digitos.length, inputs.length - 1);
            inputs[siguienteIndice].focus();
        });
    });

    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const nombre = document.getElementById('firstName').value.trim();
            const apellido = document.getElementById('lastName').value.trim();
            const email = document.getElementById('email').value.trim().toLowerCase();
            const cedulaCruda = document.getElementById('idNumber').value.trim();
            const cedula = cedulaCruda.replace(/[^0-9]/g, '');
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const btnSubmit = registerForm.querySelector('button[type="submit"]');

            if (!/^\d{5,10}$/.test(cedula)) {
                mostrarAlerta('La cédula debe contener entre 5 y 10 números (ej. 30123456).', 'error');
                return;
            }

            if (password.length < 6) {
                mostrarAlerta('La contraseña debe tener al menos 6 caracteres.', 'error');
                return;
            }

            if (password !== confirmPassword) {
                mostrarAlerta('Las contraseñas no coinciden. Por favor, verifíquelas.', 'error');
                return;
            }

            const textoOriginal = btnSubmit.textContent;
            btnSubmit.textContent = 'Enviando código...';
            btnSubmit.disabled = true;

            try {
                const response = await fetch('/api/auth/registro', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, apellido, cedula, email, password })
                });

                const data = await response.json().catch(() => ({}));

                if (response.ok && data.estado === 'exitoso') {
                    emailEnVerificacion = data.email || email;
                    cedulaEnVerificacion = data.cedula || cedula;
                    document.getElementById('textoCorreo').innerHTML =
                        `Enviamos un código de 6 dígitos a <strong>${escaparHTML(emailEnVerificacion)}</strong>. Tu cuenta solo se registrará al confirmar este código.`;
                    ocultarAlertaModal();
                    document.getElementById('modalVerificacion').classList.add('active');
                    inputs.forEach(i => { i.value = ''; });
                    iniciarCooldownReenvio(30);
                    setTimeout(() => document.getElementById('c1').focus(), 50);
                } else {
                    let mensajeParaMostrar = data.mensaje || 'No se pudo iniciar el registro.';
                    if (mensajeParaMostrar.toLowerCase().includes('no está registrado') || mensajeParaMostrar.toLowerCase().includes('no esta registrado')) {
                        mensajeParaMostrar = 'Su cédula no aparece en nuestro sistema. Por favor, comuníquese con Control de Estudios para pre-registrar sus datos.';
                    }
                    mostrarAlerta(mensajeParaMostrar, 'error');
                }
            } catch (error) {
                console.error(error);
                mostrarAlerta('Error de conexión con el servidor. Intente más tarde.', 'error');
            } finally {
                btnSubmit.textContent = textoOriginal;
                btnSubmit.disabled = false;
            }
        });
    }
});

function escaparHTML(str) {
    return String(str || '').replace(/[&<>'"]/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[c]));
}

function iniciarCooldownReenvio(segundos = 45) {
    const btn = document.getElementById('btnReenviarCodigo');
    if (!btn) return;
    if (intervaloReenvio) clearInterval(intervaloReenvio);

    let restante = segundos;
    btn.disabled = true;
    btn.textContent = `Reenviar código (${restante}s)`;

    intervaloReenvio = setInterval(() => {
        restante--;
        if (restante <= 0) {
            clearInterval(intervaloReenvio);
            btn.disabled = false;
            btn.textContent = 'Reenviar código';
        } else {
            btn.disabled = true;
            btn.textContent = `Reenviar código (${restante}s)`;
        }
    }, 1000);
}

// Cerrar el modal; si cancelarEnServidor = true, limpia el registro pendiente en el backend
async function cerrarModalVerificacion(cancelarEnServidor = false) {
    document.getElementById('modalVerificacion').classList.remove('active');
    ocultarAlertaModal();
    if (intervaloReenvio) clearInterval(intervaloReenvio);

    if (cancelarEnServidor && (emailEnVerificacion || cedulaEnVerificacion)) {
        const emailTmp = emailEnVerificacion;
        const cedulaTmp = cedulaEnVerificacion;
        emailEnVerificacion = '';
        cedulaEnVerificacion = '';
        try {
            await fetch('/api/auth/cancelar-registro', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: emailTmp, cedula: cedulaTmp })
            });
        } catch (e) {
            console.error('Error cancelando registro pendiente:', e);
        }
        mostrarAlerta('Registro cancelado. Tu cuenta no fue activada.', 'info');
    }
}

function ocultarAlertaModal() {
    const box = document.getElementById('mensajeModalVerif');
    if (!box) return;
    box.className = 'toast-mensaje';
    box.style.display = 'none';
    box.textContent = '';
}

function mostrarAlertaModal(mensaje, tipo = 'info') {
    const box = document.getElementById('mensajeModalVerif');
    if (!box) return mostrarAlerta(mensaje, tipo);

    box.className = 'toast-mensaje ' + tipo;
    box.textContent = mensaje;
    box.style.display = 'block';
    setTimeout(() => box.classList.add('mostrar'), 10);

    if (timeoutModalToast) clearTimeout(timeoutModalToast);
    timeoutModalToast = setTimeout(() => {
        box.classList.remove('mostrar');
        setTimeout(() => { box.style.display = 'none'; }, 300);
    }, 5000);
}

function mostrarAlerta(mensaje, tipo = 'info', callback = null) {
    const toast = document.getElementById('toastMensaje');
    if (!toast) return;

    toast.className = 'toast-mensaje ' + tipo;
    toast.textContent = mensaje;
    toast.style.display = 'block';

    setTimeout(() => {
        toast.classList.add('mostrar');
    }, 10);

    if (timeoutToast) clearTimeout(timeoutToast);

    timeoutToast = setTimeout(() => {
        toast.classList.remove('mostrar');
        setTimeout(() => {
            toast.style.display = 'none';
        }, 400);
    }, 5000);

    if (callback) {
        setTimeout(callback, 1500);
    }
}

async function verificarCodigo() {
    const inputs = document.querySelectorAll('#modalVerificacion .inputs-codigo input');
    let codigo = '';
    inputs.forEach(i => { codigo += i.value.trim(); });

    if (codigo.length !== 6) {
        mostrarAlertaModal('Por favor, ingrese los 6 dígitos del código enviado a su correo.', 'error');
        return;
    }

    const btn = document.getElementById('btnVerificar');
    btn.textContent = 'Verificando...';
    btn.disabled = true;

    try {
        const response = await fetch('/api/auth/verificar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: emailEnVerificacion,
                cedula: cedulaEnVerificacion,
                codigo
            })
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.estado === 'exitoso') {
            emailEnVerificacion = '';
            cedulaEnVerificacion = '';
            cerrarModalVerificacion(false);
            mostrarAlerta('¡Correo verificado y cuenta activada con éxito! Redirigiendo al inicio de sesión...', 'success', () => {
                window.location.href = 'login.html?registrado=1';
            });
        } else {
            mostrarAlertaModal(data.mensaje || 'Código incorrecto o expirado.', 'error');
        }
    } catch (error) {
        console.error(error);
        mostrarAlertaModal('Error de conexión al verificar el código. Intente de nuevo.', 'error');
    } finally {
        btn.textContent = 'Verificar y Activar Cuenta';
        btn.disabled = false;
    }
}

async function reenviarCodigo() {
    if (!emailEnVerificacion && !cedulaEnVerificacion) return;
    const btn = document.getElementById('btnReenviarCodigo');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Enviando...';
    }

    try {
        const response = await fetch('/api/auth/reenviar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: emailEnVerificacion,
                cedula: cedulaEnVerificacion
            })
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.estado === 'exitoso') {
            mostrarAlertaModal(data.mensaje || 'Te enviamos un nuevo código a tu correo.', 'success');
            const inputs = document.querySelectorAll('#modalVerificacion .inputs-codigo input');
            inputs.forEach(i => { i.value = ''; });
            document.getElementById('c1').focus();
            iniciarCooldownReenvio(45);
        } else {
            mostrarAlertaModal(data.mensaje || 'No se pudo reenviar el código.', 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Reenviar código';
            }
        }
    } catch (error) {
        console.error(error);
        mostrarAlertaModal('Error de conexión al reenviar el código.', 'error');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Reenviar código';
        }
    }
}

function abrirModalTerminos(e) {
    if (e) e.preventDefault();
    const modal = document.getElementById('modalTerminos');
    if (modal) modal.classList.add('active');
}

function cerrarModalTerminos() {
    const modal = document.getElementById('modalTerminos');
    if (modal) modal.classList.remove('active');
}

function aceptarTerminosModal() {
    const chk = document.getElementById('terms');
    if (chk) chk.checked = true;
    cerrarModalTerminos();
}