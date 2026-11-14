// Cierre de periodo: pasar a los estudiantes al año siguiente.
//  - 1er Grado → … → 6to Grado → 1er Año → … → 5to Año → 6to Año (técnico) → egresa.
//  - En 5to Año el director elige por estudiante: egresa (bachiller) o pasa a 6to Año.
//  - El director marca quién repite. Se conserva la letra y el turno de la sección.
//  - Pide contraseña + clave de seguridad + escribir PROMOVER. Todo en una sola transacción.
//  - Se guarda un acta en PDF en la base de datos (en la nube el disco se borra al volver a publicar).
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sinAcentos } = require('../lib/util');
const { anioEscolarActual, textoPeriodo } = require('../lib/periodo');
const { respaldarJSON } = require('../lib/migraciones');
const { notificar } = require('../lib/notificar');
const { minutosBloqueo, sumarFallo, limpiarFallos, mensajeBloqueo } = require('../lib/intentos');
const { vistaDeshacer, deshacerUltimo, ErrorDeshacer } = require('../lib/deshacer_cierre');

// Contraseña de entrada + clave de seguridad del director (pasar de año y deshacerlo).
// Si algo falla, responde y devuelve false.
async function verificarIdentidad(req, res) {
    const { password, clave_seguridad } = req.body || {};
    const llave = 'promocion:' + req.usuario.id;
    const espera = minutosBloqueo(llave);
    if (espera) { res.status(429).json({ estado: 'error', mensaje: mensajeBloqueo(espera) }); return false; }
    try {
        const [[dir]] = await db.query('SELECT nombre, apellido, password FROM usuarios WHERE id = ?', [req.usuario.id]);
        if (!dir || !(await bcrypt.compare(String(password || ''), dir.password || '').catch(() => false))) {
            sumarFallo(llave);
            res.status(403).json({ estado: 'error', mensaje: 'Su contraseña no es correcta.' });
            return false;
        }
        const [[k]] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'clave_seguridad_director'");
        if (!k || !k.valor) { res.status(400).json({ estado: 'error', mensaje: 'Primero configure su clave de seguridad en Configuración.' }); return false; }
        if (!(await bcrypt.compare(String(clave_seguridad || ''), k.valor).catch(() => false))) {
            sumarFallo(llave);
            res.status(403).json({ estado: 'error', mensaje: 'La clave de seguridad no es correcta.' });
            return false;
        }
        limpiarFallos(llave);
        return true;
    } catch (err) {
        console.error(err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo verificar la identidad.' });
        return false;
    }
}
const Exportar = require('../js/exportar');

const CADENA = ['1er Grado', '2do Grado', '3er Grado', '4to Grado', '5to Grado', '6to Grado',
    '1er Año', '2do Año', '3er Año', '4to Año', '5to Año', '6to Año'];
const clave = (n) => sinAcentos(n).replace(/\s+/g, ' ').trim();
const POS = new Map(CADENA.map((n, i) => [clave(n), i]));
const nivelDe = (nombre) => (/grado/i.test(nombre) ? 'Primaria' : clave(nombre) === clave('6to Año') ? 'Téc. Medio' : 'Media');

// Qué puede pasarle a un estudiante según su grado
function opcionesDe(nombre) {
    const i = POS.get(clave(nombre));
    if (i === undefined) return { conocido: false, opciones: ['pasa', 'repite', 'egresa'], defecto: 'pasa', siguiente: null };
    if (i === CADENA.length - 1) return { conocido: true, opciones: ['egresa', 'repite'], defecto: 'egresa', siguiente: null };
    if (CADENA[i] === '5to Año') return { conocido: true, opciones: ['pasa', 'egresa', 'repite'], defecto: 'pasa', siguiente: CADENA[i + 1] };
    return { conocido: true, opciones: ['pasa', 'repite'], defecto: 'pasa', siguiente: CADENA[i + 1] };
}

async function armarPlan(conn) {
    const anio = await anioEscolarActual(conn);
    const [cursos] = await conn.query('SELECT id, nombre, seccion, turno, nivel, anio_escolar FROM cursos WHERE activo = 1');
    const [ests] = await conn.query(`
        SELECT u.id, u.nombre, u.apellido, u.cedula, ec.curso_id, ec.id AS ec_id
        FROM estudiante_curso ec JOIN usuarios u ON u.id = ec.estudiante_id
        WHERE ec.activo = 1 AND u.activo = 1 AND u.rol = 'estudiante'
        ORDER BY u.apellido, u.nombre`);
    const secciones = [];
    for (const c of cursos) {
        const lista = ests.filter(e => e.curso_id === c.id);
        if (!lista.length) continue;
        const op = opcionesDe(c.nombre);
        let destino = null;
        if (op.siguiente) {
            // Misma letra; primero el mismo turno, si no, una sección donde el turno no esté definido
            const letra = (x) => String(x.seccion || '').trim().toUpperCase();
            const mismaLetra = cursos.filter(x => clave(x.nombre) === clave(op.siguiente) && letra(x) === letra(c));
            // (si en el grado de origen hay mañana y tarde con la misma letra, no se mezclan)
            const hermanas = cursos.filter(x => clave(x.nombre) === clave(c.nombre) && letra(x) === letra(c)).length;
            const existente = mismaLetra.find(x => String(x.turno || '') === String(c.turno || ''))
                || ((!c.turno || hermanas === 1) ? (mismaLetra.find(x => !x.turno) || (!c.turno && mismaLetra[0])) : null);
            destino = existente
                ? { id: existente.id, nombre: existente.nombre, seccion: existente.seccion, turno: existente.turno, nuevo: false }
                : { id: null, nombre: op.siguiente, seccion: c.seccion, turno: c.turno, nivel: nivelDe(op.siguiente), nuevo: true };
        }
        secciones.push({
            curso: { id: c.id, nombre: c.nombre, seccion: c.seccion, turno: c.turno, nivel: c.nivel },
            orden: POS.has(clave(c.nombre)) ? POS.get(clave(c.nombre)) : 99,
            conocido: op.conocido, opciones: op.opciones, defecto: op.defecto, destino,
            estudiantes: lista.map(e => ({ id: e.id, nombre: e.nombre, apellido: e.apellido, cedula: e.cedula }))
        });
    }
    secciones.sort((a, b) => a.orden - b.orden || String(a.curso.seccion).localeCompare(String(b.curso.seccion)) || String(a.curso.turno || '').localeCompare(String(b.curso.turno || '')));
    return { anio, siguiente: anio + 1, periodo: textoPeriodo(anio), periodo_siguiente: textoPeriodo(anio + 1), secciones, cursos };
}

router.get('/vista-previa', async (req, res) => {
    try {
        const plan = await armarPlan(db);
        const [[k]] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'clave_seguridad_director'");
        const [cursos] = await db.query('SELECT id, nombre, seccion, turno FROM cursos WHERE activo = 1 ORDER BY nombre, seccion, turno');
        res.json({
            estado: 'exitoso',
            anio: plan.anio, periodo: plan.periodo, periodo_siguiente: plan.periodo_siguiente,
            clave_configurada: !!(k && k.valor),
            secciones: plan.secciones, cursos
        });
    } catch (err) {
        console.error('Error en vista previa de promoción:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo armar la vista previa.' });
    }
});

