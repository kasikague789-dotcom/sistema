// Sesiones con token firmado (sin librerías extra).
// El token viaja en el encabezado "Authorization: Bearer <token>".
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DURACION_HORAS = 12;

function obtenerSecreto() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    const archivo = path.join(__dirname, '..', '.session_secret');
    try {
        return fs.readFileSync(archivo, 'utf8').trim();
    } catch {
        const nuevo = crypto.randomBytes(32).toString('hex');
        try { fs.writeFileSync(archivo, nuevo); } catch { /* sin permiso de escritura: vale hasta reiniciar */ }
        return nuevo;
    }
}
const SECRETO = obtenerSecreto();

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const firmar = (texto) => b64url(crypto.createHmac('sha256', SECRETO).update(texto).digest());

function crearToken(usuario, horas = DURACION_HORAS) {
    const payload = {
        id: usuario.id,
        rol: usuario.rol,
        exp: Date.now() + horas * 3600 * 1000
    };
    const cuerpo = b64url(JSON.stringify(payload));
    return `${cuerpo}.${firmar(cuerpo)}`;
}

function leerToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [cuerpo, firma] = token.split('.');
    const esperada = firmar(cuerpo);
    if (!firma || firma.length !== esperada.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
    try {
        const payload = JSON.parse(Buffer.from(cuerpo.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        if (!payload.exp || payload.exp < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

// Rutas que no necesitan sesión
const RUTAS_PUBLICAS = [
    ['POST', '/auth/login'],
    ['POST', '/auth/registro'],
    ['POST', '/auth/verificar'], // <--- NUEVO: Permitir verificar código
    ['POST', '/auth/reenviar'],  // <--- NUEVO: Permitir reenviar código
    ['POST', '/auth/recuperar'],          // ¿Olvidó su contraseña? (código al correo del director)
    ['POST', '/auth/recuperar/cambiar'],
    ['GET', '/health']
];

// Middleware: exige sesión válida y que el usuario siga activo en la BD
function requiereSesion(db) {
    return async (req, res, next) => {
        // Si la ruta está en la lista pública, pasa de largo
        if (RUTAS_PUBLICAS.some(([m, p]) => req.method === m && req.path === p)) return next();

        const encabezado = req.headers.authorization || '';
        const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
        const datos = leerToken(token);
        if (!datos) {
            return res.status(401).json({ estado: 'error', mensaje: 'Sesión vencida o inválida. Inicie sesión de nuevo.' });
        }
        try {
            const [filas] = await db.query('SELECT id, rol, activo, nombre, apellido FROM usuarios WHERE id = ?', [datos.id]);
            if (filas.length === 0 || filas[0].activo == 0) {
                return res.status(401).json({ estado: 'error', mensaje: 'Su cuenta no existe o está desactivada.' });
            }
            req.usuario = { id: filas[0].id, rol: filas[0].rol, nombre: filas[0].nombre, apellido: filas[0].apellido };
            next();
        } catch (err) {
            console.error('Error verificando sesión:', err);
            res.status(500).json({ estado: 'error', mensaje: 'Error del servidor.' });
        }
    };
}

function soloRoles(...roles) {
    return (req, res, next) => {
        if (req.usuario && roles.includes(req.usuario.rol)) return next();
        return res.status(403).json({ estado: 'error', mensaje: 'No tiene permiso para esta acción.' });
    };
}

function soloPropio(param = 'id') {
    return (req, res, next) => {
        if (!req.usuario) return res.status(401).json({ estado: 'error', mensaje: 'Inicie sesión.' });
        if (req.usuario.rol === 'director') return next();
        if (String(req.params[param]) === String(req.usuario.id)) return next();
        return res.status(403).json({ estado: 'error', mensaje: 'Solo puede ver o cambiar sus propios datos.' });
    };
}

module.exports = { crearToken, leerToken, requiereSesion, soloRoles, soloPropio };