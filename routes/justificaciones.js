const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { soloRoles, soloPropio } = require('../lib/auth');
const { notificar, idsDirectores, fechaBonita } = require('../lib/notificar');
const {
    esFechaValida, hoyLocal, sumarDias, leerConfig, ESTADOS_JUSTIFICACION, TIPOS_JUSTIFICACION
} = require('../lib/util');

const CARPETA_ARCHIVOS = path.join(__dirname, '..', 'uploads', 'justificaciones');
const TIPOS_ARCHIVO = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_BYTES = 5 * 1024 * 1024;

function guardarArchivo(archivo) {
    if (!archivo) return { ok: true, datos: null };
    const { nombre, tipo, base64 } = archivo;
    const ext = TIPOS_ARCHIVO[tipo];
    if (!ext) return { ok: false, mensaje: 'La constancia debe ser PDF, JPG o PNG.' };
    const buffer = Buffer.from(String(base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
    if (buffer.length === 0) return { ok: false, mensaje: 'El archivo está vacío.' };
    if (buffer.length > MAX_BYTES) return { ok: false, mensaje: 'La constancia no puede pasar de 5 MB.' };
    fs.mkdirSync(CARPETA_ARCHIVOS, { recursive: true });
    const nombreDisco = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(CARPETA_ARCHIVOS, nombreDisco), buffer);
    return {
        ok: true,
        datos: {
            url: `uploads/justificaciones/${nombreDisco}`,
            nombre: String(nombre || `constancia.${ext}`).slice(0, 200),
            tipo,
            tamano: buffer.length
        }
    };
}

async function validarSolicitud(body) {
    const { fecha_inicio, fecha_fin, tipo_justificacion, descripcion } = body || {};
    if (!esFechaValida(fecha_inicio) || !esFechaValida(fecha_fin)) return 'Las fechas no son válidas.';
    if (fecha_fin < fecha_inicio) return 'La fecha fin no puede ser antes de la fecha inicio.';
    if (!TIPOS_JUSTIFICACION.includes(tipo_justificacion)) return 'Seleccione un tipo de justificación válido.';
    if (!descripcion || !String(descripcion).trim()) return 'Escriba el motivo de la justificación.';
    const config = await leerConfig(db);
    const limite = sumarDias(hoyLocal(), -config.dias_maximos_justificar);
    if (fecha_fin < limite) {
        return `El plazo para justificar es de ${config.dias_maximos_justificar} día(s) después de la falta.`;
    }
    return null;
}

router.get('/', soloRoles('director'), async (req, res) => {
    try {
        const [results] = await db.query(`
            SELECT j.*,
                   j.tipo_justificacion AS tipo,
                   (j.documento_url IS NOT NULL AND j.documento_url <> '') AS tiene_archivo,
                   u.nombre AS estudiante_nombre, u.apellido AS estudiante_apellido, u.cedula,
                   c.nivel AS curso_nivel, c.nombre AS curso_nombre, c.seccion AS curso_seccion, c.turno AS curso_turno,
                   CONCAT(ap.nombre, ' ', ap.apellido) AS aprobado_por_nombre
            FROM justificaciones j
            JOIN usuarios u ON j.usuario_id = u.id
            LEFT JOIN usuarios ap ON ap.id = j.aprobado_por
            LEFT JOIN estudiante_curso ec ON ec.id = (
                SELECT MAX(ec2.id) FROM estudiante_curso ec2 WHERE ec2.estudiante_id = u.id AND ec2.activo = 1
            )
            LEFT JOIN cursos c ON ec.curso_id = c.id
            ORDER BY j.fecha_registro DESC
        `);
        results.forEach(r => { delete r.documento_url; });
        res.json({ datos: results });
    } catch (err) {
        console.error('Error al obtener justificaciones:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener las justificaciones' });
    }
});

