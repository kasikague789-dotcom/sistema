const express = require('express');
const router = express.Router();
const db = require('../db');
const { leerConfig } = require('../lib/util');

// Las del usuario con sesión (últimas 30)
router.get('/', async (req, res) => {
    try {
        const config = await leerConfig(db);
        const [datos] = await db.query(`
            SELECT id, titulo, mensaje, enlace, leida, DATE_FORMAT(fecha, '%d/%m/%Y %H:%i') AS fecha
            FROM notificaciones WHERE usuario_id = ? ORDER BY id DESC LIMIT 30
        `, [req.usuario.id]);
        const [[c]] = await db.query('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = ? AND leida = 0', [req.usuario.id]);
        res.json({ estado: 'exitoso', activas: config.notificaciones_activas, sin_leer: c.n, datos });
    } catch (err) {
        console.error('Error al leer notificaciones:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al leer las notificaciones' });
    }
});

// Marcar todas como leídas
router.put('/leidas', async (req, res) => {
    try {
        await db.query('UPDATE notificaciones SET leida = 1 WHERE usuario_id = ? AND leida = 0', [req.usuario.id]);
        res.json({ estado: 'exitoso' });
    } catch (err) {
        console.error('Error al marcar notificaciones:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al marcar las notificaciones' });
    }
});

module.exports = router;
