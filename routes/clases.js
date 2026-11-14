// Clases del día (director), clase no dada y suplencias.
//  - Clase no dada: el profesor faltó (u otro motivo). Los estudiantes no quedan con falta.
//  - Suplente: otro profesor pasa la lista de esa clase ese día.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { soloRoles } = require('../lib/auth');
const { esFechaValida, hoyLocal } = require('../lib/util');
const { notificar, fechaBonita } = require('../lib/notificar');
const { clasesDelDia, mismaMateria } = require('../lib/clases');

const MOTIVOS = ['Profesor ausente', 'Reposo médico del profesor', 'Actividad de la institución', 'Falla de servicios (luz, agua)', 'Otro'];

async function estudiantesIds(cursoId) {
    const [rows] = await db.query(`
        SELECT DISTINCT u.id FROM estudiante_curso ec JOIN usuarios u ON u.id = ec.estudiante_id
        WHERE ec.curso_id = ? AND ec.activo = 1 AND u.activo = 1 AND u.rol = 'estudiante'`, [cursoId]);
    return rows.map(r => r.id);
}

// Busca la clase en el horario de ese día
async function buscarClase(cursoId, materia, fecha) {
    const dia = await clasesDelDia(db, fecha, { cursoId });
    return { dia, clase: dia.clases.find(c => mismaMateria(c.materia, materia || '')) };
}

// ¿Ese profesor está ocupado a esa hora? (clase propia o ya cubre otra clase ese día)
async function choqueDeProfesor(profesorId, dia, fecha, clase) {
    const [propias] = await db.query(`
        SELECT h.materia, c.nombre, c.seccion, DATE_FORMAT(h.hora_inicio, '%H:%i') AS ini, DATE_FORMAT(h.hora_fin, '%H:%i') AS fin
        FROM horarios_clase h JOIN cursos c ON c.id = h.curso_id AND c.activo = 1
        WHERE h.activo = 1 AND h.profesor_id = ? AND h.dia_semana = ? AND h.hora_inicio < ? AND h.hora_fin > ?`,
        [profesorId, dia, `${clase.fin}:00`, `${clase.inicio}:00`]);
    if (propias.length) {
        const c = propias[0];
        return `tiene ${c.materia} en ${c.nombre} ${c.seccion} de ${c.ini} a ${c.fin}`;
    }
    const [cubre] = await db.query(`
        SELECT s.materia, c.nombre, c.seccion, DATE_FORMAT(h.hora_inicio, '%H:%i') AS ini, DATE_FORMAT(h.hora_fin, '%H:%i') AS fin
        FROM suplencias s
        JOIN horarios_clase h ON h.curso_id = s.curso_id AND h.materia = s.materia AND h.dia_semana = ? AND h.activo = 1
        JOIN cursos c ON c.id = s.curso_id
        WHERE s.profesor_suplente_id = ? AND s.fecha = ? AND h.hora_inicio < ? AND h.hora_fin > ?
          AND NOT (s.curso_id = ? AND s.materia = ?)`,
        [dia, profesorId, fecha, `${clase.fin}:00`, `${clase.inicio}:00`, clase.curso_id, clase.materia]);
    if (cubre.length) {
        const c = cubre[0];
        return `ya cubre ${c.materia} en ${c.nombre} ${c.seccion} de ${c.ini} a ${c.fin}`;
    }
    return null;
}

router.get('/motivos', soloRoles('director'), (req, res) => res.json({ estado: 'exitoso', datos: MOTIVOS }));

// Profesores que pueden cubrir esa clase (activos, no el titular y libres a esa hora)
router.get('/suplentes', soloRoles('director'), async (req, res) => {
    const { curso_id, materia, fecha } = req.query;
    if (!curso_id || !materia || !esFechaValida(fecha)) return res.status(400).json({ estado: 'error', mensaje: 'Faltan la clase o la fecha.' });
    try {
        const { dia, clase } = await buscarClase(curso_id, materia, fecha);
        if (!clase) return res.status(400).json({ estado: 'error', mensaje: 'Esa clase no está en el horario de ese día.' });
        const [profes] = await db.query("SELECT id, nombre, apellido FROM usuarios WHERE rol = 'profesor' AND activo = 1 ORDER BY nombre, apellido");
        const libres = [];
        let ocupados = 0;
        for (const p of profes) {
            if (p.id === clase.profesor_id) continue;
            if (await choqueDeProfesor(p.id, dia.dia, fecha, clase)) { ocupados++; continue; }
            libres.push({ id: p.id, nombre: `${p.nombre} ${p.apellido}` });
        }
        res.json({ estado: 'exitoso', datos: libres, ocupados, actual: clase.suplente ? clase.suplente.profesor_id : null });
    } catch (err) {
        console.error('Error al buscar suplentes:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo leer la lista de profesores.' });
    }
});

// Clases de un día con su estado (para el panel y Asistencia)
router.get('/del-dia', soloRoles('director'), async (req, res) => {
    try {
        const fecha = esFechaValida(req.query.fecha) ? req.query.fecha : hoyLocal();
        const cursoId = req.query.curso_id ? Number(req.query.curso_id) : null;
        const datos = await clasesDelDia(db, fecha, { cursoId });
        res.json({ estado: 'exitoso', hoy: hoyLocal(), ...datos });
    } catch (err) {
        console.error('Error en clases del día:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudieron leer las clases del día.' });
    }
});

