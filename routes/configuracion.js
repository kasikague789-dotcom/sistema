const express = require('express');
const router = express.Router();
const db = require('../db');
const { soloRoles } = require('../lib/auth');
const { esHoraValida, limpiarCacheGroserias } = require('../lib/util');

// Solo estas claves se pueden guardar, cada una con su validación
const CLAVES = {
    hora_entrada: v => esHoraValida(v),
    porcentaje_asistencia_minimo: v => /^\d{1,3}$/.test(v) && Number(v) >= 0 && Number(v) <= 100,
    dias_maximos_justificar: v => /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 365,
    notificaciones_activas: v => v === 'true' || v === 'false',
    permitir_edicion_asistencia: v => v === 'true' || v === 'false',
    filtro_groserias_activo: v => v === 'true' || v === 'false'
};
const NIVELES = ['leve', 'moderado', 'grave', 'muy_grave'];

// Cualquier usuario con sesión puede leerla (las pantallas la necesitan)
router.get('/', async (req, res) => {
    try {
        const [configRows] = await db.query('SELECT clave, valor FROM configuracion_sistema');
        const configuracion = {};
        configRows.forEach(row => {
            if (CLAVES[row.clave]) configuracion[row.clave] = row.valor;
        });

        const [groseriasRows] = await db.query('SELECT * FROM filtro_groserias ORDER BY palabra ASC');

        res.json({ estado: 'exitoso', configuracion, groserias: groseriasRows });
    } catch (err) {
        console.error('Error al obtener configuración:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener la configuración' });
    }
});


router.put('/', soloRoles('director'), async (req, res) => {
    const configs = req.body || {};
    const errores = [];
    const validas = [];
    for (const [clave, valorCrudo] of Object.entries(configs)) {
        if (!CLAVES[clave]) continue; // se ignoran claves desconocidas
        const valor = String(valorCrudo).trim();
        if (!CLAVES[clave](valor)) errores.push(clave);
        else validas.push([clave, valor]);
    }
    if (errores.length > 0) {
        return res.status(400).json({ estado: 'error', mensaje: `Valores no válidos en: ${errores.join(', ')}` });
    }
    try {
        for (const [clave, valor] of validas) {
            await db.query(
                'INSERT INTO configuracion_sistema (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
                [clave, valor]
            );
        }
        limpiarCacheGroserias();
        res.json({ estado: 'exitoso', mensaje: 'Configuración actualizada correctamente en la base de datos' });
    } catch (err) {
        console.error('Error al actualizar configuración:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al guardar la configuración' });
    }
});


router.post('/groserias', soloRoles('director'), async (req, res) => {
    const { palabra, nivel, reemplazo } = req.body || {};
    if (!palabra || !String(palabra).trim()) {
        return res.status(400).json({ estado: 'error', mensaje: 'La palabra es obligatoria' });
    }
    try {
        const [result] = await db.query(
            'INSERT INTO filtro_groserias (palabra, nivel, reemplazo) VALUES (?, ?, ?)',
            [String(palabra).toLowerCase().trim(), NIVELES.includes(nivel) ? nivel : 'leve', reemplazo || '***']
        );
        limpiarCacheGroserias();
        res.json({ estado: 'exitoso', mensaje: 'Grosería agregada', id: result.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ estado: 'error', mensaje: 'Esta palabra ya está registrada' });
        }
        console.error('Error al agregar grosería:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al guardar la palabra' });
    }
});


router.delete('/groserias/:id', soloRoles('director'), async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM filtro_groserias WHERE id = ?', [id]);
        limpiarCacheGroserias();
        res.json({ estado: 'exitoso', mensaje: 'Grosería eliminada correctamente' });
    } catch (err) {
        console.error('Error al eliminar grosería:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar la palabra' });
    }
});

module.exports = router;
