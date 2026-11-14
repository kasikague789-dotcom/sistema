// Deshacer el ÚLTIMO cierre de periodo (paso de año). Lo usan el botón de "Cierre de periodo"
// (routes/promocion.js) y las herramientas de consola deshacer_cierre.js y limpiar_bd.js.
//
// Qué hace:
//   - Cada estudiante vuelve a la sección que tenía antes del cierre (los que egresaron vuelven a estar activos).
//   - El periodo vuelve al anterior (por ejemplo de 2027-2028 a 2026-2027).
//   - Los carnets QR del periodo anterior vuelven a servir; los del periodo nuevo se anulan.
//   - Si el cierre archivó horarios y asignaciones de profesores, vuelven a estar activos.
//   - Las secciones que creó el cierre se borran si siguen vacías.
//   - El acta de ese cierre se guarda como PDF en respaldos_bd/ y se quita del historial.
// No toca la asistencia, las justificaciones ni el calendario. Antes de empezar guarda un respaldo en respaldos_bd/.
const fs = require('fs');
const path = require('path');
const { respaldarJSON } = require('./migraciones');
const { textoPeriodo } = require('./periodo');
const { notificar } = require('./notificar');

const CARPETA_RESPALDOS = path.join(__dirname, '..', 'respaldos_bd');

class ErrorDeshacer extends Error {}

// Respaldo automático "Antes del cierre de periodo" guardado justo antes de ese cierre
// (el más cercano ANTES del cierre; nunca uno de después, que ya tendría el cierre hecho)
function buscarRespaldo(fechaCierre) {
    let mejor = null;
    let archivos = [];
    try { archivos = fs.readdirSync(CARPETA_RESPALDOS).filter(f => /^respaldo_.*\.json$/.test(f)); } catch { return null; }
    for (const f of archivos) {
        try {
            const datos = JSON.parse(fs.readFileSync(path.join(CARPETA_RESPALDOS, f), 'utf8'));
            if (datos.motivo !== 'Antes del cierre de periodo') continue;
            const t = new Date(datos.fecha).getTime();
            const dif = fechaCierre.getTime() - t;
            if (isNaN(t) || dif < -2000 || dif > 15 * 60000) continue; // hasta 15 min antes del cierre
            if (!mejor || dif < mejor.dif) mejor = { t, dif, archivo: f, datos };
        } catch { /* archivo dañado: se ignora */ }
    }
    return mejor;
}

