const express = require('express');
const router = express.Router();
const db = require('../db');
const { anioEscolarActual } = require('../lib/periodo');


router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT 
                id, 
                nombre, 
                COALESCE(NULLIF(nivel, ''), 
                    CASE 
                        WHEN nombre LIKE '%Grado%' THEN 'Primaria'
                        WHEN nombre LIKE '%Año%' AND nombre NOT LIKE '%6to%' THEN 'Media'
                        WHEN nombre LIKE '%6to Año%' THEN 'Téc. Medio'
                        ELSE 'Primaria'
                    END
                ) AS nivel,
                seccion, 
                turno,
                anio_escolar, 
                activo 
            FROM cursos 
            ORDER BY 
                FIELD(
                    COALESCE(NULLIF(nivel, ''), 
                        CASE 
                            WHEN nombre LIKE '%Grado%' THEN 'Primaria'
                            WHEN nombre LIKE '%Año%' AND nombre NOT LIKE '%6to%' THEN 'Media'
                            WHEN nombre LIKE '%6to Año%' THEN 'Téc. Medio'
                            ELSE 'Primaria'
                        END
                    ), 'Primaria', 'Media', 'Téc. Medio'),
                CAST(SUBSTRING_INDEX(nombre, ' ', 1) AS UNSIGNED) ASC,
                nombre ASC, 
                seccion ASC
        `;
        const [results] = await db.query(query);
        res.json({ estado: 'exitoso', datos: results });
    } catch (err) {
        console.error('Error al consultar secciones:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener la lista de secciones' });
    }
});


router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [results] = await db.query('SELECT * FROM cursos WHERE id = ?', [id]);
        if (results.length === 0) {
            return res.status(404).json({ estado: 'error', mensaje: 'Sección no encontrada' });
        }
        res.json({ estado: 'exitoso', datos: results[0] });
    } catch (err) {
        console.error('Error al consultar la sección:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener la sección' });
    }
});


const TURNOS = ['Mañana', 'Tarde'];
// '' o null = sin turno; cualquier otro valor debe ser Mañana o Tarde
const turnoValido = (t) => (t === undefined || t === null || t === '' ? null : (TURNOS.includes(t) ? t : false));

router.post('/', async (req, res) => {
    const { nombre, nivel, seccion, anio_escolar, activo } = req.body;
    const turno = turnoValido(req.body.turno);
    if (turno === false) return res.status(400).json({ estado: 'error', mensaje: 'El turno debe ser Mañana o Tarde.' });

    if (!nombre || !seccion) {
        return res.status(400).json({ estado: 'error', mensaje: 'El nombre y la sección son obligatorios' });
    }

    try {
        const anio = anio_escolar || await anioEscolarActual(db);
        const [dup] = await db.query(
            "SELECT id FROM cursos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) AND LOWER(TRIM(seccion)) = LOWER(TRIM(?)) AND anio_escolar = ? AND COALESCE(turno, '') = ?",
            [nombre, seccion, anio, turno || '']
        );
        if (dup.length > 0) {
            return res.status(400).json({ estado: 'error', mensaje: `Ya existe ${nombre} sección ${seccion}${turno ? ` (${turno})` : ''} para ese año escolar.` });
        }

        const query = `
            INSERT INTO cursos (nombre, nivel, seccion, turno, anio_escolar, activo)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const activoVal = (activo === undefined || activo === true || activo == 1) ? 1 : 0;
        const [result] = await db.query(query, [String(nombre).trim(), nivel || '', String(seccion).trim(), turno, anio, activoVal]);

        res.json({ estado: 'exitoso', mensaje: 'Sección creada correctamente', id: result.insertId });
    } catch (err) {
        console.error('Error al crear sección:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al registrar la sección en la base de datos' });
    }
});


