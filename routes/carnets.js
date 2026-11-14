// Carnet QR y foto del estudiante.
//  - El director ve y descarga el QR de cada estudiante, lo cambia si se pierde el carnet y sube la foto.
//  - La foto se guarda en la base de datos (en la nube los archivos del disco se borran al volver a publicar).
const express = require('express');
const router = express.Router();
const db = require('../db');
const { soloRoles } = require('../lib/auth');
const { datosCarnet, carnetVigente, anularCarnets } = require('../lib/carnet');
const { anioEscolarActual, textoPeriodo } = require('../lib/periodo');

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FOTO = 1024 * 1024; // 1 MB (la pantalla la achica antes de subirla)

// Carnet de un estudiante (se crea el código si aún no tiene uno en este periodo)
router.get('/estudiante/:id', soloRoles('director'), async (req, res) => {
    try {
        const d = await datosCarnet(db, req.params.id, req.usuario.id);
        if (!d) return res.status(404).json({ estado: 'error', mensaje: 'Estudiante no encontrado.' });
        res.json({ estado: 'exitoso', datos: d });
    } catch (err) {
        console.error('Error al cargar carnet:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo cargar el carnet.' });
    }
});

// Carnet perdido o dañado: el código viejo deja de servir y se crea otro
router.post('/estudiante/:id/regenerar', soloRoles('director'), async (req, res) => {
    try {
        const [[est]] = await db.query("SELECT id FROM usuarios WHERE id = ? AND rol = 'estudiante'", [req.params.id]);
        if (!est) return res.status(404).json({ estado: 'error', mensaje: 'Estudiante no encontrado.' });
        const motivo = String((req.body && req.body.motivo) || 'Carnet reemplazado').slice(0, 100);
        await anularCarnets(db, est.id, motivo);
        await carnetVigente(db, est.id, req.usuario.id);
        const d = await datosCarnet(db, est.id, req.usuario.id);
        res.json({ estado: 'exitoso', mensaje: 'Se generó un código nuevo. El carnet anterior ya no sirve para pasar lista.', datos: d });
    } catch (err) {
        console.error('Error al regenerar carnet:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo generar el código nuevo.' });
    }
});

// Todos los carnets de una sección (para imprimir o dárselos a quienes diseñan el carnet)
router.get('/seccion/:cursoId', soloRoles('director'), async (req, res) => {
    try {
        const [[curso]] = await db.query('SELECT id, nombre, seccion, turno, nivel FROM cursos WHERE id = ?', [req.params.cursoId]);
        if (!curso) return res.status(404).json({ estado: 'error', mensaje: 'Sección no encontrada.' });
        const [ests] = await db.query(`
            SELECT DISTINCT u.id, u.apellido, u.nombre FROM estudiante_curso ec
            JOIN usuarios u ON u.id = ec.estudiante_id
            WHERE ec.curso_id = ? AND ec.activo = 1 AND u.activo = 1 AND u.rol = 'estudiante'
            ORDER BY u.apellido, u.nombre
        `, [curso.id]);
        const datos = [];
        for (const e of ests) datos.push(await datosCarnet(db, e.id, req.usuario.id));
        const anio = await anioEscolarActual(db);
        res.json({ estado: 'exitoso', curso, periodo: textoPeriodo(anio), datos });
    } catch (err) {
        console.error('Error al cargar carnets de la sección:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudieron cargar los carnets.' });
    }
});

// ¿Quién puede ver la foto? El director, el propio estudiante y los profesores de su sección
async function puedeVerFoto(usuario, estudianteId) {
    if (usuario.rol === 'director' || String(usuario.id) === String(estudianteId)) return true;
    if (usuario.rol !== 'profesor') return false;
    const [r] = await db.query(`
        SELECT 1 FROM estudiante_curso ec
        JOIN profesor_curso pc ON pc.curso_id = ec.curso_id AND pc.activo = 1
        WHERE ec.estudiante_id = ? AND ec.activo = 1 AND pc.profesor_id = ? LIMIT 1
    `, [estudianteId, usuario.id]);
    return r.length > 0;
}

router.get('/foto/:id', async (req, res) => {
    try {
        if (!(await puedeVerFoto(req.usuario, req.params.id))) {
            return res.status(403).json({ estado: 'error', mensaje: 'No tiene permiso para ver esta foto.' });
        }
        const [[f]] = await db.query('SELECT tipo, datos FROM fotos_usuario WHERE usuario_id = ?', [req.params.id]);
        if (!f) return res.status(404).json({ estado: 'error', mensaje: 'Sin foto.' });
        res.set('Content-Type', f.tipo);
        res.set('Cache-Control', 'private, max-age=300');
        res.send(f.datos);
    } catch (err) {
        console.error('Error al leer foto:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo leer la foto.' });
    }
});

router.put('/foto/:id', soloRoles('director'), async (req, res) => {
    try {
        const { tipo, base64 } = req.body || {};
        if (!TIPOS_FOTO.includes(tipo)) return res.status(400).json({ estado: 'error', mensaje: 'La foto debe ser JPG, PNG o WEBP.' });
        const datos = Buffer.from(String(base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
        if (datos.length < 100) return res.status(400).json({ estado: 'error', mensaje: 'La foto está vacía o dañada.' });
        if (datos.length > MAX_FOTO) return res.status(400).json({ estado: 'error', mensaje: 'La foto pesa más de 1 MB.' });
        // Revisar que de verdad sea una imagen (primeros bytes del archivo)
        const esJpg = datos[0] === 0xFF && datos[1] === 0xD8;
        const esPng = datos.slice(0, 4).toString('hex') === '89504e47';
        const esWebp = datos.slice(0, 4).toString() === 'RIFF' && datos.slice(8, 12).toString() === 'WEBP';
        if (!esJpg && !esPng && !esWebp) return res.status(400).json({ estado: 'error', mensaje: 'El archivo no es una imagen válida.' });
        const tipoReal = esJpg ? 'image/jpeg' : esPng ? 'image/png' : 'image/webp'; // se guarda el tipo real, no el que diga el navegador

        const [[u]] = await db.query("SELECT id FROM usuarios WHERE id = ? AND rol = 'estudiante'", [req.params.id]);
        if (!u) return res.status(404).json({ estado: 'error', mensaje: 'Estudiante no encontrado.' });
        await db.query(`
            INSERT INTO fotos_usuario (usuario_id, tipo, datos, actualizado_por) VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE tipo = VALUES(tipo), datos = VALUES(datos), actualizado_por = VALUES(actualizado_por)
        `, [u.id, tipoReal, datos, req.usuario.id]);
        res.json({ estado: 'exitoso', mensaje: 'Foto guardada.' });
    } catch (err) {
        console.error('Error al guardar foto:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo guardar la foto.' });
    }
});

router.delete('/foto/:id', soloRoles('director'), async (req, res) => {
    try {
        await db.query('DELETE FROM fotos_usuario WHERE usuario_id = ?', [req.params.id]);
        res.json({ estado: 'exitoso', mensaje: 'Foto quitada.' });
    } catch (err) {
        console.error('Error al quitar foto:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo quitar la foto.' });
    }
});

module.exports = router;
