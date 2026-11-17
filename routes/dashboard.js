const express = require('express');
const router = express.Router();
const db = require('../db');
const { hoyLocal, sumarDias, leerConfig } = require('../lib/util');


router.get('/stats', async (req, res) => {
    try {
        const hoy = hoyLocal();
        const hace30 = sumarDias(hoy, -30);
        const config = await leerConfig(db);

        // 1. Total estudiantes activos
        const [estudiantes] = await db.query("SELECT COUNT(*) as total FROM usuarios WHERE rol = 'estudiante' AND activo = 1");

        // 2. Total profesores activos
        const [profesores] = await db.query("SELECT COUNT(*) as total FROM usuarios WHERE rol = 'profesor' AND activo = 1");

        // 3. Justificaciones pendientes
        const [justificaciones] = await db.query("SELECT COUNT(*) as total FROM justificaciones WHERE estado IN ('pendiente', 'revision')");

        // 4. Eventos próximos en el calendario
        const [eventos] = await db.query('SELECT COUNT(*) as total FROM calendario_academico WHERE fecha_inicio >= ?', [hoy]);

        // 5. Asistencia de hoy: % de registros de clase de hoy que son asistencia
        //    (presente, tarde o justificada) sobre todos los registros de hoy.
        const [hoyRows] = await db.query(`
            SELECT COUNT(*) AS registros,
                   SUM(estado IN ('presente', 'tarde', 'justificada')) AS asistidos,
                   COUNT(DISTINCT CASE WHEN estado IN ('presente', 'tarde') THEN usuario_id END) AS presentes
            FROM asistencia WHERE fecha = ?
        `, [hoy]);
        const registrosHoy = Number(hoyRows[0].registros || 0);
        const asistidosHoy = Number(hoyRows[0].asistidos || 0);

        // 6. Top 5 estudiantes con más inasistencias (ausencias sin justificar) en los últimos 30 días
        const [topInasistencias] = await db.query(`
            SELECT u.id, u.nombre, u.apellido, u.cedula, COUNT(a.id) as faltas
            FROM asistencia a
            JOIN usuarios u ON a.usuario_id = u.id
            WHERE a.estado = 'ausente' AND a.fecha >= ? AND u.activo = 1
            GROUP BY u.id, u.nombre, u.apellido, u.cedula
            ORDER BY faltas DESC
            LIMIT 5
        `, [hace30]);

        res.json({
            estado: 'exitoso',
            datos: {
                total_estudiantes: estudiantes[0].total,
                total_profesores: profesores[0].total,
                presentes_hoy: Number(hoyRows[0].presentes || 0),
                registros_hoy: registrosHoy,
                porcentaje_hoy: registrosHoy > 0 ? Number(((asistidosHoy / registrosHoy) * 100).toFixed(2)) : null,
                porcentaje_minimo: config.porcentaje_asistencia_minimo,
                justificaciones_pendientes: justificaciones[0].total,
                eventos_proximos: eventos[0].total,
                top_inasistencias: topInasistencias
            }
        });
    } catch (err) {
        console.error('Error al obtener estadísticas del dashboard:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al consultar la base de datos' });
    }
});

module.exports = router;