// Marcar una clase como no dada
router.post('/no-dada', soloRoles('director'), async (req, res) => {
    const { curso_id, materia, fecha } = req.body || {};
    const motivo = String((req.body && req.body.motivo) || '').trim().slice(0, 255);
    if (!curso_id || !materia || !esFechaValida(fecha)) return res.status(400).json({ estado: 'error', mensaje: 'Faltan la sección, la materia o la fecha.' });
    if (!motivo) return res.status(400).json({ estado: 'error', mensaje: 'Elija el motivo.' });
    try {
        const { dia, clase } = await buscarClase(curso_id, materia, fecha);
        if (!clase) return res.status(400).json({ estado: 'error', mensaje: 'Esa clase no está en el horario de ese día.' });
        if (dia.feriado) return res.status(400).json({ estado: 'error', mensaje: `Ese día no hay clases (${dia.feriado}).` });
        if (clase.estado === 'no_dada') return res.status(400).json({ estado: 'error', mensaje: 'Esa clase ya está marcada como no dada.' });
        if (clase.marcados > 0) return res.status(400).json({ estado: 'error', mensaje: 'Esa clase ya tiene lista guardada: sí se dio. Si hay que corregir, hágalo en la asistencia.' });

        const [r] = await db.query(
            'INSERT INTO clases_no_dadas (curso_id, materia, fecha, profesor_id, motivo, registrado_por) VALUES (?, ?, ?, ?, ?, ?)',
            [clase.curso_id, clase.materia, fecha, clase.profesor_id, motivo, req.usuario.id]
        );
        // Si tenía suplente, ya no hace falta
        await db.query('DELETE FROM suplencias WHERE curso_id = ? AND fecha = ? AND materia = ?', [clase.curso_id, fecha, clase.materia]);

        const texto = `${clase.materia} de ${clase.curso}${clase.turno ? ' · ' + clase.turno : ''} el ${fechaBonita(fecha)} (${clase.inicio}-${clase.fin})`;
        await notificar(db, await estudiantesIds(clase.curso_id), 'Clase no dada',
            `La clase de ${texto} no se dio: ${motivo}. No cuenta como falta.`, '/interfaces/estudiante/horarios.html');
        await notificar(db, clase.profesor_id, 'Su clase quedó como no dada',
            `La dirección registró como no dada la clase de ${texto}. Motivo: ${motivo}.`, '/interfaces/profesor/horarios.html');
        res.json({ estado: 'exitoso', id: r.insertId, mensaje: 'La clase quedó como no dada. Los estudiantes no tienen falta y recibieron un aviso.' });
    } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') return res.status(400).json({ estado: 'error', mensaje: 'Esa clase ya está marcada como no dada.' });
        console.error('Error al marcar clase no dada:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo guardar.' });
    }
});

// Quitar la marca de "no dada" (por ejemplo, al final sí se dio)
router.delete('/no-dada/:id', soloRoles('director'), async (req, res) => {
    try {
        const [[nd]] = await db.query("SELECT curso_id, materia, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, profesor_id FROM clases_no_dadas WHERE id = ?", [req.params.id]);
        const [r] = await db.query('DELETE FROM clases_no_dadas WHERE id = ?', [req.params.id]);
        if (r.affectedRows === 0) return res.status(404).json({ estado: 'error', mensaje: 'No se encontró esa marca.' });
        if (nd && nd.profesor_id) {
            await notificar(db, nd.profesor_id, 'Clase habilitada de nuevo',
                `La dirección quitó la marca de "no dada" de ${nd.materia} del ${fechaBonita(nd.fecha)}. Ya puede pasar la lista.`,
                `/interfaces/profesor/pasar_lista.html?curso_id=${nd.curso_id}&materia=${encodeURIComponent(nd.materia)}`);
        }
        res.json({ estado: 'exitoso', mensaje: 'Listo: la clase ya no está marcada como no dada. Ya se puede pasar lista.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo quitar la marca.' });
    }
});

