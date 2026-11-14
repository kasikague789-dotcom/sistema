document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.querySelector('form');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            const cedula = document.getElementById('cedula');
            if (cedula) {
                const valor = cedula.value.trim();
                if (!valor || valor.length < 8) {
                    e.preventDefault();
                    avisar('Escriba la cédula solo con números (mínimo 8 dígitos).', { tipo: 'aviso', titulo: 'Revise la cédula' });
                }
            }
        });
    }

    // Modo oscuro inicial desde localStorage
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        actualizarPalancaModoOscuro(true);
    } else {
        actualizarPalancaModoOscuro(false);
    }

    // Reloj en tiempo real global para todas las vistas con #live-clock
    const reloj = document.getElementById('live-clock');
    if (reloj) {
        const actualizarReloj = () => {
            const ahora = new Date();
            const fechaStr = ahora.toLocaleDateString('es-VE', { year: 'numeric', month: '2-digit', day: '2-digit' });
            const horaStr = ahora.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            reloj.textContent = `${fechaStr} ${horaStr}`;
        };
        actualizarReloj();
        setInterval(actualizarReloj, 1000);
    }
});

// ==========================================
// FUNCIONES GLOBALES DEL SISTEMA
// ==========================================

function confirmarAccion(mensaje) {
    // Devuelve una promesa: use  if (await confirmarAccion('...')) { ... }
    return window.confirmar ? window.confirmar(mensaje || '', { titulo: '¿Desea continuar?' }) : Promise.resolve(window.confirm(mensaje));
}

function mostrarNotificacion(mensaje, tipo) {
    const alerta = document.createElement('div');
    alerta.className = 'alert alert-' + (tipo || 'success');
    alerta.textContent = mensaje;
    
    const container = document.querySelector('.content');
    if (container) {
        container.insertBefore(alerta, container.firstChild);
        setTimeout(() => {
            alerta.remove();
        }, 5000);
    }
}

function formatearFecha(fecha) {
    const d = new Date(fecha);
    return d.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function formatearHora(hora) {
    const h = new Date('1970-01-01T' + hora);
    return h.toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function toggleSubmenu(elemento) {
    const submenu = elemento.nextElementSibling;
    const arrow = elemento.querySelector('.arrow');
    
    if (submenu) {
        submenu.classList.toggle('open');
        if (arrow) {
            arrow.classList.toggle('open');
        }
    }
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);
    actualizarPalancaModoOscuro(isDark);
}

function actualizarPalancaModoOscuro(isDark) {
    const switchBtn = document.querySelector('.toggle-dark .switch');
    if (switchBtn) {
        const circle = switchBtn.querySelector('div');
        if (circle) {
            if (isDark) {
                circle.style.transform = 'translateX(16px)';
            } else {
                circle.style.transform = 'translateX(0px)';
            }
        }
    }
}

// Cerrar sesión: ver js/sesion.js (función cerrarSesion)
