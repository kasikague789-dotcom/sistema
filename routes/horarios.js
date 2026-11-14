const express = require('express');
const router = express.Router();
const db = require('../db');
const { esHoraValida, horaCompleta, leerConfig, claveTurno } = require('../lib/util');

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Revisa datos y choques de horario. Devuelve un mensaje de error o null.
async function validarHorario(b, idActual = 0) {
    const { profesor_id, curso_id, materia, dia_semana, hora_inicio, hora_fin } = b || {};
    if (!profesor_id || !curso_id || !materia || !dia_semana || !hora_inicio || !hora_fin) return 'Faltan campos obligatorios';
    if (!DIAS.includes(dia_semana)) return 'El día no es válido.';
    if (!esHoraValida(hora_inicio) || !esHoraValida(hora_fin)) return 'Las horas no son válidas.';
    const ini = horaCompleta(hora_inicio), fin = horaCompleta(hora_fin);
    if (fin <= ini) return 'La hora de fin debe ser después de la hora de inicio.';

    const [prof] = await db.query("SELECT id FROM usuarios WHERE id = ? AND rol = 'profesor' AND activo = 1", [profesor_id]);
    if (prof.length === 0) return 'El profesor seleccionado no existe o no es profesor.';
    const [cur] = await db.query('SELECT id, nombre, seccion, turno FROM cursos WHERE id = ?', [curso_id]);
    if (cur.length === 0) return 'La sección no existe.';

    // La clase tiene que caer dentro del turno de la sección (si no, el profesor no podrá pasar lista)
    const turno = claveTurno(cur[0].turno);
    if (turno) {
        const corte = (await leerConfig(db)).hora_cambio_turno;
        const nombreSec = `${cur[0].nombre} ${cur[0].seccion}`;
        if (turno === 'manana' && fin > horaCompleta(corte)) {
            return `${nombreSec} es del turno de la mañana: sus clases deben terminar a más tardar a las ${corte}. (La hora de cambio de turno se ajusta en Configuración.)`;
        }
        if (turno === 'tarde' && ini < horaCompleta(corte)) {
            return `${nombreSec} es del turno de la tarde: sus clases deben empezar desde las ${corte}. (La hora de cambio de turno se ajusta en Configuración.)`;
        }
    }

    // Un profesor no puede estar en dos clases a la vez
    const [choqueProf] = await db.query(`
        SELECT h.materia, c.nombre, c.seccion, DATE_FORMAT(h.hora_inicio, '%H:%i') AS ini, DATE_FORMAT(h.hora_fin, '%H:%i') AS fin
        FROM horarios_clase h JOIN cursos c ON c.id = h.curso_id
        WHERE h.activo = 1 AND h.id <> ? AND h.profesor_id = ? AND h.dia_semana = ?
          AND h.hora_inicio < ? AND h.hora_fin > ? LIMIT 1
    `, [idActual, profesor_id, dia_semana, fin, ini]);
    if (choqueProf.length > 0) {
        const c = choqueProf[0];
        return `El profesor ya tiene ${c.materia} en ${c.nombre} ${c.seccion} el ${dia_semana} de ${c.ini} a ${c.fin}.`;
    }
    // Una sección no puede tener dos clases a la vez
    const [choqueCurso] = await db.query(`
        SELECT h.materia, DATE_FORMAT(h.hora_inicio, '%H:%i') AS ini, DATE_FORMAT(h.hora_fin, '%H:%i') AS fin
        FROM horarios_clase h
        WHERE h.activo = 1 AND h.id <> ? AND h.curso_id = ? AND h.dia_semana = ?
          AND h.hora_inicio < ? AND h.hora_fin > ? LIMIT 1
    `, [idActual, curso_id, dia_semana, fin, ini]);
    if (choqueCurso.length > 0) {
        const c = choqueCurso[0];
        return `La sección ya tiene ${c.materia} el ${dia_semana} de ${c.ini} a ${c.fin}.`;
    }
    return null;
}

// El horario y "Asignar Profesores" deben decir lo mismo: si el profesor no tiene
// asignada esa materia en esa sección, se le asigna sola. Devuelve true si la creó.
async function asegurarAsignacion(profesor_id, curso_id, materia) {
    const [asig] = await db.query(
        'SELECT id FROM profesor_curso WHERE profesor_id = ? AND curso_id = ? AND activo = 1 AND TRIM(materia) = TRIM(?)',
        [profesor_id, curso_id, materia]
    );
    if (asig.length > 0) return false;
    const [[curso]] = await db.query('SELECT anio_escolar FROM cursos WHERE id = ?', [curso_id]);
    await db.query(
        'INSERT INTO profesor_curso (profesor_id, curso_id, materia, anio_academico, activo) VALUES (?, ?, ?, ?, 1)',
        [profesor_id, curso_id, String(materia).trim(), (curso && curso.anio_escolar) || new Date().getFullYear()]
    );
    return true;
}


