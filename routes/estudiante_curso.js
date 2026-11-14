const express = require('express');
const router = express.Router();
const db = require('../db');
const { anioEscolarActual } = require('../lib/periodo');


router.post('/', async (req, res) => {
    const { estudiante_id, curso_id, anio_academico } = req.body;

    if (!estudiante_id || !curso_id) {
        return res.status(400).json({ estado: 'error', mensaje: 'Seleccione un estudiante y una sección' });
    }

    try {
        const anioValido = anio_academico || await anioEscolarActual(db);
        const [est] = await db.query("SELECT id FROM usuarios WHERE id = ? AND rol = 'estudiante'", [estudiante_id]);
        if (est.length === 0) {
            return res.status(400).json({ estado: 'error', mensaje: 'La persona seleccionada no es un estudiante.' });
        }
        const [cur] = await db.query('SELECT id FROM cursos WHERE id = ? AND activo = 1', [curso_id]);
        if (cur.length === 0) {
            return res.status(400).json({ estado: 'error', mensaje: 'La sección no existe o está inactiva.' });
        }

        // Un estudiante está en UNA sección a la vez: se desactivan todas las anteriores
        // (antes solo las del mismo año, y quedaban estudiantes en 2 o 3 secciones)
        await db.query('UPDATE estudiante_curso SET activo = 0 WHERE estudiante_id = ? AND activo = 1', [estudiante_id]);

        // Insertar la nueva asignación activa en MySQL
        const insertQuery = `
            INSERT INTO estudiante_curso (estudiante_id, curso_id, anio_academico, activo)
            VALUES (?, ?, ?, 1)
        `;
        const [result] = await db.query(insertQuery, [estudiante_id, curso_id, anioValido]);

        res.json({ estado: 'exitoso', mensaje: 'Estudiante asignado a la sección correctamente', id: result.insertId });
    } catch (err) {
        console.error('Error al asignar sección:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al guardar la asignación en la base de datos' });
    }
});

module.exports = router;