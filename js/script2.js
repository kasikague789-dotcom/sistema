let emailEnVerificacion = '';
let timeoutToast; // Variable para controlar el tiempo del mensaje

document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('registerForm');

    const inputs = document.querySelectorAll('.inputs-codigo input');
    inputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            if (e.target.value.length === 1 && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
                inputs[index - 1].focus();
            }
        });
        input.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
    });

    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const nombre = document.getElementById('firstName').value.trim();
            const apellido = document.getElementById('lastName').value.trim();
            const email = document.getElementById('email').value.trim();
            const cedula = document.getElementById('idNumber').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const btnSubmit = registerForm.querySelector('button[type="submit"]');

            if (password !== confirmPassword) {
                mostrarAlerta('Las contraseñas no coinciden. Por favor, verifíquelas.', 'error');
                return;
            }

            const textoOriginal = btnSubmit.textContent;
            btnSubmit.textContent = 'Registrando...';
            btnSubmit.disabled = true;

            try {
                const response = await fetch('/api/auth/registro', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, apellido, cedula, email, password })
                });

                const data = await response.json();

                if (data.estado === 'exitoso') {
                    emailEnVerificacion = data.email;
                    document.getElementById('textoCorreo').innerHTML = `Enviamos un código de 6 dígitos a <strong>${data.email}</strong>. Ingrésalo aquí abajo.`;
                    document.getElementById('modalVerificacion').classList.add('active');
                    inputs.forEach(i => i.value = '');
                    document.getElementById('c1').focus();
                } else if (data.requiere_verificacion && data.email) {
                    // Quedó registrado pero el correo no salió: igual se abre la ventana del código (con "Reenviar")
                    emailEnVerificacion = data.email;
                    document.getElementById('textoCorreo').innerHTML = `No pudimos enviar el código a <strong>${data.email.replace(/[<>&"]/g, '')}</strong>. Toque "Reenviar código" en unos minutos y escriba aquí el código que le llegue.`;
                    document.getElementById('modalVerificacion').classList.add('active');
                    inputs.forEach(i => i.value = '');
                    mostrarAlerta(data.mensaje, 'error');
                } else {
                    // Interceptamos el mensaje feo del backend
                    let mensajeParaMostrar = data.mensaje;
                    if (mensajeParaMostrar && mensajeParaMostrar.toLowerCase().includes('no esta registrado')) {
                        mensajeParaMostrar = "Su cédula no aparece en nuestro sistema. Por favor, comuníquese con el Control de Estudios para registrar sus datos.";
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

// FUNCIÓN PARA CERRAR EL MODAL DE VERIFICACIÓN
function cerrarModalVerificacion() {
    document.getElementById('modalVerificacion').classList.remove('active');
}

// NUEVA FUNCIÓN DISCRETA (TOAST) QUE APARECE Y SE DESVANECE
function mostrarAlerta(mensaje, tipo = 'info', callback = null) {
    const toast = document.getElementById('toastMensaje');
    
    // Limpiamos cualquier clase anterior y asignamos el tipo (error, success, info)
    toast.className = 'toast-mensaje ' + tipo;
    toast.textContent = mensaje;
    
    // Hacemos que aparezca
    toast.style.display = 'block';
    
    // Pequeño retraso para que la transición de opacidad funcione
    setTimeout(() => {
        toast.classList.add('mostrar');
    }, 10);

    // Si ya había un temporizador activo, lo reiniciamos
    if (timeoutToast) clearTimeout(timeoutToast);

    // Ocultarlo después de 4.5 segundos
    timeoutToast = setTimeout(() => {
        toast.classList.remove('mostrar');
        // Esperamos a que termine la animación de desvanecimiento (0.4s) para ocultarlo del todo
        setTimeout(() => {
            toast.style.display = 'none';
        }, 400);
    }, 4500);

    // Si hay una acción pendiente (como redirigir al login), la ejecutamos
    if (callback) {
        setTimeout(callback, 1500); // Damos 1.5s para que lean el mensaje de éxito antes de redirigir
    }
}

async function verificarCodigo() {
    const inputs = document.querySelectorAll('.inputs-codigo input');
    let codigo = '';
    inputs.forEach(i => codigo += i.value);

    if (codigo.length !== 6) {
        mostrarAlerta('Por favor, ingrese los 6 dígitos del código enviado a su correo.', 'error');
        return;
    }

    const btn = document.getElementById('btnVerificar');
    btn.textContent = 'Verificando...';
    btn.disabled = true;

    try {
        const response = await fetch('/api/auth/verificar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailEnVerificacion, codigo })
        });

        const data = await response.json();

        if (data.estado === 'exitoso') {
            // Cerramos el modal para que el usuario vea el mensaje de éxito en la pantalla principal
            cerrarModalVerificacion(); 
            mostrarAlerta('¡Correo verificado con éxito! Ahora puede iniciar sesión.', 'success', () => {
                window.location.href = 'login.html';
            });
        } else {
            mostrarAlerta(data.mensaje, 'error');
        }
    } catch (error) {
        console.error(error);
        mostrarAlerta('Error al verificar el código. Intente de nuevo.', 'error');
    } finally {
        btn.textContent = 'Verificar y Activar';
        btn.disabled = false;
    }
}

async function reenviarCodigo() {
    if (!emailEnVerificacion) return;

    try {
        const response = await fetch('/api/auth/reenviar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailEnVerificacion })
        });
        const data = await response.json();
        mostrarAlerta(data.mensaje, 'success');
    } catch (error) {
        console.error(error);
        mostrarAlerta('Error al reenviar el código. Intente de nuevo.', 'error');
    }
}