const TXT = { pasa: 'Pasa', repite: 'Repite', egresa: 'Egresa' };

function actaPDF(resumen, director) {
    const doc = new Exportar.Pdf();
    let escudo = null;
    try { escudo = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'css', 'escudo_pdf.jpg'))); } catch { /* sin escudo */ }
    doc.pie = `Acta de cierre del periodo ${resumen.periodo} · Generada el ${new Date(resumen.fecha).toLocaleString('es-VE')}`;
    Exportar.encabezado(doc, {
        escudo, titulo: `Acta de cierre del periodo ${resumen.periodo}`,
        lineas: [`Pase al periodo ${resumen.periodo_siguiente} · Fecha: ${new Date(resumen.fecha).toLocaleDateString('es-VE')}`, `Director: ${director}`]
    });
    const t = resumen.totales;
    doc.parrafo(`Resumen: ${t.estudiantes} estudiantes. Pasan de año: ${t.pasa}. Repiten: ${t.repite}. Egresan: ${t.egresa} (en 5to Año: ${t.egresa_5to}; en 6to Año, técnico medio: ${t.egresa_6to}). Secciones nuevas creadas: ${t.secciones_nuevas}.${resumen.horarios_archivados ? ' Los horarios y asignaciones de profesores del periodo anterior quedaron archivados; el director carga los del nuevo periodo.' : ''}`, { tam: 10 });
    doc.y += 8;
    for (const s of resumen.secciones) {
        doc.espacio(70);
        const origen = `${s.curso.nombre} ${s.curso.seccion}${s.curso.turno ? ' · ' + s.curso.turno : ''}`;
        const dest = s.destino ? `${s.destino.nombre} ${s.destino.seccion}${s.destino.turno ? ' · ' + s.destino.turno : ''}` : 'Egreso';
        doc.texto(`${origen}  →  ${dest}`, doc.margen, doc.y, { tam: 11, negrita: true, color: [20, 48, 107] });
        doc.y += 16;
        doc.tabla({
            columnas: [
                { titulo: 'N°', ancho: 24, alinear: 'centro' }, { titulo: 'Cédula', ancho: 66 }, { titulo: 'Estudiante', ancho: 190 },
                { titulo: 'Decisión', ancho: 70 }, { titulo: 'Nueva sección / condición', ancho: doc.ancho - doc.margen * 2 - 350 }
            ],
            filas: s.estudiantes.map((e, i) => [i + 1, e.cedula, `${e.apellido}, ${e.nombre}`, TXT[e.decision],
                e.decision === 'egresa' ? (e.egreso || 'Egresado') : e.destino_texto]),
            filaColor: (i) => (s.estudiantes[i].decision === 'repite' ? [255, 244, 229] : s.estudiantes[i].decision === 'egresa' ? [232, 244, 236] : null)
        });
        doc.y += 14;
    }
    doc.espacio(90);
    doc.y += 30;
    doc.linea(doc.margen, doc.y, doc.margen + 200, doc.y, { color: [40, 40, 40] });
    doc.texto(`Firma del director: ${director}`, doc.margen, doc.y + 4, { tam: 9 });
    doc.linea(doc.ancho - doc.margen - 200, doc.y, doc.ancho - doc.margen, doc.y, { color: [40, 40, 40] });
    doc.texto('Sello de la institución', doc.ancho - doc.margen - 200, doc.y + 4, { tam: 9 });
    return Buffer.from(doc.terminar());
}

