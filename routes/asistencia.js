const express = require('express');
const router = express.Router();
const db = require('../db');
const { soloRoles, soloPropio } = require('../lib/auth');
const { hoyLocal, horaLocal, esFechaValida, normalizarEstado } = require('../lib/util');
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
                COALESCE(ca.seccion, c.seccion) AS seccion,
                a.id AS asistencia_id,
                a.materia,
                a.hora_entrada,
                a.estado,
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
                   c.id AS curso_id, c.nombre AS curso, c.seccion,
                   NULL AS asistencia_id, '' AS materia, NULL AS hora_entrada,
                   'sin_marcar' AS estado, NULL AS observaciones
            FROM usuarios u
            LEFT JOIN estudiante_curso ec ON u.id = ec.estudiante_id AND ec.activo = 1
            LEFT JOIN cursos c ON ec.curso_id = c.id
            WHERE u.rol = 'estudiante' AND u.activo = 1
              AND NOT EXISTS (SELECT 1 FROM asistencia a WHERE a.usuario_id = u.id AND a.fecha = ?)
            ORDER BY c.nombre ASC, c.seccion ASC, u.apellido ASC, u.nombre ASC
        `, [fechaReq]);

        const [cursos] = await db.query('SELECT id, nombre, seccion FROM cursos WHERE activo = 1 ORDER BY nombre, seccion');

        res.json({ fecha: fechaReq, estudiantes: [...registros, ...sinMarcar], cursos });
    } catch (err) {
        console.error('Error al obtener asistencia:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener la asistencia' });
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
