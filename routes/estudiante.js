const express = require('express');
const router = express.Router();
const db = require('../db');
const { soloPropio } = require('../lib/auth');
const { hoyLocal, sumarDias, leerConfig, normalizarEstado } = require('../lib/util');


router.get('/dashboard/:id', soloPropio('id'), async (req, res) => {
    const { id } = req.params;
    try {
        const [userRows] = await db.query(`
            SELECT u.id, u.nombre, u.apellido, u.cedula, u.email,
                   c.nombre AS curso_nombre, c.seccion AS curso_seccion, c.turno AS curso_turno, c.nivel AS curso_nivel
            FROM usuarios u
            LEFT JOIN estudiante_curso ec ON u.id = ec.estudiante_id AND ec.activo = 1
            LEFT JOIN cursos c ON ec.curso_id = c.id
            WHERE u.id = ? AND u.rol = 'estudiante'
            ORDER BY ec.id DESC
            LIMIT 1
        `, [id]);

        if (userRows.length === 0) {
            return res.status(404).json({ estado: 'error', mensaje: 'Estudiante no encontrado' });
        }
        const estudiante = userRows[0];
        const hoy = hoyLocal();
        const config = await leerConfig(db);

        const [asisHoy] = await db.query('SELECT estado FROM asistencia WHERE usuario_id = ? AND fecha = ?', [id, hoy]);
        const estadosHoy = asisHoy.map(r => normalizarEstado(r.estado));
        let asistenciaHoy = { estado: 'sin_marcar', texto: 'Sin marcar' };
        if (estadosHoy.length > 0) {
            const asistidas = estadosHoy.filter(e => e === 'presente' || e === 'tarde' || e === 'justificada').length;
            let estado = 'presente';
            if (estadosHoy.includes('ausente')) estado = 'ausente';
            else if (estadosHoy.includes('tarde')) estado = 'tarde';
            asistenciaHoy = {
                estado,
                texto: estadosHoy.length === 1
                    ? estado.charAt(0).toUpperCase() + estado.slice(1)
                    : `Asistió a ${asistidas} de ${estadosHoy.length} clases`
            };
        }

        const [historial] = await db.query(
            'SELECT estado FROM asistencia WHERE usuario_id = ? AND fecha >= ?',
            [id, sumarDias(hoy, -30)]
        );
        const estados = historial.map(r => normalizarEstado(r.estado));

        const stats = {
            presentes: estados.filter(e => e === 'presente').length,
            ausentes: estados.filter(e => e === 'ausente').length,
            tardes: estados.filter(e => e === 'tarde').length,
            justificados: estados.filter(e => e === 'justificada').length
        };

        const [justs] = await db.query(
            "SELECT COUNT(*) AS pendientes FROM justificaciones WHERE usuario_id = ? AND estado IN ('pendiente', 'revision')",
            [id]
        );
        const justificacionesPendientes = justs[0].pendientes;

        const [eventos] = await db.query(`
            SELECT titulo, DATE_FORMAT(fecha_inicio, '%d/%m/%Y') AS fecha, tipo_evento AS tipo, color_evento AS color
            FROM calendario_academico
            WHERE fecha_fin >= ?
              AND (curso_id IS NULL OR curso_id = 0 OR curso_id IN (SELECT curso_id FROM estudiante_curso WHERE estudiante_id = ? AND activo = 1))
            ORDER BY fecha_inicio ASC LIMIT 3
        `, [hoy, id]);

        res.json({
            estado: 'exitoso',
            estudiante: {
                nombre: estudiante.nombre,
                apellido: estudiante.apellido,
                cedula: estudiante.cedula,
                email: estudiante.email,
                curso: estudiante.curso_nombre ? `${estudiante.curso_nivel || ''} ${estudiante.curso_nombre} - ${estudiante.curso_seccion}${estudiante.curso_turno ? ' · ' + estudiante.curso_turno : ''}`.trim() : 'Sin sección asignada'
            },
            asistenciaHoy,
            justificacionesPendientes,
            stats,
            porcentajeMinimo: config.porcentaje_asistencia_minimo,
            proximosEventos: eventos
        });
    } catch (err) {
        console.error('Error al cargar dashboard de estudiante:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al cargar el panel del estudiante' });
    }
});


router.get('/horario/:id', soloPropio('id'), async (req, res) => {
    const { id } = req.params;
    try {
        const [cursoRows] = await db.query(`
            SELECT c.id, c.nombre, c.nivel, c.seccion, c.turno
            FROM estudiante_curso ec
            INNER JOIN cursos c ON ec.curso_id = c.id
            WHERE ec.estudiante_id = ? AND ec.activo = 1
            ORDER BY ec.id DESC
            LIMIT 1
        `, [id]);

        if (cursoRows.length === 0) {
            return res.json({ estado: 'exitoso', curso: null, datos: [], eventos: [], mensaje: 'Aún no tiene sección asignada.' });
        }
        const curso = cursoRows[0];
        const hoy = hoyLocal();

        const [horarioRows] = await db.query(`
            SELECT h.id, h.profesor_id, CONCAT(u.nombre, ' ', u.apellido) AS profesor_nombre,
                   h.curso_id, h.materia, h.dia_semana,
                   DATE_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
                   DATE_FORMAT(h.hora_fin, '%H:%i') AS hora_fin, h.aula
            FROM horarios_clase h
            INNER JOIN usuarios u ON h.profesor_id = u.id
            WHERE h.curso_id = ? AND h.activo = 1
            ORDER BY FIELD(h.dia_semana, 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'), h.hora_inicio ASC
        `, [curso.id]);

        // Solo trae eventos globales (curso_id es NULL) o eventos de ESTE curso
        const [eventosRows] = await db.query(`
            SELECT titulo, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
                   DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin, 
                   DATE_FORMAT(hora_inicio, '%H:%i') AS hora_inicio,
                   DATE_FORMAT(hora_fin, '%H:%i') AS hora_fin,
                   materia, tipo_evento, color_evento, afecta_asistencia
            FROM calendario_academico
            WHERE fecha_fin >= ? AND fecha_inicio <= ? AND (curso_id IS NULL OR curso_id = ?)
        `, [sumarDias(hoy, -7), sumarDias(hoy, 7), curso.id]);

        res.json({ estado: 'exitoso', curso, datos: horarioRows, eventos: eventosRows });
    } catch (err) {
        console.error('Error al obtener el horario del estudiante:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener el horario' });
    }
});

module.exports = router;
