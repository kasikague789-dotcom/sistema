const express = require('express');
const router = express.Router();
const db = require('../db');
const { soloRoles, soloPropio } = require('../lib/auth');
const { hoyLocal, horaLocal, esFechaValida, normalizarEstado, nombreDia, sinAcentos } = require('../lib/util');
const mismaMateria = (a, b) => sinAcentos(a).trim() === sinAcentos(b).trim();
const { notificar, fechaBonita } = require('../lib/notificar');

// Director: todos los registros de un día (una fila por clase)
// + los estudiantes que ese día no tienen ningún registro ("sin marcar").
router.get('/', soloRoles('director'), async (req, res) => {
    try {
        const fechaReq = esFechaValida(req.query.fecha) ? req.query.fecha : hoyLocal();

        const [registros] = await db.query(`
            SELECT
                u.id, u.nombre, u.apellido, u.cedula,
                COALESCE(NULLIF(a.curso_id, 0), ec.curso_id) AS curso_id,
                COALESCE(ca.nombre, c.nombre) AS curso,
                COALESCE(ca.seccion, c.seccion) AS seccion, COALESCE(ca.turno, c.turno) AS turno,
                a.id AS asistencia_id,
                a.materia,
                a.hora_entrada,
                a.estado,
                a.metodo,
                a.observaciones
            FROM asistencia a
            INNER JOIN usuarios u ON a.usuario_id = u.id
            LEFT JOIN cursos ca ON ca.id = a.curso_id
            LEFT JOIN estudiante_curso ec ON u.id = ec.estudiante_id AND ec.activo = 1
            LEFT JOIN cursos c ON ec.curso_id = c.id
            WHERE a.fecha = ? AND u.rol = 'estudiante' AND u.activo = 1
            ORDER BY curso ASC, seccion ASC, u.apellido ASC, u.nombre ASC, a.materia ASC
        `, [fechaReq]);

        const [sinMarcar] = await db.query(`
            SELECT u.id, u.nombre, u.apellido, u.cedula,
                   c.id AS curso_id, c.nombre AS curso, c.seccion, c.turno,
                   NULL AS asistencia_id, '' AS materia, NULL AS hora_entrada,
                   'sin_marcar' AS estado, NULL AS metodo, NULL AS observaciones
            FROM usuarios u
            LEFT JOIN estudiante_curso ec ON u.id = ec.estudiante_id AND ec.activo = 1
            LEFT JOIN cursos c ON ec.curso_id = c.id
            WHERE u.rol = 'estudiante' AND u.activo = 1
              AND NOT EXISTS (SELECT 1 FROM asistencia a WHERE a.usuario_id = u.id AND a.fecha = ?)
            ORDER BY c.nombre ASC, c.seccion ASC, u.apellido ASC, u.nombre ASC
        `, [fechaReq]);

        const [cursos] = await db.query('SELECT id, nombre, seccion, turno FROM cursos WHERE activo = 1 ORDER BY nombre, seccion, turno');

        res.json({ fecha: fechaReq, estudiantes: [...registros, ...sinMarcar], cursos });
    } catch (err) {
        console.error('Error al obtener asistencia:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener la asistencia' });
    }
});


