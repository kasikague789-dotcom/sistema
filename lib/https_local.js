// =====================================================================
// HTTPS SOLO PARA PROBAR EN LA RED LOCAL (teléfonos y tabletas en el mismo Wi-Fi).
// Los navegadores solo dejan usar la cámara en vivo con https (o en localhost).
// Este archivo crea un certificado propio de esta computadora y abre un segundo
// puerto con https. No se usa en Clever Cloud (allá ya hay https): solo arranca si
// existe la variable HTTPS_PUERTO (la pone PROBAR_EN_MI_PC.bat).
// El certificado no es de una autoridad: la primera vez el navegador avisa
// "La conexión no es privada" y hay que tocar "Configuración avanzada" > "Acceder".
// Los teléfonos que entran por http se pasan solos a https (redirigir).
// =====================================================================
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const CARPETA = path.join(__dirname, '..', 'certificado_local');
const DIAS_VALIDO = 365;

// ---------- DER mínimo para armar un certificado X.509 ----------
function largo(n) {
    if (n < 0x80) return Buffer.from([n]);
    const b = [];
    while (n > 0) { b.unshift(n & 0xff); n = Math.floor(n / 256); }
    return Buffer.from([0x80 | b.length, ...b]);
}
function tlv(etiqueta, ...partes) {
    const v = Buffer.concat(partes.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
    return Buffer.concat([Buffer.from([etiqueta]), largo(v.length), v]);
}
const secuencia = (...p) => tlv(0x30, ...p);
const conjunto = (...p) => tlv(0x31, ...p);
function oid(texto) {
    const n = texto.split('.').map(Number);
    const bytes = [40 * n[0] + n[1]];
    for (const x of n.slice(2)) {
        const t = [x & 0x7f];
        let v = Math.floor(x / 128);
        while (v > 0) { t.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
        bytes.push(...t);
    }
    return tlv(0x06, Buffer.from(bytes));
}
function entero(buf) {
    while (buf.length > 1 && buf[0] === 0 && !(buf[1] & 0x80)) buf = buf.subarray(1);
    if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]);
    return tlv(0x02, buf);
}
function hora(d) { // UTCTime (sirve hasta 2049)
    const p = n => String(n).padStart(2, '0');
    const s = p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
        p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
    return tlv(0x17, Buffer.from(s, 'ascii'));
}
const nombre = (cn) => secuencia(conjunto(secuencia(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));

// Direcciones IPv4 de esta computadora (Wi-Fi, cable) + localhost
function direccionesLocales() {
    const ips = new Set(['127.0.0.1']);
    for (const lista of Object.values(os.networkInterfaces())) {
        for (const i of lista || []) {
            if ((i.family === 'IPv4' || i.family === 4) && !i.address.startsWith('169.254.')) ips.add(i.address);
        }
    }
    return [...ips].sort();
}

function crearCertificado(ips) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const algoritmo = secuencia(oid('1.2.840.10045.4.3.2')); // ecdsa-with-SHA256
    const serie = crypto.randomBytes(16); serie[0] &= 0x7f;
    const desde = new Date(Date.now() - 24 * 3600 * 1000);
    const hasta = new Date(Date.now() + DIAS_VALIDO * 24 * 3600 * 1000);
    const cn = 'Prueba local - Sistema de Asistencia';

    const nombresAlt = [tlv(0x82, Buffer.from('localhost', 'ascii'))]
        .concat(ips.map(ip => tlv(0x87, Buffer.from(ip.split('.').map(Number)))));
    const extensiones = secuencia(
        secuencia(oid('2.5.29.19'), tlv(0x04, secuencia())),                                   // no es autoridad
        secuencia(oid('2.5.29.15'), tlv(0x01, [0xff]), tlv(0x04, tlv(0x03, [0x07, 0x80]))),     // firma digital
        secuencia(oid('2.5.29.37'), tlv(0x04, secuencia(oid('1.3.6.1.5.5.7.3.1')))),           // servidor web
        secuencia(oid('2.5.29.17'), tlv(0x04, secuencia(...nombresAlt)))                        // localhost + IPs
    );
    const cuerpo = secuencia(
        tlv(0xa0, entero(Buffer.from([2]))),
        entero(serie),
        algoritmo,
        nombre(cn),
        secuencia(hora(desde), hora(hasta)),
        nombre(cn),
        publicKey.export({ type: 'spki', format: 'der' }),
        tlv(0xa3, extensiones)
    );
    const firma = crypto.sign('sha256', cuerpo, { key: privateKey, dsaEncoding: 'der' });
    const der = secuencia(cuerpo, algoritmo, tlv(0x03, Buffer.concat([Buffer.from([0]), firma])));
    const cert = '-----BEGIN CERTIFICATE-----\n' + der.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
    return { cert, clave: privateKey.export({ type: 'pkcs8', format: 'pem' }), hasta };
}

// Usa el certificado guardado si sigue sirviendo; si cambió la IP o está por vencer, hace otro
function obtenerCertificado() {
    const ips = direccionesLocales();
    const fCert = path.join(CARPETA, 'cert.pem'), fClave = path.join(CARPETA, 'clave.pem');
    try {
        const cert = fs.readFileSync(fCert, 'utf8'), clave = fs.readFileSync(fClave, 'utf8');
        const x = new crypto.X509Certificate(cert);
        const quedanDias = (new Date(x.validTo) - Date.now()) / 86400000;
        const cubre = ips.every(ip => x.checkIP(ip));
        if (quedanDias > 30 && cubre) return { cert, clave, nuevo: false };
    } catch (e) { /* no hay o no sirve: se crea otro */ }
    const c = crearCertificado(ips);
    fs.mkdirSync(CARPETA, { recursive: true });
    fs.writeFileSync(fClave, c.clave, { mode: 0o600 });
    fs.writeFileSync(fCert, c.cert);
    return { cert: c.cert, clave: c.clave, nuevo: true };
}

let escuchando = 0; // puerto https ya abierto (0 = no)

// Teléfono o tableta que entra por http (con la IP de la PC): se manda a la misma página por https,
// donde sí hay cámara en vivo. La computadora misma (localhost) sigue por http, sin aviso.
// Solo pantallas (GET); las llamadas a /api no se tocan. Si el https no abrió, no redirige.
function redirigir() {
    const locales = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    return (req, res, next) => {
        if (!escuchando || req.socket.encrypted || req.method !== 'GET' || req.path.startsWith('/api/')) return next();
        const host = req.hostname;
        if (!host || locales.has(host)) return next();
        res.redirect(302, `https://${host}:${escuchando}${req.originalUrl}`);
    };
}

function iniciar(app, puerto) {
    if (!puerto) return null;
    let c;
    try { c = obtenerCertificado(); } catch (e) {
        console.error('No se pudo crear el certificado para https local:', e.message);
        return null;
    }
    const servidor = https.createServer({ key: c.clave, cert: c.cert }, app);
    servidor.on('error', (e) => {
        console.error(e.code === 'EADDRINUSE'
            ? `El puerto ${puerto} (https local) está ocupado. Cierre la otra ventana del sistema.`
            : 'Error en https local: ' + e.message);
    });
    servidor.listen(puerto, () => {
        escuchando = puerto;
        console.log(`Https local (cámara en vivo en teléfonos): https://localhost:${puerto}` + (c.nuevo ? '  [certificado nuevo]' : ''));
    });
    return servidor;
}

module.exports = { iniciar, redirigir, crearCertificado, direccionesLocales, puertoActivo: () => escuchando };
