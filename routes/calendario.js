const express = require('express');
const router = express.Router();
const db = require('../db');
const { soloRoles } = require('../lib/auth');
const { esFechaValida } = require('../lib/util');

const TIPOS_SIN_CLASES = ['feriado', 'asueto', 'vacaciones'];
const afecta = (b) => (b.afecta_asistencia !== undefined ? (b.afecta_asistencia ? 1 : 0) : (TIPOS_SIN_CLASES.includes(b.tipo_evento || 'feriado') ? 1 : 0));

function validarEvento(b) {
    if (!b || !String(b.titulo || '').trim()) return 'El título es obligatorio.';
    if (!esFechaValida(b.fecha_inicio) || !esFechaValida(b.fecha_fin)) return 'Las fechas no son válidas.';
    if (b.fecha_fin < b.fecha_inicio) return 'La fecha fin no puede ser antes de la fecha inicio.';
    if (b.color_evento && !/^#[0-9a-fA-F]{6}$/.test(b.color_evento)) return 'El color no es válido.';
    return null;
}

router.get('/eventos', async (req, res) => {
    try {
        // El director ve todo; el profesor y el estudiante, los eventos generales y los de sus secciones
        let filtro = '';
        const params = [];
        if (req.usuario && req.usuario.rol === 'estudiante') {
            filtro = 'WHERE curso_id IS NULL OR curso_id = 0 OR curso_id IN (SELECT curso_id FROM estudiante_curso WHERE estudiante_id = ? AND activo = 1)';
            params.push(req.usuario.id);
        } else if (req.usuario && req.usuario.rol === 'profesor') {
            filtro = 'WHERE curso_id IS NULL OR curso_id = 0 OR curso_id IN (SELECT curso_id FROM profesor_curso WHERE profesor_id = ? AND activo = 1)';
            params.push(req.usuario.id);
        }
        const [rows] = await db.query(`
            SELECT id, titulo, descripcion, 
                   DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
                   DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin, 
                   DATE_FORMAT(hora_inicio, '%H:%i') AS hora_inicio,
                   DATE_FORMAT(hora_fin, '%H:%i') AS hora_fin,
                   materia, curso_id, tipo_evento, afecta_asistencia, color_evento, creado_por
            FROM calendario_academico ${filtro} ORDER BY fecha_inicio ASC
        `, params);
        res.json({ estado: 'exitoso', datos: rows });
    } catch (error) {
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener el calendario' });
    }
});

router.post('/eventos', soloRoles('director'), async (req, res) => {
    const errorValidacion = validarEvento(req.body);
    if (errorValidacion) return res.status(400).json({ estado: 'error', mensaje: errorValidacion });
    
    const { titulo, descripcion, fecha_inicio, fecha_fin, hora_inicio, hora_fin, materia, curso_id, tipo_evento, color_evento } = req.body;
    
    try {
        const query = `
            INSERT INTO calendario_academico 
            (titulo, descripcion, fecha_inicio, fecha_fin, hora_inicio, hora_fin, materia, curso_id, tipo_evento, afecta_asistencia, color_evento, creado_por) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await db.query(query, [
            titulo, 
            descripcion || '', 
            fecha_inicio, 
            fecha_fin, 
            hora_inicio || null,
            hora_fin || null,
            materia || null,
            curso_id ? parseInt(curso_id) : null,
            tipo_evento || 'feriado', 
            afecta(req.body), 
            color_evento || '#FF0000', 
            req.usuario.id
        ]);

        res.json({ estado: 'exitoso', mensaje: 'Evento guardado correctamente', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ estado: 'error', mensaje: 'Error al registrar el evento' });
    }
});

router.put('/eventos/:id', soloRoles('director'), async (req, res) => {
    const { id } = req.params;
    const errorValidacion = validarEvento(req.body);
    if (errorValidacion) return res.status(400).json({ estado: 'error', mensaje: errorValidacion });
    
    const { titulo, descripcion, fecha_inicio, fecha_fin, hora_inicio, hora_fin, materia, curso_id, tipo_evento, color_evento } = req.body;
    
    try {
        const query = `
            UPDATE calendario_academico 
            SET titulo = ?, descripcion = ?, fecha_inicio = ?, fecha_fin = ?, hora_inicio = ?, hora_fin = ?, materia = ?, curso_id = ?, tipo_evento = ?, color_evento = ?, afecta_asistencia = ?
            WHERE id = ?
        `;
        const [result] = await db.query(query, [
            titulo, 
            descripcion || '', 
            fecha_inicio, 
            fecha_fin, 
            hora_inicio || null,
            hora_fin || null,
            materia || null,
            curso_id ? parseInt(curso_id) : null,
            tipo_evento || 'feriado', 
            color_evento || '#FF0000', 
            afecta(req.body), 
            id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ estado: 'error', mensaje: `No se encontró el evento con ID ${id}` });
        }

        res.json({ estado: 'exitoso', mensaje: 'Evento actualizado correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ estado: 'error', mensaje: 'Error al actualizar el evento' });
    }
});

router.delete('/eventos/:id', soloRoles('director'), async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM calendario_academico WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ estado: 'error', mensaje: `No existe ningún evento con ID ${id} en MySQL` });
        }
        res.json({ estado: 'exitoso', mensaje: 'Evento eliminado correctamente de la base de datos' });
    } catch (error) {
        res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar el evento' });
    }
});

module.exports = router;