// Lista diaria para exportar (PDF / Excel): por sección y materia, con hora y cómo se marcó.
// Director: cualquier sección (o todas). Profesor: solo sus clases.
router.get('/lista-diaria', soloRoles('director', 'profesor'), async (req, res) => {
    try {
        const fecha = esFechaValida(req.query.fecha) ? req.query.fecha : hoyLocal();
        const dia = nombreDia(fecha);
        const cursoId = req.query.curso_id ? Number(req.query.curso_id) : null;
        const materiaFiltro = String(req.query.materia || '').trim();

        let cursos;
        if (cursoId) {
            [cursos] = await db.query('SELECT id, nombre, seccion, turno, nivel FROM cursos WHERE id = ?', [cursoId]);
        } else {
            [cursos] = await db.query(`
                SELECT DISTINCT c.id, c.nombre, c.seccion, c.turno, c.nivel FROM cursos c
                JOIN estudiante_curso ec ON ec.curso_id = c.id AND ec.activo = 1
                WHERE c.activo = 1 ORDER BY c.nombre, c.seccion, c.turno`);
        }
        if (cursos.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Sección no encontrada.' });

        // El profesor solo exporta sus propias clases
        let propias = null;
        if (req.usuario.rol === 'profesor') {
            const [pc] = await db.query('SELECT curso_id, materia FROM profesor_curso WHERE profesor_id = ? AND activo = 1', [req.usuario.id]);
            // ...y las clases que cubre como suplente ese día
            const [sp] = await db.query('SELECT curso_id, materia FROM suplencias WHERE profesor_suplente_id = ? AND fecha = ?', [req.usuario.id, fecha]);
            propias = pc.concat(sp);
            if (!cursoId || !propias.some(x => Number(x.curso_id) === cursoId)) {
                return res.status(403).json({ estado: 'error', mensaje: 'Solo puede exportar las listas de sus clases.' });
            }
        }

        // Clases no dadas y suplencias de ese día
        const [noDadas] = await db.query('SELECT curso_id, materia, motivo FROM clases_no_dadas WHERE fecha = ?', [fecha]);
        const [sups] = await db.query(`SELECT s.curso_id, s.materia, CONCAT(u.nombre, ' ', u.apellido) AS suplente
            FROM suplencias s JOIN usuarios u ON u.id = s.profesor_suplente_id WHERE s.fecha = ?`, [fecha]);

        const secciones = [];
        for (const c of cursos) {
            const [ests] = await db.query(`
                SELECT DISTINCT u.id, u.nombre, u.apellido, u.cedula FROM estudiante_curso ec
                JOIN usuarios u ON u.id = ec.estudiante_id
                WHERE ec.curso_id = ? AND ec.activo = 1 AND u.activo = 1 AND u.rol = 'estudiante'
                ORDER BY u.apellido, u.nombre`, [c.id]);
            const [regs] = await db.query(`
                SELECT a.usuario_id, a.materia, a.estado, DATE_FORMAT(a.hora_entrada, '%H:%i') AS hora, a.metodo, a.observaciones,
                       CONCAT(p.nombre, ' ', p.apellido) AS profesor
                FROM asistencia a LEFT JOIN usuarios p ON p.id = a.profesor_id
                WHERE a.curso_id = ? AND a.fecha = ?`, [c.id, fecha]);
            const [bloques] = await db.query(`
                SELECT h.materia, DATE_FORMAT(h.hora_inicio, '%H:%i') AS inicio, DATE_FORMAT(h.hora_fin, '%H:%i') AS fin,
                       CONCAT(p.nombre, ' ', p.apellido) AS profesor
                FROM horarios_clase h JOIN usuarios p ON p.id = h.profesor_id
                WHERE h.curso_id = ? AND h.activo = 1 AND h.dia_semana = ?
                ORDER BY h.hora_inicio`, [c.id, dia]);

            // Materias del día: las del horario + las que tengan asistencia guardada
            const materias = [];
            const agregar = (m, extra) => {
                const k = (m || '').trim();
                if (!materias.some(x => mismaMateria(x.materia, k))) materias.push({ materia: k, ...extra });
            };
            bloques.forEach(b => agregar(b.materia, { inicio: b.inicio, fin: b.fin, profesor: b.profesor }));
            regs.forEach(r => agregar(r.materia, { inicio: '', fin: '', profesor: r.profesor || '' }));

            let clases = materias;
            if (materiaFiltro) clases = clases.filter(x => mismaMateria(x.materia, materiaFiltro));
            if (propias) clases = clases.filter(x => propias.some(p => Number(p.curso_id) === Number(c.id) && mismaMateria(p.materia, x.materia)));

            secciones.push({
                curso: c,
                clases: clases.map(cl => {
                    const nd = noDadas.find(x => x.curso_id === c.id && mismaMateria(x.materia, cl.materia));
                    const sp = sups.find(x => x.curso_id === c.id && mismaMateria(x.materia, cl.materia));
                    if (nd) {
                        // Clase no dada: no hay lista (nadie tiene falta)
                        return { ...cl, no_dada: nd.motivo, suplente: null, filas: [],
                            resumen: { presentes: 0, tarde: 0, ausentes: 0, justificadas: 0, sin_marcar: 0, total: ests.length } };
                    }
                    const filas = ests.map((e, i) => {
                        const r = regs.find(x => x.usuario_id === e.id && mismaMateria(x.materia, cl.materia));
                        const estado = r ? (normalizarEstado(r.estado) || r.estado) : 'sin_marcar';
                        return {
                            n: i + 1, cedula: e.cedula, estudiante: `${e.apellido}, ${e.nombre}`,
                            estado,
                            hora: r && (r.metodo === 'qr' || estado === 'presente' || estado === 'tarde') ? r.hora : '', metodo: r ? (r.metodo === 'qr' ? 'QR' : 'Manual') : '',
                            observaciones: r ? (r.observaciones || '') : ''
                        };
                    });
                    const cuenta = (e) => filas.filter(f => f.estado === e).length;
                    return {
                        ...cl, no_dada: null, suplente: sp ? sp.suplente : null, filas,
                        resumen: { presentes: cuenta('presente'), tarde: cuenta('tarde'), ausentes: cuenta('ausente'), justificadas: cuenta('justificada'), sin_marcar: cuenta('sin_marcar'), total: filas.length }
                    };
                })
            });
        }
        res.json({ estado: 'exitoso', fecha, dia, secciones });
    } catch (err) {
        console.error('Error en lista diaria:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo armar la lista del día.' });
    }
});