router.put('/:id', soloRoles('director'), async (req, res) => {
    const { id } = req.params;
    const { estado, observaciones, eliminar_inasistencia } = req.body || {};

    if (!ESTADOS_JUSTIFICACION.includes(estado)) {
        return res.status(400).json({ estado: 'error', mensaje: 'Estado no válido.' });
    }

    try {
        const [justs] = await db.query('SELECT id, usuario_id, fecha_inicio, fecha_fin, estado, materia FROM justificaciones WHERE id = ?', [id]);
        if (justs.length === 0) {
            return res.status(404).json({ estado: 'error', mensaje: 'Justificación no encontrada.' });
        }
        const j = justs[0];

        let revertidas = 0;
        if (j.estado === 'aprobada' && estado !== 'aprobada') {
            const [r] = await db.query(
                "UPDATE asistencia SET estado = COALESCE(estado_previo, 'ausente'), estado_previo = NULL, justificacion_id = NULL WHERE justificacion_id = ?",
                [id]
            );
            revertidas = r.affectedRows;
        }

        let diasJustificados = null;
        if (estado === 'aprobada' && eliminar_inasistencia && j.estado !== 'aprobada') {
            let queryAfectar = `UPDATE asistencia SET estado_previo = estado, estado = 'justificada', justificacion_id = ?
                 WHERE usuario_id = ? AND fecha BETWEEN ? AND ? AND estado = 'ausente'`;
            let params = [id, j.usuario_id, j.fecha_inicio, j.fecha_fin];

            if (j.materia) {
                queryAfectar += ` AND materia = ?`;
                params.push(j.materia);
            }

            const [r] = await db.query(queryAfectar, params);
            diasJustificados = r.affectedRows;
        }

        const procesada = estado === 'aprobada' || estado === 'rechazada';
        await db.query(
            `UPDATE justificaciones
             SET estado = ?, observaciones_director = ?,
                 aprobado_por = ?, fecha_aprobacion = ?,
                 dias_justificados = COALESCE(?, IF(? = 'aprobada', dias_justificados, NULL))
             WHERE id = ?`,
            [estado, observaciones || null, procesada ? req.usuario.id : null, procesada ? new Date() : null,
             diasJustificados, estado, id]
        );

        if (estado !== j.estado) {
            const textos = { aprobada: 'fue APROBADA', rechazada: 'fue RECHAZADA', revision: 'está en revisión', pendiente: 'volvió a pendiente' };
            
            // 1. Notificar al estudiante
            await notificar(db, j.usuario_id, 'Respuesta a su justificación',
                `Su justificación del ${fechaBonita(j.fecha_inicio)} ${textos[estado]}.${observaciones ? ` Observación: ${observaciones}` : ''}`,
                '/interfaces/estudiante/justificaciones.html');

            // 2. Notificar a los profesores del estudiante
            const [profs] = await db.query(`
                SELECT DISTINCT pc.profesor_id AS id
                FROM estudiante_curso ec
                JOIN profesor_curso pc ON pc.curso_id = ec.curso_id AND pc.activo = 1
                WHERE ec.estudiante_id = ? AND ec.activo = 1
            `, [j.usuario_id]);
            const idsProfs = profs.map(p => p.id);

            if (idsProfs.length > 0) {
                const [est] = await db.query('SELECT nombre, apellido FROM usuarios WHERE id = ?', [j.usuario_id]);
                const nombreEst = est[0] ? `${est[0].nombre} ${est[0].apellido}` : 'Un estudiante';
                await notificar(db, idsProfs, 'Actualización de justificación',
                    `La justificación de ${nombreEst} del ${fechaBonita(j.fecha_inicio)} ${textos[estado]}.`,
                    '/interfaces/profesor/justificaciones.html');
            }
        }

        let mensaje = 'Justificación procesada correctamente.';
        if (diasJustificados !== null) mensaje += ` Faltas justificadas: ${diasJustificados}.`;
        if (revertidas > 0) mensaje += ` Se devolvieron ${revertidas} falta(s) a su estado anterior.`;
        res.json({ estado: 'exitoso', mensaje });
    } catch (err) {
        console.error('Error al procesar justificación:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al procesar la justificación' });
    }
});

router.get('/:id/archivo', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT usuario_id, documento_url, archivo_nombre, archivo_tipo FROM justificaciones WHERE id = ?', [req.params.id]);
        if (rows.length === 0 || !rows[0].documento_url) {
            return res.status(404).json({ estado: 'error', mensaje: 'Esta justificación no tiene constancia.' });
        }
        const j = rows[0];
        const u = req.usuario;
        let permitido = u.rol === 'director' || (u.rol === 'estudiante' && u.id === j.usuario_id);
        if (!permitido && u.rol === 'profesor') {
            const [p] = await db.query(`
                SELECT 1 FROM estudiante_curso ec
                JOIN profesor_curso pc ON pc.curso_id = ec.curso_id AND pc.activo = 1
                WHERE ec.estudiante_id = ? AND ec.activo = 1 AND pc.profesor_id = ? LIMIT 1
            `, [j.usuario_id, u.id]);
            permitido = p.length > 0;
        }
        if (!permitido) return res.status(403).json({ estado: 'error', mensaje: 'No tiene permiso para ver esta constancia.' });

        const ruta = path.resolve(__dirname, '..', j.documento_url);
        if (!ruta.startsWith(path.resolve(CARPETA_ARCHIVOS)) || !fs.existsSync(ruta)) {
            return res.status(404).json({ estado: 'error', mensaje: 'El archivo ya no existe en el servidor.' });
        }
        res.setHeader('Content-Type', j.archivo_tipo || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(j.archivo_nombre || path.basename(ruta))}"`);
        res.sendFile(ruta);
    } catch (err) {
        console.error('Error al enviar constancia:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al abrir la constancia' });
    }
});