router.post('/ejecutar', async (req, res) => {
    const { confirmacion } = req.body || {};
    const decisiones = (req.body && req.body.decisiones) || {};
    const destinos = (req.body && req.body.destinos) || {};
    const archivarHorarios = !(req.body && req.body.archivar_horarios === false);

    if (String(confirmacion || '').trim().toUpperCase() !== 'PROMOVER') {
        return res.status(400).json({ estado: 'error', mensaje: 'Escriba la palabra PROMOVER para confirmar.' });
    }
    if (!(await verificarIdentidad(req, res))) return;

    try { await respaldarJSON(db, 'Antes del cierre de periodo'); } catch { /* en la nube el disco puede no guardar: la transacción igual protege */ }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const plan = await armarPlan(conn);
        if (!plan.secciones.length) {
            await conn.rollback();
            return res.status(400).json({ estado: 'error', mensaje: 'No hay estudiantes activos en ninguna sección.' });
        }
        // Revisar todas las decisiones antes de tocar nada
        const errores = [];
        for (const s of plan.secciones) {
            const elegido = destinos[s.curso.id];
            const tieneDestino = !!s.destino || (elegido && elegido !== 'auto');
            for (const e of s.estudiantes) {
                const d = decisiones[e.id];
                if (d !== undefined && !s.opciones.includes(d)) {
                    errores.push(`${e.nombre} ${e.apellido} (${s.curso.nombre} ${s.curso.seccion}): esa decisión no está permitida para su grado.`);
                } else if ((d || s.defecto) === 'pasa' && !tieneDestino) {
                    errores.push(`Elija a qué sección pasan los estudiantes de ${s.curso.nombre} ${s.curso.seccion}.`);
                }
            }
        }
        if (errores.length) {
            await conn.rollback();
            return res.status(400).json({ estado: 'error', mensaje: [...new Set(errores)].slice(0, 4).join(' ') });
        }
        const siguiente = plan.siguiente;
        const resumen = {
            periodo: plan.periodo, periodo_siguiente: plan.periodo_siguiente, fecha: new Date().toISOString(),
            horarios_archivados: archivarHorarios, secciones: [],
            totales: { estudiantes: 0, pasa: 0, repite: 0, egresa: 0, egresa_5to: 0, egresa_6to: 0, secciones_nuevas: 0 }
        };
        const avisos = [];
        const creadas = new Map();

        // Lo necesario para poder deshacer este cierre después (herramienta deshacer_cierre.js)
        const leer = async (sql, p = []) => (await conn.query(sql, p))[0];
        const deshacer = {
            anio_actual_previo: ((await leer("SELECT valor FROM configuracion_sistema WHERE clave = 'anio_escolar_actual'"))[0] || {}).valor || null,
            cursos_anio: Object.fromEntries((await leer('SELECT id, anio_escolar FROM cursos WHERE activo = 1')).map(c => [c.id, c.anio_escolar])),
            horarios_ids: archivarHorarios ? (await leer('SELECT id FROM horarios_clase WHERE activo = 1')).map(r => r.id) : [],
            asignaciones_ids: archivarHorarios ? (await leer('SELECT id FROM profesor_curso WHERE activo = 1')).map(r => r.id) : [],
            carnets_ids: (await leer('SELECT id FROM carnets WHERE activo = 1')).map(r => r.id),
            inscripciones: {},
            cursos_creados: []
        };

        for (const s of plan.secciones) {
            // Destino: el elegido por el director o el automático (se crea si no existe)
            let destino = null;
            const elegido = destinos[s.curso.id];
            if (elegido && elegido !== 'auto') {
                const c = plan.cursos.find(x => String(x.id) === String(elegido));
                if (!c) throw new Error(`La sección destino elegida para ${s.curso.nombre} ${s.curso.seccion} no existe.`);
                destino = { id: c.id, nombre: c.nombre, seccion: c.seccion, turno: c.turno };
            } else if (s.destino) {
                destino = { ...s.destino };
                if (!destino.id) {
                    const llave = `${clave(destino.nombre)}|${destino.seccion}|${destino.turno || ''}`;
                    if (!creadas.has(llave)) {
                        const [r] = await conn.query('INSERT INTO cursos (nombre, nivel, seccion, turno, anio_escolar, activo) VALUES (?, ?, ?, ?, ?, 1)',
                            [destino.nombre, destino.nivel, destino.seccion, destino.turno || null, siguiente]);
                        creadas.set(llave, r.insertId);
                        deshacer.cursos_creados.push(r.insertId);
                        resumen.totales.secciones_nuevas++;
                    }
                    destino.id = creadas.get(llave);
                }
            }
            const textoDestino = destino ? `${destino.nombre} ${destino.seccion}${destino.turno ? ' · ' + destino.turno : ''}` : '';
            const textoOrigen = `${s.curso.nombre} ${s.curso.seccion}${s.curso.turno ? ' · ' + s.curso.turno : ''}`;
            const filaSec = { curso: s.curso, destino, estudiantes: [] };

            for (const e of s.estudiantes) {
                const decision = decisiones[e.id] || s.defecto; // ya revisada arriba
                deshacer.inscripciones[e.id] = (await leer('SELECT id FROM estudiante_curso WHERE estudiante_id = ? AND activo = 1', [e.id])).map(r => r.id);

                await conn.query('UPDATE estudiante_curso SET activo = 0 WHERE estudiante_id = ? AND activo = 1', [e.id]);
                let destinoTexto = '', egreso = '';
                if (decision === 'pasa') {
                    await conn.query('INSERT INTO estudiante_curso (estudiante_id, curso_id, anio_academico, activo) VALUES (?, ?, ?, 1)', [e.id, destino.id, siguiente]);
                    destinoTexto = textoDestino;
                    avisos.push([e.id, `Pasó a ${textoDestino}`, `En el periodo ${plan.periodo_siguiente} está en ${textoDestino}. Su carnet anterior ya no sirve: pida el nuevo.`]);
                } else if (decision === 'repite') {
                    await conn.query('INSERT INTO estudiante_curso (estudiante_id, curso_id, anio_academico, activo) VALUES (?, ?, ?, 1)', [e.id, s.curso.id, siguiente]);
                    destinoTexto = `${textoOrigen} (repite)`;
                    avisos.push([e.id, 'Periodo nuevo', `En el periodo ${plan.periodo_siguiente} sigue en ${textoOrigen}. Su carnet anterior ya no sirve: pida el nuevo.`]);
                } else {
                    // Egresa: la cuenta queda inactiva; su historial se conserva
                    await conn.query('UPDATE usuarios SET activo = 0 WHERE id = ?', [e.id]);
                    const en6to = clave(s.curso.nombre) === clave('6to Año');
                    egreso = en6to ? 'Egresado de 6to Año (técnico medio)' : `Egresado de ${s.curso.nombre}`;
                    resumen.totales[en6to ? 'egresa_6to' : 'egresa_5to']++;
                }
                resumen.totales[decision]++;
                resumen.totales.estudiantes++;
                filaSec.estudiantes.push({ id: e.id, cedula: e.cedula, nombre: e.nombre, apellido: e.apellido, decision, destino_texto: destinoTexto, egreso });
            }
            resumen.secciones.push(filaSec);
        }

        // Periodo nuevo: secciones activas, horarios/asignaciones archivados, carnets anulados
        await conn.query('UPDATE cursos SET anio_escolar = ? WHERE activo = 1', [siguiente]);
        if (archivarHorarios) {
            await conn.query('UPDATE horarios_clase SET activo = 0 WHERE activo = 1');
            await conn.query('UPDATE profesor_curso SET activo = 0 WHERE activo = 1');
        }
        await conn.query("UPDATE carnets SET activo = 0, fecha_anulado = NOW(), motivo_anulado = 'Cierre de periodo' WHERE activo = 1");
        await conn.query(
            "INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES ('anio_escolar_actual', ?, 'Año escolar en curso (lo cambia el cierre de periodo)') ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
            [String(siguiente)]
        );

        resumen.deshacer = deshacer;
        const director = `${req.usuario.nombre} ${req.usuario.apellido}`;
        const pdf = actaPDF(resumen, director);
        const nombrePdf = `Acta_cierre_${plan.periodo}.pdf`;
        const [r] = await conn.query(
            'INSERT INTO promociones (anio_origen, anio_destino, director_id, resumen, pdf, pdf_nombre) VALUES (?, ?, ?, ?, ?, ?)',
            [plan.anio, siguiente, req.usuario.id, JSON.stringify(resumen), pdf, nombrePdf]
        );
        await conn.commit();

        for (const [id, titulo, msg] of avisos) {
            await notificar(db, id, titulo, msg, '/interfaces/estudiante/perfil.html').catch(() => {});
        }
        res.json({ estado: 'exitoso', mensaje: `Listo. El periodo ahora es ${plan.periodo_siguiente}.`, id: r.insertId, totales: resumen.totales });
    } catch (err) {
        await conn.rollback().catch(() => {});
        console.error('Error en cierre de periodo:', err);
        res.status(500).json({ estado: 'error', mensaje: `No se hizo ningún cambio. ${err.message || ''}`.trim() });
    } finally {
        conn.release();
    }
});