// Asignar un suplente para una clase de un día (hoy o adelante)
router.post('/suplente', soloRoles('director'), async (req, res) => {
    const { curso_id, materia, fecha, profesor_id } = req.body || {};
    if (!curso_id || !materia || !esFechaValida(fecha) || !profesor_id) return res.status(400).json({ estado: 'error', mensaje: 'Faltan la clase, la fecha o el profesor suplente.' });
    if (fecha < hoyLocal()) return res.status(400).json({ estado: 'error', mensaje: 'El suplente se asigna para hoy o para un día que viene. Para días pasados corrija la asistencia.' });
    try {
        const { dia, clase } = await buscarClase(curso_id, materia, fecha);
        if (!clase) return res.status(400).json({ estado: 'error', mensaje: 'Esa clase no está en el horario de ese día.' });
        if (dia.feriado) return res.status(400).json({ estado: 'error', mensaje: `Ese día no hay clases (${dia.feriado}).` });
        if (clase.estado === 'no_dada') return res.status(400).json({ estado: 'error', mensaje: 'Esa clase está marcada como no dada. Quite esa marca primero.' });
        if (Number(profesor_id) === Number(clase.profesor_id)) return res.status(400).json({ estado: 'error', mensaje: 'El suplente tiene que ser otro profesor.' });

        const [[sup]] = await db.query("SELECT id, nombre, apellido FROM usuarios WHERE id = ? AND rol = 'profesor' AND activo = 1", [profesor_id]);
        if (!sup) return res.status(400).json({ estado: 'error', mensaje: 'El suplente tiene que ser un profesor activo.' });

        // El suplente no puede tener otra clase (ni otra suplencia) a esa misma hora
        const choque = await choqueDeProfesor(Number(profesor_id), dia.dia, fecha, clase);
        if (choque) return res.status(400).json({ estado: 'error', mensaje: `${sup.nombre} ${sup.apellido} ${choque}. Elija otro profesor.` });

        // Si ya había otro suplente, se le avisa que ya no cubre
        const [[antes]] = await db.query('SELECT profesor_suplente_id FROM suplencias WHERE curso_id = ? AND materia = ? AND fecha = ?', [clase.curso_id, clase.materia, fecha]);

        await db.query(`
            INSERT INTO suplencias (curso_id, materia, fecha, profesor_titular_id, profesor_suplente_id, registrado_por) VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE profesor_suplente_id = VALUES(profesor_suplente_id), registrado_por = VALUES(registrado_por)`,
            [clase.curso_id, clase.materia, fecha, clase.profesor_id, profesor_id, req.usuario.id]);

        const texto = `${clase.materia} de ${clase.curso}${clase.turno ? ' · ' + clase.turno : ''} el ${fechaBonita(fecha)} de ${clase.inicio} a ${clase.fin}`;
        const enlace = `/interfaces/profesor/pasar_lista.html?curso_id=${clase.curso_id}&materia=${encodeURIComponent(clase.materia)}`;
        if (antes && Number(antes.profesor_suplente_id) !== Number(profesor_id)) {
            await notificar(db, antes.profesor_suplente_id, 'Suplencia cancelada', `Ya no tiene que cubrir ${clase.materia} el ${fechaBonita(fecha)}: se asignó otro profesor.`, '/interfaces/profesor/index.html');
        }
        await notificar(db, Number(profesor_id), 'Suplencia asignada', `Usted cubre la clase de ${texto} (titular: ${clase.profesor}). Pase la lista ese día.`, enlace);
        await notificar(db, clase.profesor_id, 'Suplente para su clase', `${sup.nombre} ${sup.apellido} cubre su clase de ${texto}.`, '/interfaces/profesor/horarios.html');
        res.json({ estado: 'exitoso', mensaje: `${sup.nombre} ${sup.apellido} quedó como suplente y recibió un aviso.` });
    } catch (err) {
        console.error('Error al asignar suplente:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo asignar el suplente.' });
    }
});

router.delete('/suplente/:id', soloRoles('director'), async (req, res) => {
    try {
        const [[sp]] = await db.query("SELECT materia, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, profesor_suplente_id FROM suplencias WHERE id = ?", [req.params.id]);
        const [r] = await db.query('DELETE FROM suplencias WHERE id = ?', [req.params.id]);
        if (r.affectedRows === 0) return res.status(404).json({ estado: 'error', mensaje: 'No se encontró esa suplencia.' });
        if (sp) {
            await notificar(db, sp.profesor_suplente_id, 'Suplencia cancelada',
                `Ya no tiene que cubrir ${sp.materia} el ${fechaBonita(sp.fecha)}.`, '/interfaces/profesor/index.html');
        }
        res.json({ estado: 'exitoso', mensaje: 'Suplencia quitada.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo quitar la suplencia.' });
    }
});

// Suplencias del profesor (de hoy en adelante), para su panel
router.get('/mis-suplencias', soloRoles('profesor'), async (req, res) => {
    try {
        const hoy = hoyLocal();
        const [rows] = await db.query(`
            SELECT s.id, s.curso_id, s.materia, DATE_FORMAT(s.fecha, '%Y-%m-%d') AS fecha, CONCAT(t.nombre, ' ', t.apellido) AS titular
            FROM suplencias s LEFT JOIN usuarios t ON t.id = s.profesor_titular_id
            WHERE s.profesor_suplente_id = ? AND s.fecha >= ? ORDER BY s.fecha`, [req.usuario.id, hoy]);
        const datos = [];
        for (const s of rows) {
            const { clase } = await buscarClase(s.curso_id, s.materia, s.fecha);
            datos.push({ ...s, hoy: s.fecha === hoy, curso: clase ? clase.curso : '', turno: clase ? clase.turno : '',
                inicio: clase ? clase.inicio : '', fin: clase ? clase.fin : '', estado: clase ? clase.estado : '' });
        }
        res.json({ estado: 'exitoso', datos });
    } catch (err) {
        console.error(err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudieron leer las suplencias.' });
    }
});

module.exports = router;
