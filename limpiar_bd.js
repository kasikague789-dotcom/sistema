// Deja la base limpia para empezar: quedan las CUENTAS (usuarios), las SECCIONES, la configuración
// y la lista de groserías. Se borra todo lo demás.
//
// Uso (en la carpeta del sistema):
//   node limpiar_bd.js        muestra qué va a borrar y pide escribir LIMPIAR
//   node limpiar_bd.js --si   lo hace sin preguntar
//
// Pasos:
//   1) Guarda un respaldo en respaldos_bd/.
//   2) Deshace los cierres de periodo que se puedan (así vuelven las cuentas de egresados y
//      se quitan las secciones que crearon los cierres).
//   3) Borra: inscripciones de estudiantes, asignaciones y horarios de profesores, asistencia,
//      justificaciones (y sus archivos), calendario, avisos, carnets QR y fotos, lecturas de carnets,
//      cierres de periodo, clases no dadas y suplencias.
//   4) El periodo queda en el año escolar de hoy (por ejemplo 2026-2027).
// Lo que muestra queda también en respaldos_bd/herramientas.log.
require('dotenv').config({ quiet: true });
process.env.TZ = process.env.TZ || 'America/Caracas';
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { prepararBaseDeDatos, respaldarJSON } = require('./lib/migraciones');
const { vistaDeshacer, deshacerUltimo } = require('./lib/deshacer_cierre');
const { textoPeriodo } = require('./lib/periodo');
const { crearRegistro } = require('./lib/registro');
const { lectorConsola } = require('./lib/consola');

const log = crearRegistro('limpiar_bd');

// Orden seguro (primero lo que depende de otras tablas)
const BORRAR = [
    ['escaneos', 'lecturas de carnets'],
    ['notificaciones', 'avisos de la campana'],
    ['asistencia', 'marcas de asistencia'],
    ['justificaciones', 'justificaciones'],
    ['clases_no_dadas', 'clases no dadas'],
    ['suplencias', 'suplencias'],
    ['horarios_clase', 'bloques de horario'],
    ['profesor_curso', 'asignaciones de profesores'],
    ['estudiante_curso', 'inscripciones de estudiantes en secciones'],
    ['carnets', 'carnets QR'],
    ['fotos_usuario', 'fotos de carnet'],
    ['calendario_academico', 'eventos del calendario'],
    ['promociones', 'cierres de periodo (actas)']
];
const CARPETA_ADJUNTOS = path.join(__dirname, 'uploads', 'justificaciones');

const anioEscolarDeHoy = () => { const h = new Date(); return h.getMonth() >= 8 ? h.getFullYear() : h.getFullYear() - 1; };

async function contar(t) {
    try { const [[c]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``); return Number(c.n); } catch { return null; }
}

async function principal() {
    // Por si el servidor nuevo aún no se ha arrancado: deja la base en la versión nueva
    await prepararBaseDeDatos(db, { avisos: false });

    const [[u]] = await db.query('SELECT COUNT(*) AS n FROM usuarios');
    const [[c]] = await db.query('SELECT COUNT(*) AS n FROM cursos');
    const anio = anioEscolarDeHoy();
    log('');
    log('LIMPIAR LA BASE DE DATOS');
    log(`  Se quedan: ${u.n} cuenta(s) de usuario, ${c.n} sección(es), la configuración y la lista de groserías.`);
    log('  Se borra:');
    const conteo = {};
    for (const [t, nombre] of BORRAR) {
        conteo[t] = await contar(t);
        if (conteo[t] !== null) log(`    - ${nombre}: ${conteo[t]}`);
    }
    let adjuntos = [];
    try { adjuntos = fs.readdirSync(CARPETA_ADJUNTOS).filter(f => fs.statSync(path.join(CARPETA_ADJUNTOS, f)).isFile()); } catch { /* sin carpeta */ }
    if (adjuntos.length) log(`    - archivos de constancias en uploads/justificaciones: ${adjuntos.length}`);
    log(`  El periodo queda en ${textoPeriodo(anio)}. Los estudiantes quedan sin sección (se asignan otra vez).`);
    log('');

    if (!process.argv.includes('--si')) {
        const consola = lectorConsola();
        const r = String(await consola.preguntar('Para seguir escriba LIMPIAR y presione Enter: ')).trim();
        consola.close();
        log.solo('Respuesta: ' + r);
        if (r.toUpperCase() !== 'LIMPIAR') { log('No se cambió nada.'); return false; }
    }

    try { log('Respaldo guardado: ' + path.basename(await respaldarJSON(db, 'Antes de limpiar la base'))); }
    catch { log('(No se pudo guardar el respaldo en disco.)'); }

    // 2) Deshacer los cierres que se puedan
    for (let i = 0; i < 20; i++) {
        const v = await vistaDeshacer(db);
        if (!v.posible) break;
        try {
            const r = await deshacerUltimo(db, { id: v.id });
            log(`  Cierre ${v.periodo} -> ${v.periodo_siguiente} deshecho.` + (r.secciones_borradas.length ? ` Secciones que había creado y se borraron: ${r.secciones_borradas.join(', ')}.` : ''));
        } catch (err) {
            log(`  No se pudo deshacer el cierre ${v.periodo} -> ${v.periodo_siguiente} (${err.message}). Sigo con la limpieza.`);
            break;
        }
    }

    // 3) Borrar
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const [t] of BORRAR) {
            if (conteo[t] === null) continue; // la tabla no existe en esta base
            await conn.query(`DELETE FROM \`${t}\``);
        }
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        // 4) Periodo de hoy
        await conn.query('UPDATE cursos SET anio_escolar = ?', [anio]);
        await conn.query(
            "INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES ('anio_escolar_actual', ?, 'Año escolar en curso (lo cambia el cierre de periodo)') ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
            [String(anio)]);
        await conn.commit();
    } catch (err) {
        await conn.rollback().catch(() => {});
        await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
        throw err;
    } finally {
        conn.release();
    }

    let borrados = 0;
    for (const f of adjuntos) { try { fs.unlinkSync(path.join(CARPETA_ADJUNTOS, f)); borrados++; } catch { /* en uso */ } }

    const [[u2]] = await db.query('SELECT COUNT(*) AS n FROM usuarios');
    const [[c2]] = await db.query('SELECT COUNT(*) AS n FROM cursos');
    log('');
    log(`Listo. La base quedó limpia: ${u2.n} cuenta(s) y ${c2.n} sección(es). Periodo ${textoPeriodo(anio)}.`);
    if (borrados) log(`  Se borraron ${borrados} archivo(s) de constancias.`);
    log('  Siguiente: Asignar Estudiante, Asignar Profesores y Horarios.');
    return true;
}

if (require.main === module) {
    principal()
        .then((ok) => { process.exitCode = ok ? 0 : 1; })
        .catch((err) => { log('No se terminó la limpieza. Error: ' + (err.message || err)); process.exitCode = 1; })
        .finally(() => db.end().catch(() => {}));
}