// Arma la lista de lo que hay que devolver: del propio cierre (exacto), del respaldo o, si no hay, con reglas seguras
async function armarPlan(conn, cierre, resumen) {
    const estudiantes = [];
    for (const s of resumen.secciones || []) {
        for (const e of s.estudiantes || []) estudiantes.push({ ...e, origen: s.curso, destino: s.destino });
    }
    const plan = { fuente: '', estudiantes, avisos: [] };
    const destinos = [...new Set((resumen.secciones || []).map(s => s.destino && s.destino.id).filter(Boolean))];

    if (resumen.deshacer) {
        const d = resumen.deshacer;
        plan.fuente = 'datos guardados por el cierre (exacto)';
        plan.inscripciones = d.inscripciones || {};
        plan.cursosAnio = d.cursos_anio || {};
        plan.cursosCreados = d.cursos_creados || [];
        plan.horarios = d.horarios_ids || [];
        plan.asignaciones = d.asignaciones_ids || [];
        plan.carnets = d.carnets_ids || [];
        plan.anioPrevio = d.anio_actual_previo;
        return plan;
    }

    const respaldo = buscarRespaldo(new Date(cierre.fecha));
    if (respaldo) {
        const t = respaldo.datos.tablas || {};
        plan.fuente = `respaldo ${respaldo.archivo}`;
        plan.inscripciones = {};
        for (const e of estudiantes) {
            plan.inscripciones[e.id] = (t.estudiante_curso || []).filter(r => Number(r.estudiante_id) === Number(e.id) && Number(r.activo) === 1).map(r => r.id);
        }
        plan.cursosAnio = {};
        for (const c of t.cursos || []) if (Number(c.activo) === 1) plan.cursosAnio[c.id] = c.anio_escolar;
        const habia = new Set((t.cursos || []).map(c => Number(c.id)));
        plan.cursosCreados = destinos.filter(id => !habia.has(Number(id)));
        plan.horarios = resumen.horarios_archivados ? (t.horarios_clase || []).filter(r => Number(r.activo) === 1).map(r => r.id) : [];
        plan.asignaciones = resumen.horarios_archivados ? (t.profesor_curso || []).filter(r => Number(r.activo) === 1).map(r => r.id) : [];
        const cfg = (t.configuracion_sistema || []).find(r => r.clave === 'anio_escolar_actual');
        plan.anioPrevio = cfg ? cfg.valor : null;
    } else {
        // Sin datos exactos: reglas seguras
        plan.fuente = 'reglas (no se encontró el respaldo de ese cierre)';
        plan.inscripciones = {};
        for (const e of estudiantes) {
            const [[fila]] = await conn.query(
                'SELECT id FROM estudiante_curso WHERE estudiante_id = ? AND curso_id = ? AND anio_academico <> ? ORDER BY id DESC LIMIT 1',
                [e.id, e.origen.id, cierre.anio_destino]);
            plan.inscripciones[e.id] = fila ? [fila.id] : [];
        }
        plan.cursosAnio = null; // se usa: anio_escolar destino -> origen
        plan.cursosCreados = [];
        if (resumen.totales && resumen.totales.secciones_nuevas) {
            plan.avisos.push('El cierre creó secciones nuevas. Si quedan vacías, bórrelas en Gestionar Secciones.');
        }
        plan.horarios = null; // se reactivan con reglas si el cierre los archivó
        plan.asignaciones = null;
        plan.anioPrevio = null;
    }
    // Carnets: el respaldo no los tiene; se toman los que anuló el cierre (misma hora del cierre)
    const [cs] = await conn.query(
        `SELECT id FROM carnets WHERE motivo_anulado = 'Cierre de periodo' AND anio_academico = ?
           AND ABS(TIMESTAMPDIFF(SECOND, fecha_anulado, (SELECT fecha FROM promociones WHERE id = ?))) <= 300`,
        [cierre.anio_origen, cierre.id]);
    plan.carnets = cs.map(r => r.id);
    return plan;
}

const lista = (ids) => (ids && ids.length ? ids.map(Number).filter(Number.isFinite) : [0]);


// Último cierre y si se puede deshacer
async function ultimoCierre(db, conPdf = false) {
    const [[cierre]] = await db.query(`SELECT id, anio_origen, anio_destino, fecha, resumen${conPdf ? ', pdf, pdf_nombre' : ''} FROM promociones ORDER BY id DESC LIMIT 1`);
    if (!cierre) return { error: 'No hay ningún cierre de periodo para deshacer.' };
    const origen = Number(cierre.anio_origen), destino = Number(cierre.anio_destino);
    const [[cfg]] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'anio_escolar_actual'");
    if (cfg && Number(cfg.valor) !== destino) {
        return { error: `El periodo actual es ${textoPeriodo(cfg.valor)} y el último cierre fue de ${textoPeriodo(origen)} a ${textoPeriodo(destino)}. No se puede deshacer.` };
    }
    let resumen;
    try { resumen = JSON.parse(cierre.resumen); } catch { return { error: 'El resumen de ese cierre está dañado. No se puede deshacer.' }; }
    return { cierre, resumen, origen, destino };
}

// Qué pasaría al deshacer (para mostrarlo antes de confirmar)
async function vistaDeshacer(db) {
    const u = await ultimoCierre(db);
    if (u.error) return { posible: false, mensaje: u.error };
    const { cierre, resumen, origen, destino } = u;
    const plan = await armarPlan(db, cierre, resumen);
    const cuenta = (d) => plan.estudiantes.filter(e => e.decision === d).length;
    const [[a]] = await db.query('SELECT COUNT(*) AS n FROM asistencia WHERE fecha >= (SELECT DATE(fecha) FROM promociones WHERE id = ?)', [cierre.id]);
    return {
        posible: true, id: cierre.id, fecha: cierre.fecha,
        periodo: textoPeriodo(origen), periodo_siguiente: textoPeriodo(destino),
        estudiantes: plan.estudiantes.length, pasaron: cuenta('pasa'), repitieron: cuenta('repite'), egresaron: cuenta('egresa'),
        horarios_archivados: !!resumen.horarios_archivados,
        secciones_nuevas: (resumen.totales && resumen.totales.secciones_nuevas) || 0,
        fuente: plan.fuente, exacto: !/^reglas/.test(plan.fuente), avisos: plan.avisos,
        asistencias_desde: Number(a.n)
    };
}

