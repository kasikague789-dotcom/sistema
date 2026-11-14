// Carnet estudiantil con código QR.
// Cada estudiante tiene UN código activo por periodo (ej. IEB-7K2F-9QX3-M4TA), guardado en la tabla
// "carnets". El código es aleatorio (no se puede adivinar ni inventar) y es lo único que el sistema
// confía al escanear: el resto del texto del QR (nombre, sección, turno) es para que cualquier lector lo muestre.
const crypto = require('crypto');
const { anioEscolarActual, textoPeriodo } = require('./periodo');

// Sin 0/O ni 1/I para que no se confundan al escribirlo a mano
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const RE_CODIGO = /IEB-?([2-9A-HJ-NP-Z]{4})-?([2-9A-HJ-NP-Z]{4})-?([2-9A-HJ-NP-Z]{4})/;

function nuevoCodigo() {
    let t = '';
    for (let i = 0; i < 12; i++) t += ALFABETO[crypto.randomInt(ALFABETO.length)];
    return `IEB-${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8, 12)}`;
}

// Saca el código de lo que leyó la cámara o el lector (texto completo del QR o código escrito a mano)
function extraerCodigo(texto) {
    const m = String(texto || '').toUpperCase().replace(/\s+/g, '').match(RE_CODIGO);
    return m ? `IEB-${m[1]}-${m[2]}-${m[3]}` : null;
}

function textoQR(d) {
    const seccion = d.curso ? `${d.curso.nombre} ${d.curso.seccion}${d.curso.turno ? ` - ${d.curso.turno}` : ''}` : 'Sin sección';
    return [
        'U.E. INSTITUTO ELENA DE BUENO',
        `CARNET ESTUDIANTIL ${d.periodo}`,
        `Nombre: ${d.estudiante.nombre} ${d.estudiante.apellido}`,
        `C.I.: ${d.estudiante.cedula}`,
        `Sección: ${seccion}`,
        `Código: ${d.codigo}`
    ].join('\n');
}

async function anularCarnets(db, estudianteId, motivo) {
    await db.query(
        'UPDATE carnets SET activo = 0, fecha_anulado = NOW(), motivo_anulado = ? WHERE estudiante_id = ? AND activo = 1',
        [String(motivo || '').slice(0, 100), estudianteId]
    );
}

// Devuelve el carnet activo del periodo actual; si no hay (o es de otro periodo), crea uno nuevo
async function carnetVigente(db, estudianteId, creadoPor = null) {
    const anio = await anioEscolarActual(db);
    const [filas] = await db.query('SELECT * FROM carnets WHERE estudiante_id = ? AND activo = 1 ORDER BY id DESC', [estudianteId]);
    const vigente = filas.find(f => Number(f.anio_academico) === anio);
    if (vigente && filas.length === 1) return vigente;
    if (filas.length > 0) await anularCarnets(db, estudianteId, vigente ? 'Duplicado' : 'Cambio de periodo');
    for (let intento = 0; intento < 5; intento++) {
        const codigo = nuevoCodigo();
        try {
            const [r] = await db.query(
                'INSERT INTO carnets (estudiante_id, codigo, anio_academico, activo, creado_por) VALUES (?, ?, ?, 1, ?)',
                [estudianteId, codigo, anio, creadoPor]
            );
            const [[nuevo]] = await db.query('SELECT * FROM carnets WHERE id = ?', [r.insertId]);
            return nuevo;
        } catch (err) {
            if (err.code !== 'ER_DUP_ENTRY') throw err; // código repetido (casi imposible): se intenta otro
        }
    }
    throw new Error('No se pudo generar un código único');
}

async function datosCarnet(db, estudianteId, creadoPor = null) {
    const [[est]] = await db.query(
        "SELECT id, nombre, apellido, cedula, activo FROM usuarios WHERE id = ? AND rol = 'estudiante'",
        [estudianteId]
    );
    if (!est) return null;
    const [[curso]] = await db.query(`
        SELECT c.id, c.nombre, c.seccion, c.turno, c.nivel
        FROM estudiante_curso ec JOIN cursos c ON c.id = ec.curso_id
        WHERE ec.estudiante_id = ? AND ec.activo = 1 ORDER BY ec.id DESC LIMIT 1
    `, [estudianteId]);
    const carnet = await carnetVigente(db, estudianteId, creadoPor);
    const [[foto]] = await db.query('SELECT 1 AS si FROM fotos_usuario WHERE usuario_id = ?', [estudianteId]);
    const d = {
        estudiante: { id: est.id, nombre: est.nombre, apellido: est.apellido, cedula: est.cedula, activo: !!est.activo },
        curso: curso || null,
        periodo: textoPeriodo(carnet.anio_academico),
        anio_academico: Number(carnet.anio_academico),
        codigo: carnet.codigo,
        emitido: carnet.fecha_creacion,
        tiene_foto: !!foto
    };
    d.qr_texto = textoQR(d);
    return d;
}

module.exports = { nuevoCodigo, extraerCodigo, textoQR, carnetVigente, datosCarnet, anularCarnets };
