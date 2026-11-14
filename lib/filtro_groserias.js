// Filtro de groserías para TODO el sistema.
// Revisa cada dato que llega al servidor antes de guardarlo: nombres, correos (Gmail
// u otro), contraseñas nuevas, fechas, descripciones, observaciones, títulos del
// calendario, materias, aulas, secciones y nombres de archivos adjuntos.
// Se apaga en Director > Configuración > Filtro de groserías.
const { buscarGroseriasEn } = require('./util');

// Lo único que no se revisa: el contenido del archivo adjunto (viene codificado)
// y la contraseña ACTUAL (no se guarda; si era vieja y tenía una grosería, la persona
// debe poder entrar y cambiarla).
const NO_REVISAR = /^(base64|actual)$/i;

// Qué tipo de dato es, según el nombre del campo
const ES_CLAVE = /(^|_)(pass|password|clave|nueva|confirmar)(_|$)|password$|clave$/i;
const ES_CORREO = /(^|_)(email|correo|gmail)(_|$)/i;
const ES_FECHA = /(^|_)(fecha|hora)(_|$)/i;

// Rutas donde SÍ se escriben groserías a propósito (la lista del propio filtro)
// y el inicio de sesión (no guarda nada; una cuenta vieja debe poder entrar).
const EXCEPCIONES = [
    (req) => req.path.startsWith('/configuracion/groserias'),
    (req) => req.path === '/auth/login'
];

function tipoDeCampo(clave) {
    if (!clave) return 'texto';
    if (ES_CLAVE.test(clave)) return 'clave';
    if (ES_CORREO.test(clave)) return 'correo';
    if (ES_FECHA.test(clave)) return 'fecha';
    return 'texto';
}

function juntarTextos(valor, clave, salida) {
    if (clave && NO_REVISAR.test(clave)) return;
    if (typeof valor === 'string' || typeof valor === 'number') {
        salida[tipoDeCampo(clave)].push(String(valor));
    } else if (Array.isArray(valor)) {
        valor.forEach(v => juntarTextos(v, clave, salida));
    } else if (valor && typeof valor === 'object') {
        Object.entries(valor).forEach(([k, v]) => juntarTextos(v, k, salida));
    }
}

// Revisa un objeto con datos (body de la petición o datos de un script).
// Devuelve null si está limpio, o { mensaje, groserias, campo }.
async function revisarDatos(db, datos) {
    const textos = { clave: [], correo: [], fecha: [], texto: [] };
    juntarTextos(datos, null, textos);

    const enClave = await buscarGroseriasEn(db, textos.clave, true);
    if (enClave.length > 0) {
        // No se repite la palabra en pantalla: es parte de la contraseña
        return { campo: 'clave', groserias: enClave, mensaje: 'La contraseña tiene una palabra no permitida. Escriba otra contraseña.' };
    }
    const enCorreo = await buscarGroseriasEn(db, textos.correo, true);
    if (enCorreo.length > 0) {
        return { campo: 'correo', groserias: enCorreo, mensaje: `El correo tiene palabras no permitidas (${enCorreo.join(', ')}). Use otro correo.` };
    }
    const enFecha = await buscarGroseriasEn(db, textos.fecha, false);
    if (enFecha.length > 0) {
        return { campo: 'fecha', groserias: enFecha, mensaje: `La fecha tiene palabras no permitidas (${enFecha.join(', ')}). Escriba una fecha válida.` };
    }
    const enTexto = await buscarGroseriasEn(db, textos.texto, false);
    if (enTexto.length > 0) {
        return { campo: 'texto', groserias: enTexto, mensaje: `El texto contiene palabras no permitidas (${enTexto.join(', ')}). Corríjalo e intente de nuevo.` };
    }
    return null;
}

function filtroGroserias(db) {
    return async (req, res, next) => {
        if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
        if (EXCEPCIONES.some(f => f(req))) return next();
        if (!req.body || typeof req.body !== 'object') return next();
        try {
            const malo = await revisarDatos(db, req.body);
            if (malo) {
                return res.status(400).json({ estado: 'error', mensaje: malo.mensaje, error: malo.mensaje, groserias: malo.groserias, campo: malo.campo });
            }
            next();
        } catch (err) {
            console.error('Error en el filtro de groserías:', err);
            next();
        }
    };
}

module.exports = { filtroGroserias, revisarDatos };
