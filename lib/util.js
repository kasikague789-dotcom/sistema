// Utilidades compartidas por las rutas
const ESTADOS_ASISTENCIA = ['presente', 'ausente', 'tarde', 'justificada'];
const ESTADOS_JUSTIFICACION = ['pendiente', 'aprobada', 'rechazada', 'revision'];
const TIPOS_JUSTIFICACION = ['medica', 'personal', 'familiar', 'deportiva', 'academica', 'otra'];
const ROLES = ['estudiante', 'profesor', 'director'];
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Fecha local del servidor en formato YYYY-MM-DD (no UTC)
function fechaLocal(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const hoyLocal = () => fechaLocal(new Date());

function horaLocal(d = new Date()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function esFechaValida(texto) {
    if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
    const [a, m, d] = texto.split('-').map(Number);
    const f = new Date(a, m - 1, d);
    return f.getFullYear() === a && f.getMonth() === m - 1 && f.getDate() === d;
}

function sumarDias(fechaTexto, dias) {
    const [a, m, d] = fechaTexto.split('-').map(Number);
    return fechaLocal(new Date(a, m - 1, d + dias));
}

function nombreDia(fechaTexto) {
    const [a, m, d] = fechaTexto.split('-').map(Number);
    return DIAS_SEMANA[new Date(a, m - 1, d).getDay()];
}

function esHoraValida(texto) {
    return typeof texto === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(texto);
}
const horaCompleta = (h) => (h.length === 5 ? `${h}:00` : h);

// "justificado", "Justificada" -> "justificada"; devuelve null si no es válido
function normalizarEstado(estado) {
    if (!estado) return null;
    let e = String(estado).toLowerCase().trim();
    if (e === 'justificado') e = 'justificada';
    return ESTADOS_ASISTENCIA.includes(e) ? e : null;
}

// Cédula: solo números (se aceptan V-, E-, puntos y espacios al escribir)
function normalizarCedula(cedula) {
    const limpia = String(cedula || '').replace(/[^0-9]/g, '');
    return /^\d{5,10}$/.test(limpia) ? limpia : null;
}

function esEmailValido(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function leerConfig(db) {
    const [filas] = await db.query('SELECT clave, valor FROM configuracion_sistema');
    const c = {};
    filas.forEach(f => { c[f.clave] = f.valor; });
    return {
        hora_entrada: c.hora_entrada || '08:00',
        porcentaje_asistencia_minimo: Number(c.porcentaje_asistencia_minimo || 85),
        dias_maximos_justificar: Number(c.dias_maximos_justificar || 3),
        notificaciones_activas: c.notificaciones_activas !== 'false',
        permitir_edicion_asistencia: c.permitir_edicion_asistencia !== 'false',
        filtro_groserias_activo: c.filtro_groserias_activo !== 'false',
        hora_cambio_turno: esHoraValida(c.hora_cambio_turno) ? c.hora_cambio_turno.slice(0, 5) : HORA_CAMBIO_TURNO
    };
}

// ---- Turnos: las secciones de la mañana pasan lista antes de la hora de cambio; las de la tarde, desde esa hora ----
const HORA_CAMBIO_TURNO = '12:30';
function claveTurno(turno) {
    const t = String(turno || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    return t === 'manana' ? 'manana' : t === 'tarde' ? 'tarde' : '';
}
// Devuelve el aviso si la sección no puede registrar asistencia a esta hora; null si puede (o si no tiene turno)
function bloqueoPorTurno(turnoSeccion, corte = HORA_CAMBIO_TURNO, ahora = horaLocal()) {
    const t = claveTurno(turnoSeccion);
    if (!t) return null;
    const actual = String(ahora).slice(0, 5) < String(corte).slice(0, 5) ? 'manana' : 'tarde';
    if (actual === t) return null;
    return t === 'manana'
        ? `Esta sección es del turno de la mañana: su asistencia se registra antes de las ${corte}. Ya es turno de la tarde. Si quedó algo pendiente, la dirección puede corregirlo en Asistencia.`
        : `Esta sección es del turno de la tarde: su asistencia se registra desde las ${corte}. Todavía es turno de la mañana.`;
}

const sinAcentos = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---- Filtro de groserías (se usa en TODO el sistema; ver lib/filtro_groserias.js) ----
let cacheGroserias = { hasta: 0, activo: true, palabras: new Set() };
// Igual que sinAcentos pero conserva la ñ ("coño" no debe confundirse con "cono" de geometría)
const normalizarGroseria = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/n\u0303/g, 'ñ').replace(/[\u0300-\u036f]/g, '');
function limpiarCacheGroserias() { cacheGroserias.hasta = 0; }

async function palabrasProhibidas(db) {
    if (Date.now() < cacheGroserias.hasta) return cacheGroserias;
    const config = await leerConfig(db);
    const [filas] = await db.query('SELECT palabra FROM filtro_groserias WHERE activo = 1');
    cacheGroserias = {
        hasta: Date.now() + 30000,
        activo: config.filtro_groserias_activo,
        palabras: new Set(filas.map(f => normalizarGroseria(f.palabra).trim()).filter(Boolean))
    };
    return cacheGroserias;
}

// ¿La palabra escrita es una grosería o una forma de ella? (plural y masculino/femenino)
function esProhibida(palabra, prohibidas) {
    if (prohibidas.has(palabra)) return true;
    for (const p of prohibidas) {
        if (palabra === p + 's' || palabra === p + 'es') return true;
        if (/[oa]$/.test(p)) {
            const raiz = p.slice(0, -1);
            if (palabra === raiz + 'o' || palabra === raiz + 'a' || palabra === raiz + 'os' || palabra === raiz + 'as') return true;
        }
    }
    return false;
}

// Separa el texto en palabras: solo letras. Los números y signos cortan la palabra,
// así "idiota123" o "el.tonto@gmail.com" también se revisan.
const palabrasDe = (t) => normalizarGroseria(t).split(/[^a-zñ]+/).filter(Boolean);

// Busca groserías (palabra completa) en los textos. Devuelve la lista encontrada.
// pegadas: true -> también busca groserías de 6 letras o más metidas dentro de otra
// palabra ("soyidiota", "mierdaaa", "miclavependeja"). Se usa en correos y contraseñas,
// donde la gente pega las palabras. Las cortas no, para no bloquear correos reales como
// "computadora", "disputa", "vergara" o "antontorres".
async function buscarGroserias(db, ...textos) {
    return buscarGroseriasEn(db, textos, false);
}
async function buscarGroseriasEn(db, textos, pegadas) {
    const { activo, palabras } = await palabrasProhibidas(db);
    if (!activo || palabras.size === 0) return [];
    const encontradas = [];
    const agregar = (p) => { if (!encontradas.includes(p)) encontradas.push(p); };
    textos.forEach(t => {
        palabrasDe(t).forEach(p => {
            if (esProhibida(p, palabras)) return agregar(p);
            if (!pegadas) return;
            for (const g of palabras) {
                if (g.length < 6) continue;
                if (p.includes(g)) { agregar(g); continue; }
                // masculino/femenino pegado: "estupido" también atrapa "soyestupida"
                const raiz = /[oa]$/.test(g) ? g.slice(0, -1) : '';
                if (raiz.length >= 6 && (p.includes(raiz + 'o') || p.includes(raiz + 'a'))) agregar(g);
            }
        });
    });
    return encontradas;
}

// ¿La fecha cae en un feriado/asueto que afecta la asistencia?
async function eventoQueSuspende(db, fecha) {
    const [filas] = await db.query(
        'SELECT titulo, tipo_evento FROM calendario_academico WHERE ? BETWEEN fecha_inicio AND fecha_fin AND afecta_asistencia = 1 LIMIT 1',
        [fecha]
    );
    return filas[0] || null;
}

function errorDuplicado(err) {
    return err && err.code === 'ER_DUP_ENTRY';
}

module.exports = {
    ESTADOS_ASISTENCIA, ESTADOS_JUSTIFICACION, TIPOS_JUSTIFICACION, ROLES, DIAS_SEMANA,
    fechaLocal, hoyLocal, horaLocal, esFechaValida, sumarDias, nombreDia, esHoraValida, horaCompleta,
    normalizarEstado, normalizarCedula, esEmailValido, leerConfig, buscarGroserias, buscarGroseriasEn, limpiarCacheGroserias, eventoQueSuspende,
    errorDuplicado, sinAcentos, HORA_CAMBIO_TURNO, claveTurno, bloqueoPorTurno
};