router.get('/estudiante/:id', soloPropio('id'), async (req, res) => {
    const { id } = req.params;
    try {
        const [results] = await db.query(`
            SELECT j.id, DATE_FORMAT(j.fecha_inicio, '%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(j.fecha_fin, '%Y-%m-%d') AS fecha_fin,
                   j.tipo_justificacion AS tipo, j.descripcion, j.estado, j.observaciones_director, j.materia,
                   j.dias_justificados, j.archivo_nombre, j.fecha_registro,
                   (j.documento_url IS NOT NULL AND j.documento_url <> '') AS tiene_archivo
            FROM justificaciones j
            WHERE j.usuario_id = ?
            ORDER BY j.fecha_registro DESC
        `, [id]);

        const stats = {
            total: results.length,
            pendientes: results.filter(r => r.estado === 'pendiente' || r.estado === 'revision').length,
            aprobadas: results.filter(r => r.estado === 'aprobada').length,
            rechazadas: results.filter(r => r.estado === 'rechazada').length
        };

        res.json({ datos: results, stats });
    } catch (err) {
        console.error('Error al obtener justificaciones del estudiante:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener sus justificaciones' });
    }
});

router.post('/estudiante', soloRoles('estudiante'), async (req, res) => {
    const error = await validarSolicitud(req.body);
    if (error) return res.status(400).json({ estado: 'error', mensaje: error, error });

    const archivo = guardarArchivo(req.body.archivo);
    if (!archivo.ok) return res.status(400).json({ estado: 'error', mensaje: archivo.mensaje, error: archivo.mensaje });

    const { fecha_inicio, fecha_fin, tipo_justificacion, descripcion, materia } = req.body;
    try {
        await db.query(`
            INSERT INTO justificaciones (usuario_id, fecha_inicio, fecha_fin, tipo_justificacion, descripcion, materia,
                                         documento_url, archivo_nombre, archivo_tipo, archivo_tamano, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')
        `, [req.usuario.id, fecha_inicio, fecha_fin, tipo_justificacion, String(descripcion).slice(0, 2000), materia || null,
            archivo.datos ? archivo.datos.url : null, archivo.datos ? archivo.datos.nombre : null,
            archivo.datos ? archivo.datos.tipo : null, archivo.datos ? archivo.datos.tamano : null]);
        
        // 1. Notificar a los directores
        await notificar(db, await idsDirectores(db), 'Nueva justificación por revisar',
            `${req.usuario.nombre} ${req.usuario.apellido} pidió justificar del ${fechaBonita(fecha_inicio)} al ${fechaBonita(fecha_fin)}${materia ? ` (Materia: ${materia})` : ' (Todo el día)'}${archivo.datos ? ' con constancia.' : '.'}`,
            '/interfaces/director/justificaciones.html');

        // 2. Notificar a los profesores de la sección del estudiante
        const [profs] = await db.query(`
            SELECT DISTINCT pc.profesor_id AS id
            FROM estudiante_curso ec
            JOIN profesor_curso pc ON pc.curso_id = ec.curso_id AND pc.activo = 1
            WHERE ec.estudiante_id = ? AND ec.activo = 1
        `, [req.usuario.id]);
        const idsProfs = profs.map(p => p.id);

        if (idsProfs.length > 0) {
            await notificar(db, idsProfs, 'Nueva justificación de estudiante',
                `${req.usuario.nombre} ${req.usuario.apellido} envió una justificación del ${fechaBonita(fecha_inicio)} al ${fechaBonita(fecha_fin)}.`,
                '/interfaces/profesor/justificaciones.html');
        }

        res.json({ estado: 'exitoso', mensaje: 'Solicitud de justificación enviada correctamente' });
    } catch (err) {
        console.error('Error al crear justificación:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al guardar la solicitud', error: 'Error al guardar la solicitud' });
    }
});

router.delete('/estudiante/:id', soloRoles('estudiante'), async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query('SELECT estado, usuario_id, documento_url FROM justificaciones WHERE id = ?', [id]);
        if (rows.length === 0 || rows[0].usuario_id !== req.usuario.id) {
            return res.status(404).json({ estado: 'error', error: 'Justificación no encontrada', mensaje: 'Justificación no encontrada' });
        }

        if (rows[0].estado !== 'pendiente' && rows[0].estado !== 'revision') {
            const m = 'Solo se pueden revocar solicitudes que estén Pendientes o En Revisión.';
            return res.status(400).json({ estado: 'error', error: m, mensaje: m });
        }

        await db.query('DELETE FROM justificaciones WHERE id = ?', [id]);
        if (rows[0].documento_url) {
            const ruta = path.resolve(__dirname, '..', rows[0].documento_url);
            if (ruta.startsWith(path.resolve(CARPETA_ARCHIVOS))) fs.unlink(ruta, () => {});
        }
        res.json({ estado: 'exitoso', mensaje: 'Justificación revocada correctamente' });
    } catch (err) {
        console.error('Error al revocar justificación:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al revocar la justificación' });
    }
});

module.exports = router;