router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, nivel, seccion, anio_escolar, activo } = req.body;

    if (!nombre || !seccion) {
        return res.status(400).json({ estado: 'error', mensaje: 'El nombre y la sección son obligatorios' });
    }

    const turnoNuevo = turnoValido(req.body.turno);
    if (turnoNuevo === false) return res.status(400).json({ estado: 'error', mensaje: 'El turno debe ser Mañana o Tarde.' });

    try {
        const [[actual]] = await db.query('SELECT turno, anio_escolar FROM cursos WHERE id = ?', [id]);
        if (!actual) return res.status(404).json({ estado: 'error', mensaje: 'Sección no encontrada' });
        const turno = req.body.turno === undefined ? actual.turno : turnoNuevo;
        const [dup] = await db.query(
            "SELECT id FROM cursos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) AND LOWER(TRIM(seccion)) = LOWER(TRIM(?)) AND anio_escolar = ? AND COALESCE(turno, '') = ? AND id <> ?",
            [nombre, seccion, anio_escolar || actual.anio_escolar, turno || '', id]
        );
        if (dup.length > 0) {
            return res.status(400).json({ estado: 'error', mensaje: `Ya existe ${nombre} sección ${seccion}${turno ? ` (${turno})` : ''} para ese año escolar.` });
        }

        let query = `UPDATE cursos SET nombre = ?, nivel = ?, seccion = ?, turno = ?`;
        let params = [String(nombre).trim(), nivel || '', String(seccion).trim(), turno || null];

        if (anio_escolar) {
            query += `, anio_escolar = ?`;
            params.push(anio_escolar);
        }
        
        if (activo !== undefined) {
            query += `, activo = ?`;
            params.push(Number(activo));
        }

        query += ` WHERE id = ?`;
        params.push(id);

        await db.query(query, params);

        res.json({ estado: 'exitoso', mensaje: 'Sección actualizada correctamente' });
    } catch (err) {
        console.error('Error al actualizar sección:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al actualizar la sección' });
    }
});


// LÓGICA DE BORRADO PROFESIONAL EN 2 PASOS
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Verificamos si hay estudiantes o profesores
        const [[est]] = await db.query('SELECT COUNT(*) AS n FROM estudiante_curso WHERE curso_id = ? AND activo = 1', [id]);
        const [[prof]] = await db.query('SELECT COUNT(*) AS n FROM profesor_curso WHERE curso_id = ? AND activo = 1', [id]);
        
        if (est.n > 0 || prof.n > 0) {
            return res.status(400).json({
                estado: 'error',
                mensaje: `No se puede eliminar: tiene ${est.n} estudiante(s) y ${prof.n} profesor(es) asignados. Primero vaya a "Asignar Estudiante" y "Asignar Profesores" y retírelos de esta sección.`
            });
        }

        // 2. Si está vacía, revisamos si tiene asistencias y su estado actual
        const [[asis]] = await db.query('SELECT COUNT(*) AS n FROM asistencia WHERE curso_id = ?', [id]);
        const [[curso]] = await db.query('SELECT activo FROM cursos WHERE id = ?', [id]);

        if (asis.n > 0 && curso.activo === 1) {
            // Si tiene asistencias y está activa, la archivamos (Paso 1)
            await db.query('UPDATE cursos SET activo = 0 WHERE id = ?', [id]);
            return res.json({ 
                estado: 'exitoso', 
                mensaje: 'Sección archivada. Como tiene historial de asistencias, se ha desactivado. Si desea borrarla definitivamente, vuelva a presionar "Eliminar" (esto borrará las asistencias de esa sección).' 
            });
        }

        // 3. Si ya está inactiva o no tiene asistencias, se borra para siempre
        await db.query('DELETE FROM cursos WHERE id = ?', [id]);
        res.json({ estado: 'exitoso', mensaje: 'Sección eliminada definitivamente.' });
        
    } catch (err) {
        console.error('Error al eliminar sección:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se puede eliminar la sección porque tiene registros vinculados.' });
    }
});

module.exports = router;