// Deshacer el último cierre: qué pasaría
router.get('/deshacer', async (req, res) => {
    try {
        res.json({ estado: 'exitoso', ...(await vistaDeshacer(db)) });
    } catch (err) {
        console.error('Error al revisar el último cierre:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo revisar el último cierre.' });
    }
});

// Deshacer el último cierre (pide contraseña, clave de seguridad y escribir DESHACER)
router.post('/deshacer', async (req, res) => {
    const { confirmacion, id } = req.body || {};
    if (String(confirmacion || '').trim().toUpperCase() !== 'DESHACER') {
        return res.status(400).json({ estado: 'error', mensaje: 'Escriba la palabra DESHACER para confirmar.' });
    }
    if (!(await verificarIdentidad(req, res))) return;
    try {
        const r = await deshacerUltimo(db, { id });
        const partes = [`Listo. El periodo vuelve a ser ${r.periodo}.`, `${r.devueltos} estudiante(s) volvieron a su sección de antes.`];
        if (r.carnets_vuelven) partes.push(`${r.carnets_vuelven} carnet(s) QR de antes vuelven a servir.`);
        if (r.secciones_borradas.length) partes.push(`Se borraron las secciones que había creado el cierre: ${r.secciones_borradas.join(', ')}.`);
        if (r.omitidos.length) partes.push(`Revise a mano: ${r.omitidos.join('; ')}.`);
        res.json({ estado: 'exitoso', mensaje: partes.join(' '), ...r });
    } catch (err) {
        if (err instanceof ErrorDeshacer) return res.status(400).json({ estado: 'error', mensaje: err.message });
        console.error('Error al deshacer el cierre:', err);
        res.status(500).json({ estado: 'error', mensaje: `No se hizo ningún cambio. ${err.message || ''}`.trim() });
    }
});

