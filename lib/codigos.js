// Códigos de 6 números que se mandan por correo para recuperar una clave.
// Se guardan en la memoria del servidor (si el servidor se reinicia, hay que pedir otro).
//   - Vencen a los 15 minutos.
//   - 5 intentos fallidos y el código deja de servir.
//   - Máximo 3 códigos cada 15 minutos para la misma cuenta.
const crypto = require('crypto');

const VIGENCIA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 5;
const MAX_ENVIOS = 3;

const codigos = new Map(); // llave -> { codigo, vence, intentos }
const envios = new Map();  // llave -> [fechas de envío]

function puedeEnviar(llave) {
    const ahora = Date.now();
    const lista = (envios.get(llave) || []).filter(t => ahora - t < VIGENCIA_MS);
    envios.set(llave, lista);
    if (lista.length < MAX_ENVIOS) return 0;
    return Math.max(1, Math.ceil((VIGENCIA_MS - (ahora - lista[0])) / 60000)); // minutos de espera
}

function nuevoCodigo(llave) {
    const codigo = String(crypto.randomInt(100000, 1000000));
    codigos.set(llave, { codigo, vence: Date.now() + VIGENCIA_MS, intentos: 0 });
    const lista = envios.get(llave) || [];
    lista.push(Date.now());
    envios.set(llave, lista);
    return codigo;
}

// 'ok' | 'falta' | 'vencido' | 'malo' | 'agotado'
function revisarCodigo(llave, codigo) {
    const c = codigos.get(llave);
    if (!c) return 'falta';
    if (Date.now() > c.vence) { codigos.delete(llave); return 'vencido'; }
    const dado = String(codigo || '').replace(/\D/g, '');
    const iguales = dado.length === c.codigo.length && crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(c.codigo));
    if (iguales) { codigos.delete(llave); return 'ok'; }
    c.intentos++;
    if (c.intentos >= MAX_INTENTOS) { codigos.delete(llave); return 'agotado'; }
    return 'malo';
}

const MENSAJE_CODIGO = {
    falta: 'Primero pida el código (no hay ninguno vigente).',
    vencido: 'El código venció. Pida uno nuevo.',
    malo: 'El código no es correcto. Revise el correo e intente de nuevo.',
    agotado: 'Demasiados intentos con ese código. Pida uno nuevo.'
};

module.exports = { puedeEnviar, nuevoCodigo, revisarCodigo, MENSAJE_CODIGO };