// Historial de un estudiante (el propio estudiante o el director)
router.get('/estudiante/:id', soloPropio('id'), async (req, res) => {
    const { id } = req.params;
    try {
        const [historial] = await db.query(`
            SELECT DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha, a.hora_entrada, a.estado, a.observaciones,
                   NULLIF(a.materia, '') AS materia
            FROM asistencia a
            WHERE a.usuario_id = ?
            ORDER BY a.fecha DESC, a.hora_entrada DESC
        `, [id]);

        historial.forEach(r => { r.estado = normalizarEstado(r.estado) || r.estado; });

        const stats = {
            presentes: historial.filter(r => r.estado === 'presente').length,
            ausentes: historial.filter(r => r.estado === 'ausente').length,
            tardes: historial.filter(r => r.estado === 'tarde').length,
            justificados: historial.filter(r => r.estado === 'justificada').length,
        };

        res.json({ historial, stats });
    } catch (err) {
        console.error('Error al obtener asistencia del estudiante:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener la asistencia' });
    }
});


// Director: corregir un registro (por asistencia_id) o crear uno general del día
router.put('/:usuario_id', soloRoles('director'), async (req, res) => {
    const { usuario_id } = req.params;
    const { fecha, hora_entrada, observaciones, asistencia_id } = req.body || {};
    const estado = normalizarEstado(req.body && req.body.estado);

    if (!esFechaValida(fecha)) {
        return res.status(400).json({ estado: 'error', mensaje: 'La fecha no es válida.' });
    }
    if (!estado) {
        return res.status(400).json({ estado: 'error', mensaje: 'Estado inválido. Use: presente, ausente, tarde o justificada.' });
    }
    if (fecha > hoyLocal()) {
        return res.status(400).json({ estado: 'error', mensaje: 'No se puede registrar asistencia en una fecha futura.' });
    }

    try {
        const [est] = await db.query("SELECT id FROM usuarios WHERE id = ? AND rol = 'estudiante'", [usuario_id]);
        if (est.length === 0) {
            return res.status(404).json({ estado: 'error', mensaje: 'Estudiante no encontrado.' });
        }

        if (asistencia_id) {
            const [r] = await db.query(
                `UPDATE asistencia
                 SET estado = ?, hora_entrada = COALESCE(?, hora_entrada),
                     observaciones = COALESCE(?, observaciones), modificado_por = ?,
                     justificacion_id = IF(? = 'justificada', justificacion_id, NULL),
                     estado_previo = IF(? = 'justificada', estado_previo, NULL)
                 WHERE id = ? AND usuario_id = ?`,
                [estado, hora_entrada || null, observaciones ?? null, req.usuario.id, estado, estado, asistencia_id, usuario_id]
            );
            if (r.affectedRows === 0) {
                return res.status(404).json({ estado: 'error', mensaje: 'Registro de asistencia no encontrado.' });
            }
        } else {
            // Registro general del día (sin materia), en la sección actual del estudiante
            const [sec] = await db.query('SELECT curso_id FROM estudiante_curso WHERE estudiante_id = ? AND activo = 1 ORDER BY id DESC LIMIT 1', [usuario_id]);
            await db.query(
                `INSERT INTO asistencia (usuario_id, curso_id, materia, fecha, hora_entrada, estado, observaciones, modificado_por)
                 VALUES (?, ?, '', ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE estado = VALUES(estado), observaciones = VALUES(observaciones), modificado_por = VALUES(modificado_por)`,
                [usuario_id, sec[0] ? sec[0].curso_id : 0, fecha, hora_entrada || horaLocal(), estado, observaciones || '', req.usuario.id]
            );
        }

        await notificar(db, usuario_id, 'El director actualizó su asistencia',
            `Su asistencia del ${fechaBonita(fecha)} quedó como: ${estado}.`, '/interfaces/estudiante/asistencia.html');
        res.json({ estado: 'exitoso', mensaje: 'Asistencia actualizada correctamente' });
    } catch (err) {
        console.error('Error al actualizar asistencia:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al actualizar la asistencia' });
    }
});

module.exports = router;