// Deshace el último cierre. Si se da "id", solo deshace ese (por si otra persona hizo algo mientras tanto).
async function deshacerUltimo(db, { id = null } = {}) {
    const u = await ultimoCierre(db, true);
    if (u.error) throw new ErrorDeshacer(u.error);
    const { cierre, resumen, origen, destino } = u;
    if (id && Number(id) !== Number(cierre.id)) throw new ErrorDeshacer('El último cierre cambió. Recargue la página y revise otra vez.');

    let respaldo = '';
    try { respaldo = path.basename(await respaldarJSON(db, 'Antes de deshacer el cierre de periodo')); } catch { /* en la nube el disco puede no guardar: la transacción igual protege */ }

    const conn = await db.getConnection();
    try {
        const plan = await armarPlan(conn, cierre, resumen);
        await conn.beginTransaction();
        const avisos = [];

        // 1) Cada estudiante a su sección de antes
        const omitidos = [];
        for (const e of plan.estudiantes) {
            const [[existe]] = await conn.query('SELECT id FROM usuarios WHERE id = ?', [e.id]);
            if (!existe) { omitidos.push(`${e.nombre} ${e.apellido} (ya no existe)`); continue; }
            const previas = (plan.inscripciones[e.id] || []).map(Number);
            await conn.query('DELETE FROM estudiante_curso WHERE estudiante_id = ? AND anio_academico = ? AND id NOT IN (?)', [e.id, destino, lista(previas)]);
            await conn.query('UPDATE estudiante_curso SET activo = 0 WHERE estudiante_id = ? AND activo = 1 AND id NOT IN (?)', [e.id, lista(previas)]);
            let ok = 0;
            if (previas.length) {
                const [r] = await conn.query('UPDATE estudiante_curso SET activo = 1 WHERE estudiante_id = ? AND id IN (?)', [e.id, previas]);
                ok = r.affectedRows;
            }
            if (!ok) {
                const [[sec]] = await conn.query('SELECT id FROM cursos WHERE id = ?', [e.origen.id]);
                if (sec) await conn.query('INSERT INTO estudiante_curso (estudiante_id, curso_id, anio_academico, activo) VALUES (?, ?, ?, 1)', [e.id, e.origen.id, origen]);
                else omitidos.push(`${e.nombre} ${e.apellido} (su sección de antes ya no existe: asígnela en Asignar Estudiante)`);
            }
            if (e.decision === 'egresa') await conn.query('UPDATE usuarios SET activo = 1 WHERE id = ?', [e.id]);
            const sec = `${e.origen.nombre} ${e.origen.seccion}${e.origen.turno ? ' · ' + e.origen.turno : ''}`;
            avisos.push([e.id, sec]);
        }

        // 2) Año escolar de las secciones
        if (plan.cursosAnio) {
            for (const [id, anio] of Object.entries(plan.cursosAnio)) {
                await conn.query('UPDATE cursos SET anio_escolar = ? WHERE id = ?', [anio, id]);
            }
        } else {
            await conn.query('UPDATE cursos SET anio_escolar = ? WHERE anio_escolar = ?', [origen, destino]);
        }

        // 3) Secciones que creó el cierre: se borran solo si quedaron vacías y sin historial
        const borradas = [], quedan = [];
        for (const id of plan.cursosCreados) {
            const [[u]] = await conn.query(`SELECT
                (SELECT COUNT(*) FROM estudiante_curso WHERE curso_id = ?) +
                (SELECT COUNT(*) FROM profesor_curso WHERE curso_id = ?) +
                (SELECT COUNT(*) FROM horarios_clase WHERE curso_id = ?) +
                (SELECT COUNT(*) FROM asistencia WHERE curso_id = ?) AS n`, [id, id, id, id]);
            const [[c]] = await conn.query('SELECT nombre, seccion, turno FROM cursos WHERE id = ?', [id]);
            if (!c) continue;
            const nom = `${c.nombre} ${c.seccion}${c.turno ? ' · ' + c.turno : ''}`;
            if (Number(u.n) === 0) { await conn.query('DELETE FROM cursos WHERE id = ?', [id]); borradas.push(nom); }
            else quedan.push(nom);
        }

        // 4) Horarios y asignaciones archivados por el cierre
        if (resumen.horarios_archivados) {
            if (plan.horarios) {
                if (plan.horarios.length) await conn.query('UPDATE horarios_clase SET activo = 1 WHERE id IN (?)', [plan.horarios]);
                if (plan.asignaciones.length) await conn.query('UPDATE profesor_curso SET activo = 1 WHERE id IN (?)', [plan.asignaciones]);
            } else {
                await conn.query('UPDATE profesor_curso SET activo = 1 WHERE activo = 0 AND anio_academico = ?', [origen]);
                await conn.query(`UPDATE horarios_clase h JOIN profesor_curso pc
                    ON pc.profesor_id = h.profesor_id AND pc.curso_id = h.curso_id AND pc.materia = h.materia AND pc.activo = 1
                    SET h.activo = 1 WHERE h.activo = 0`);
            }
        }

        // 5) Carnets: los del periodo nuevo se anulan; los de antes vuelven a servir
        const [cn] = await conn.query("UPDATE carnets SET activo = 0, fecha_anulado = NOW(), motivo_anulado = 'Se deshizo el cierre de periodo' WHERE activo = 1 AND anio_academico = ?", [destino]);
        let carnetsVuelven = 0;
        if (plan.carnets.length) {
            const [cv] = await conn.query('UPDATE carnets SET activo = 1, fecha_anulado = NULL, motivo_anulado = NULL WHERE id IN (?) AND activo = 0', [plan.carnets]);
            carnetsVuelven = cv.affectedRows;
        }

        // 6) Periodo en curso
        await conn.query(
            "INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES ('anio_escolar_actual', ?, 'Año escolar en curso (lo cambia el cierre de periodo)') ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
            [String(plan.anioPrevio && /^\d{4}$/.test(String(plan.anioPrevio)) ? plan.anioPrevio : origen)]);

        // 7) El acta se guarda en un archivo y el cierre sale del historial
        let actaArchivo = '';
        if (cierre.pdf) {
            try {
                fs.mkdirSync(CARPETA_RESPALDOS, { recursive: true });
                const base = (cierre.pdf_nombre || `Acta_cierre_${origen}.pdf`).replace(/\.pdf$/i, '') + '_DESHECHO';
                actaArchivo = path.join(CARPETA_RESPALDOS, base + '.pdf');
                for (let i = 2; fs.existsSync(actaArchivo); i++) actaArchivo = path.join(CARPETA_RESPALDOS, `${base}_${i}.pdf`);
                fs.writeFileSync(actaArchivo, cierre.pdf);
            } catch { actaArchivo = ''; }
        }
        await conn.query('DELETE FROM promociones WHERE id = ?', [cierre.id]);
        await conn.commit();


        for (const [idEst, sec] of avisos) {
            await notificar(db, idEst, 'Se deshizo el paso de año',
                `La dirección deshizo el cierre de periodo. Usted sigue en ${sec} (periodo ${textoPeriodo(origen)}) y su carnet anterior vuelve a servir.`,
                '/interfaces/estudiante/perfil.html').catch(() => {});
        }
        return {
            periodo: textoPeriodo(origen), periodo_deshecho: textoPeriodo(destino), fuente: plan.fuente,
            devueltos: avisos.length, carnets_vuelven: carnetsVuelven, carnets_anulados: cn.affectedRows,
            secciones_borradas: borradas, secciones_dejadas: quedan, omitidos,
            acta: actaArchivo ? path.basename(actaArchivo) : '', respaldo,
            hay_otro: await hayOtro(db)
        };
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
}

// ¿Hay otro cierre antes que también se pueda deshacer? (cierres seguidos)
async function hayOtro(db) {
    const [[c]] = await db.query('SELECT anio_destino FROM promociones ORDER BY id DESC LIMIT 1');
    if (!c) return false;
    const [[cfg]] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'anio_escolar_actual'");
    return !cfg || Number(cfg.valor) === Number(c.anio_destino);
}

module.exports = { vistaDeshacer, deshacerUltimo, hayOtro, ErrorDeshacer };
