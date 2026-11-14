// Límite de intentos para claves delicadas (contraseña + clave de seguridad del director).
// 5 fallos seguidos → 15 minutos de espera. Vive en memoria: se limpia al reiniciar.
const mapa = new Map();
const MAX = 5;
const MINUTOS = 15;

function minutosBloqueo(clave) {
    const x = mapa.get(clave);
    if (!x || !x.hasta) return 0;
    if (x.hasta > Date.now()) return Math.ceil((x.hasta - Date.now()) / 60000);
    mapa.delete(clave);
    return 0;
}

function sumarFallo(clave) {
    const x = mapa.get(clave) || { n: 0, hasta: 0 };
    x.n++;
    if (x.n >= MAX) { x.hasta = Date.now() + MINUTOS * 60000; x.n = 0; }
    mapa.set(clave, x);
}

function limpiarFallos(clave) { mapa.delete(clave); }

function mensajeBloqueo(min) {
    return `Demasiados intentos fallidos. Espere ${min} minuto${min === 1 ? '' : 's'} y vuelva a intentar.`;
}

module.exports = { minutosBloqueo, sumarFallo, limpiarFallos, mensajeBloqueo };
