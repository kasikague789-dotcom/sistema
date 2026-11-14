const express = require('express');
const router = express.Router();
const db = require('../db');
const { anioEscolarActual } = require('../lib/periodo');


router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT 
                pc.id,
                pc.profesor_id,
                CONCAT(u.nombre, ' ', u.apellido) AS profesor_nombre,
                pc.curso_id,
                c.nombre AS curso_nombre,
                c.seccion,
                c.turno,
                pc.materia,
                pc.anio_academico
            FROM profesor_curso pc
            INNER JOIN usuarios u ON pc.profesor_id = u.id
            INNER JOIN cursos c ON pc.curso_id = c.id
            WHERE pc.activo = 1
            ORDER BY pc.id DESC
        `;
        const [results] = await db.query(query);
        res.json({ estado: 'exitoso', datos: results });
    } catch (err) {
        console.error('Error al consultar profesor_curso:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al consultar la base de datos' });
    }
});


router.post('/', async (req, res) => {
    const { profesor_id, curso_id, materia, anio_academico } = req.body;

    if (!profesor_id || !curso_id || !materia) {
        return res.status(400).json({ estado: 'error', mensaje: 'Todos los campos son obligatorios' });
    }

    const anioValido = anio_academico || await anioEscolarActual(db);

    try {
        const [prof] = await db.query("SELECT id FROM usuarios WHERE id = ? AND rol = 'profesor' AND activo = 1", [profesor_id]);
        if (prof.length === 0) {
            return res.status(400).json({ estado: 'error', mensaje: 'La persona seleccionada no es un profesor activo.' });
        }
        const [cur] = await db.query('SELECT id FROM cursos WHERE id = ? AND activo = 1', [curso_id]);
        if (cur.length === 0) {
            return res.status(400).json({ estado: 'error', mensaje: 'La sección no existe o está inactiva.' });
        }

        // Validar si ya existe la asignación exacta
        const checkQuery = `
            SELECT id FROM profesor_curso 
            WHERE profesor_id = ? AND curso_id = ? AND LOWER(materia) = LOWER(?) AND anio_academico = ? AND activo = 1
        `;
        const [exist] = await db.query(checkQuery, [profesor_id, curso_id, materia, anioValido]);

        if (exist.length > 0) {
            return res.status(400).json({ 
                estado: 'error', 
                mensaje: 'Este profesor ya imparte esta materia en la sección seleccionada' 
            });
        }

        const insertQuery = `
            INSERT INTO profesor_curso (profesor_id, curso_id, materia, anio_academico, activo)
            VALUES (?, ?, ?, ?, 1)
        `;
        const [result] = await db.query(insertQuery, [profesor_id, curso_id, String(materia).trim(), anioValido]);

        res.json({ estado: 'exitoso', mensaje: 'Profesor asignado correctamente', id: result.insertId });
    } catch (err) {
        console.error('Error al insertar en profesor_curso:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al registrar la asignación' });
    }
});


router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Al quitar la asignación, su horario también se quita (si no, el profesor
        // seguiría viendo en "Mi Horario" una clase que ya no da)
        const [pc] = await db.query('SELECT profesor_id, curso_id, materia FROM profesor_curso WHERE id = ?', [id]);
        if (pc.length > 0) {
            await db.query(
                'UPDATE horarios_clase SET activo = 0 WHERE profesor_id = ? AND curso_id = ? AND TRIM(materia) = TRIM(?)',
                [pc[0].profesor_id, pc[0].curso_id, pc[0].materia]
            );
        }
        const [result] = await db.query('DELETE FROM profesor_curso WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ estado: 'error', mensaje: 'Asignación no encontrada' });
        }

        res.json({ estado: 'exitoso', mensaje: 'Asignación eliminada. Sus bloques de horario también se quitaron.' });
    } catch (err) {
        console.error('Error al eliminar asignación:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar registro de la base de datos' });
    }
});

module.exports = router;