router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT 
                h.id,
                h.profesor_id,
                CONCAT(u.nombre, ' ', u.apellido) AS profesor_nombre,
                u.cedula AS profesor_cedula,
                h.curso_id,
                c.nombre AS curso_nombre,
                c.nivel AS curso_nivel,
                c.seccion AS curso_seccion, c.turno AS curso_turno,
                h.materia,
                h.dia_semana,
                h.hora_inicio,
                h.hora_fin,
                h.aula,
                h.activo
            FROM horarios_clase h
            INNER JOIN usuarios u ON h.profesor_id = u.id
            INNER JOIN cursos c ON h.curso_id = c.id
            WHERE h.activo = 1
            ORDER BY FIELD(h.dia_semana, 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'), h.hora_inicio ASC
        `;
        const [results] = await db.query(query);
        res.json({ estado: 'exitoso', datos: results });
    } catch (err) {
        console.error('Error al consultar horarios:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener los horarios' });
    }
});


// Revisión para el director: choques, secciones sin horario y asignaciones sin horario
router.get('/revision', async (req, res) => {
    try {
        const [choques] = await db.query(`
            SELECT 'profesor' AS tipo, CONCAT(u.nombre, ' ', u.apellido) AS quien, a.dia_semana,
                   DATE_FORMAT(a.hora_inicio, '%H:%i') AS ini_a, DATE_FORMAT(a.hora_fin, '%H:%i') AS fin_a,
                   CONCAT(a.materia, ' en ', ca.nombre, ' ', ca.seccion) AS clase_a, a.id AS id_a,
                   DATE_FORMAT(b.hora_inicio, '%H:%i') AS ini_b, DATE_FORMAT(b.hora_fin, '%H:%i') AS fin_b,
                   CONCAT(b.materia, ' en ', cb.nombre, ' ', cb.seccion) AS clase_b, b.id AS id_b
            FROM horarios_clase a
            JOIN horarios_clase b ON a.profesor_id = b.profesor_id AND a.dia_semana = b.dia_semana AND a.id < b.id
                 AND a.hora_inicio < b.hora_fin AND a.hora_fin > b.hora_inicio AND b.activo = 1
            JOIN usuarios u ON u.id = a.profesor_id
            JOIN cursos ca ON ca.id = a.curso_id JOIN cursos cb ON cb.id = b.curso_id
            WHERE a.activo = 1
            UNION ALL
            SELECT 'seccion', CONCAT(ca.nombre, ' ', ca.seccion), a.dia_semana,
                   DATE_FORMAT(a.hora_inicio, '%H:%i'), DATE_FORMAT(a.hora_fin, '%H:%i'), a.materia, a.id,
                   DATE_FORMAT(b.hora_inicio, '%H:%i'), DATE_FORMAT(b.hora_fin, '%H:%i'), b.materia, b.id
            FROM horarios_clase a
            JOIN horarios_clase b ON a.curso_id = b.curso_id AND a.dia_semana = b.dia_semana AND a.id < b.id
                 AND a.hora_inicio < b.hora_fin AND a.hora_fin > b.hora_inicio AND b.activo = 1
            JOIN cursos ca ON ca.id = a.curso_id
            WHERE a.activo = 1
        `);
        const [seccionesSinHorario] = await db.query(`
            SELECT c.id, c.nombre, c.seccion, c.turno, COUNT(DISTINCT ec.estudiante_id) AS estudiantes
            FROM cursos c
            JOIN estudiante_curso ec ON ec.curso_id = c.id AND ec.activo = 1
            WHERE c.activo = 1 AND NOT EXISTS (SELECT 1 FROM horarios_clase h WHERE h.curso_id = c.id AND h.activo = 1)
            GROUP BY c.id, c.nombre, c.seccion, c.turno
            ORDER BY c.nombre, c.seccion
        `);
        const [asignacionesSinHorario] = await db.query(`
            SELECT pc.id, CONCAT(u.nombre, ' ', u.apellido) AS profesor, pc.materia, c.nombre, c.seccion, c.turno
            FROM profesor_curso pc
            JOIN usuarios u ON u.id = pc.profesor_id
            JOIN cursos c ON c.id = pc.curso_id
            WHERE pc.activo = 1 AND NOT EXISTS (
                SELECT 1 FROM horarios_clase h
                WHERE h.profesor_id = pc.profesor_id AND h.curso_id = pc.curso_id AND h.activo = 1 AND TRIM(h.materia) = TRIM(pc.materia)
            )
            ORDER BY u.nombre, c.nombre, c.seccion
        `);
        // Clases que no caen en el turno de su sección (pasa si se cambia el turno o la hora de cambio de turno)
        const corte = horaCompleta((await leerConfig(db)).hora_cambio_turno);
        const [bloques] = await db.query(`
            SELECT h.id, h.materia, h.dia_semana, DATE_FORMAT(h.hora_inicio, '%H:%i') AS ini, DATE_FORMAT(h.hora_fin, '%H:%i') AS fin,
                   TIME_FORMAT(h.hora_inicio, '%H:%i:%s') AS ini_c, TIME_FORMAT(h.hora_fin, '%H:%i:%s') AS fin_c,
                   c.nombre, c.seccion, c.turno
            FROM horarios_clase h JOIN cursos c ON c.id = h.curso_id
            WHERE h.activo = 1 AND c.activo = 1 AND c.turno IS NOT NULL AND c.turno <> ''
            ORDER BY c.nombre, c.seccion, h.dia_semana, h.hora_inicio
        `);
        const fueraDeTurno = bloques.filter(b => {
            const t = claveTurno(b.turno);
            return (t === 'manana' && b.fin_c > corte) || (t === 'tarde' && b.ini_c < corte);
        }).map(({ ini_c, fin_c, ...b }) => b);
        res.json({ estado: 'exitoso', choques, seccionesSinHorario, asignacionesSinHorario, fueraDeTurno, hora_cambio_turno: corte.slice(0, 5) });
    } catch (err) {
        console.error('Error en revisión de horarios:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al revisar los horarios' });
    }
});


router.post('/', async (req, res) => {
    const { profesor_id, curso_id, materia, dia_semana, hora_inicio, hora_fin, aula } = req.body || {};

    try {
        const errorValidacion = await validarHorario(req.body);
        if (errorValidacion) return res.status(400).json({ estado: 'error', mensaje: errorValidacion });

        const query = `
            INSERT INTO horarios_clase (profesor_id, curso_id, materia, dia_semana, hora_inicio, hora_fin, aula, activo)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `;
        const [result] = await db.query(query, [profesor_id, curso_id, String(materia).trim(), dia_semana, hora_inicio, hora_fin, aula || null]);
        const asignada = await asegurarAsignacion(profesor_id, curso_id, materia);
        res.json({
            estado: 'exitoso',
            mensaje: asignada ? 'Horario creado. También se asignó la materia al profesor en esa sección.' : 'Horario creado correctamente',
            id: result.insertId
        });
    } catch (err) {
        console.error('Error al crear horario:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al guardar el horario' });
    }
});


router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { profesor_id, curso_id, materia, dia_semana, hora_inicio, hora_fin, aula } = req.body || {};

    try {
        const errorValidacion = await validarHorario(req.body, Number(id) || 0);
        if (errorValidacion) return res.status(400).json({ estado: 'error', mensaje: errorValidacion });

        const query = `
            UPDATE horarios_clase 
            SET profesor_id = ?, curso_id = ?, materia = ?, dia_semana = ?, hora_inicio = ?, hora_fin = ?, aula = ?
            WHERE id = ?
        `;
        await db.query(query, [profesor_id, curso_id, String(materia).trim(), dia_semana, hora_inicio, hora_fin, aula || null, id]);
        const asignada = await asegurarAsignacion(profesor_id, curso_id, materia);
        res.json({
            estado: 'exitoso',
            mensaje: asignada ? 'Horario actualizado. También se asignó la materia al profesor en esa sección.' : 'Horario actualizado correctamente'
        });
    } catch (err) {
        console.error('Error al actualizar horario:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al actualizar el horario' });
    }
});


router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM horarios_clase WHERE id = ?', [id]);
        res.json({ estado: 'exitoso', mensaje: 'Horario eliminado correctamente' });
    } catch (err) {
        console.error('Error al eliminar horario:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar el horario' });
    }
});

module.exports = router;