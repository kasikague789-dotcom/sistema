// Notificaciones dentro del sistema (campana en cada panel).
// Se pueden apagar en Director > Configuración > Notificaciones.
const { leerConfig, fechaLocal } = require('./util');

async function notificar(db, usuarioIds, titulo, mensaje, enlace = null) {
    try {
        const ids = [...new Set((Array.isArray(usuarioIds) ? usuarioIds : [usuarioIds]).filter(Boolean).map(Number))];
        if (ids.length === 0) return;
        const config = await leerConfig(db);
        if (!config.notificaciones_activas) return;
        const filas = ids.map(id => [id, String(titulo).slice(0, 150), String(mensaje || '').slice(0, 500), enlace]);
        await db.query('INSERT INTO notificaciones (usuario_id, titulo, mensaje, enlace) VALUES ?', [filas]);
    } catch (err) {
        // Una notificación que falla no debe romper la acción principal
        console.error('No se pudo crear la notificación:', err.message);
    }
}

async function idsDirectores(db) {
    const [rows] = await db.query("SELECT id FROM usuarios WHERE rol = 'director' AND activo = 1");
    return rows.map(r => r.id);
}

const fechaBonita = (f) => (f instanceof Date ? fechaLocal(f) : String(f).substring(0, 10)).split('-').reverse().join('/');

module.exports = { notificar, idsDirectores, fechaBonita };
