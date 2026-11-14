const express = require('express');
const router = express.Router();
const db = require('../db');
const { soloRoles } = require('../lib/auth');

// Lista de estudiantes con su sección actual (una fila por estudiante)
router.get('/', soloRoles('director'), async (req, res) => {
    try {
        const [results] = await db.query(`
            SELECT u.id, u.cedula, u.nombre, u.apellido, u.email, u.telefono, u.activo,
                   c.id AS curso_id, c.nombre AS curso_nombre, c.nivel, c.seccion, c.turno
            FROM usuarios u
            LEFT JOIN estudiante_curso ec ON ec.id = (
                SELECT MAX(ec2.id) FROM estudiante_curso ec2 WHERE ec2.estudiante_id = u.id AND ec2.activo = 1
            )
            LEFT JOIN cursos c ON ec.curso_id = c.id
            WHERE u.rol = 'estudiante'
            ORDER BY u.id DESC
        `);
        res.json({ estado: 'exitoso', datos: results, results: results });
    } catch (err) {
        console.error('Error al obtener la lista de estudiantes:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al consultar la base de datos' });
    }
});

// Nota: el horario y el panel del estudiante están en routes/estudiante.js
// (/api/estudiante/horario/:id y /api/estudiante/dashboard/:id).
// Aquí había copias con datos fijos (fecha 2026-08-31 e id 5) que se quitaron.

module.exports = router;