router.get('/historial', async (req, res) => {
    try {
        const [filas] = await db.query(`
            SELECT p.id, p.anio_origen, p.anio_destino, p.fecha, p.resumen, p.pdf_nombre, CONCAT(u.nombre, ' ', u.apellido) AS director
            FROM promociones p LEFT JOIN usuarios u ON u.id = p.director_id ORDER BY p.id DESC`);
        res.json({
            estado: 'exitoso',
            datos: filas.map(f => {
                let t = {};
                try { t = JSON.parse(f.resumen).totales || {}; } catch { /* resumen dañado */ }
                return { id: f.id, periodo: textoPeriodo(f.anio_origen), periodo_siguiente: textoPeriodo(f.anio_destino), fecha: f.fecha, director: f.director, totales: t, pdf_nombre: f.pdf_nombre };
            })
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo leer el historial.' });
    }
});

router.get('/acta/:id', async (req, res) => {
    try {
        const [[f]] = await db.query('SELECT pdf, pdf_nombre FROM promociones WHERE id = ?', [req.params.id]);
        if (!f || !f.pdf) return res.status(404).json({ estado: 'error', mensaje: 'Acta no encontrada.' });
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `attachment; filename="${f.pdf_nombre || 'acta.pdf'}"`);
        res.send(f.pdf);
    } catch (err) {
        console.error(err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo leer el acta.' });
    }
});

module.exports = router;
