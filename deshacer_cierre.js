// Deshace el ÚLTIMO cierre de periodo (paso de año), desde la consola.
// Es lo mismo que el botón "Deshacer este cierre" de la pantalla Cierre de periodo.
//
// Uso (en la carpeta del sistema):
//   node deshacer_cierre.js              muestra qué va a hacer y pide escribir DESHACER
//                                        (si hubo varios cierres seguidos, después pregunta por el anterior)
//   node deshacer_cierre.js --si         deshace el último sin preguntar
//   node deshacer_cierre.js --si --todos deshace todos los cierres seguidos sin preguntar
//
// Lo que muestra queda también en respaldos_bd/herramientas.log.
require('dotenv').config({ quiet: true });
process.env.TZ = process.env.TZ || 'America/Caracas'; // igual que server.js
const db = require('./db');
const { vistaDeshacer, deshacerUltimo, hayOtro } = require('./lib/deshacer_cierre');
const { crearRegistro } = require('./lib/registro');
const { lectorConsola } = require('./lib/consola');

const log = crearRegistro('deshacer_cierre');

function mostrarVista(v) {
    log('');
    log(`Último cierre: ${v.periodo} -> ${v.periodo_siguiente} (${new Date(v.fecha).toLocaleString('es-VE')})`);
    log(`  ${v.estudiantes} estudiantes vuelven a su sección de ${v.periodo}` + (v.egresaron ? `; ${v.egresaron} egresado(s) vuelven a estar activos` : '') + '.');
    log(`  El periodo vuelve a ${v.periodo}. Los carnets de ${v.periodo} vuelven a servir.`);
    if (v.horarios_archivados) log('  Los horarios y asignaciones de profesores vuelven a estar activos.');
    log(`  Datos usados: ${v.fuente}.`);
    v.avisos.forEach(a => log('  Ojo: ' + a));
    if (v.asistencias_desde) log(`  Desde ese cierre se guardaron ${v.asistencias_desde} marcas de asistencia: se conservan.`);
    log('  La asistencia, las justificaciones y el calendario no se tocan.');
    log('');
}

function mostrarResultado(r) {
    log('');
    if (r.respaldo) log('Respaldo guardado: ' + r.respaldo);
    log(`Listo. El periodo vuelve a ser ${r.periodo}.`);
    log(`  Estudiantes devueltos a su sección: ${r.devueltos}.`);
    log(`  Carnets que vuelven a servir: ${r.carnets_vuelven}. Carnets del periodo nuevo anulados: ${r.carnets_anulados}.`);
    if (r.secciones_borradas.length) log(`  Secciones creadas por el cierre que se borraron: ${r.secciones_borradas.join(', ')}.`);
    if (r.secciones_dejadas.length) log(`  Secciones creadas por el cierre que se dejaron (ya tienen datos): ${r.secciones_dejadas.join(', ')}.`);
    if (r.omitidos.length) log(`  Revise a mano: ${r.omitidos.join('; ')}.`);
    if (r.acta) log(`  El acta de ese cierre quedó en respaldos_bd/${r.acta}.`);
}

async function principal() {
    const sinPreguntar = process.argv.includes('--si');
    const todos = process.argv.includes('--todos');
    const consola = sinPreguntar ? null : lectorConsola();
    let hechos = 0;
    try {
        for (;;) {
            const v = await vistaDeshacer(db);
            if (!v.posible) { log(v.mensaje); break; }
            mostrarVista(v);
            if (consola) {
                const r = String(await consola.preguntar('Para seguir escriba DESHACER y presione Enter: ') || '').trim();
                log.solo('Respuesta: ' + r);
                if (r.toUpperCase() !== 'DESHACER') { log('No se hizo ningún cambio.'); break; }
            }
            mostrarResultado(await deshacerUltimo(db, { id: v.id }));
            hechos++;
            if (!(await hayOtro(db))) break;
            if (sinPreguntar && !todos) { log('\nHay otro cierre anterior. Para deshacerlo, vuelva a ejecutar esta herramienta.'); break; }
            log('\nTambién hubo un cierre antes de ese.');
        }
    } finally {
        if (consola) consola.close();
    }
    return hechos > 0;
}

if (require.main === module) {
    principal()
        .then((ok) => { process.exitCode = ok ? 0 : 1; })
        .catch((err) => { log('No se hizo ningún cambio. Error: ' + (err.message || err)); process.exitCode = 1; })
        .finally(() => db.end().catch(() => {}));
}
