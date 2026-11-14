const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const { soloRoles } = require('../lib/auth');
const { esHoraValida, limpiarCacheGroserias } = require('../lib/util');
const { minutosBloqueo, sumarFallo, limpiarFallos, mensajeBloqueo } = require('../lib/intentos');
const { anioEscolarActual } = require('../lib/periodo');
const { puedeEnviar, nuevoCodigo, revisarCodigo, MENSAJE_CODIGO } = require('../lib/codigos');
const { enviarCodigoRecuperacion, ocultarCorreo } = require('../lib/correo');

// Solo estas claves se pueden guardar, cada una con su validación
const CLAVES = {
    hora_entrada: v => esHoraValida(v),
    porcentaje_asistencia_minimo: v => /^\d{1,3}$/.test(v) && Number(v) >= 0 && Number(v) <= 100,
    dias_maximos_justificar: v => /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 365,
    notificaciones_activas: v => v === 'true' || v === 'false',
    permitir_edicion_asistencia: v => v === 'true' || v === 'false',
    filtro_groserias_activo: v => v === 'true' || v === 'false',
    minutos_tolerancia: v => /^\d{1,3}$/.test(v) && Number(v) >= 0 && Number(v) <= 120,
    hora_cambio_turno: v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
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

        const extra = { anio_escolar_actual: await anioEscolarActual(db) };
        if (req.usuario && req.usuario.rol === 'director') {
            const fila = configRows.find(r => r.clave === 'clave_seguridad_director');
            extra.clave_seguridad_configurada = !!(fila && fila.valor);
        }
        res.json({ estado: 'exitoso', configuracion, groserias: groseriasRows, ...extra });
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

// Clave de seguridad del director: se pide para acciones delicadas (pasar de año).
// Para ponerla o cambiarla se pide la contraseña del director (y la clave anterior, si ya existe).
router.put('/clave-seguridad', soloRoles('director'), async (req, res) => {
    const { password, actual, nueva } = req.body || {};
    if (!password || !nueva) return res.status(400).json({ estado: 'error', mensaje: 'Escriba su contraseña y la nueva clave de seguridad.' });
    if (String(nueva).length < 8) return res.status(400).json({ estado: 'error', mensaje: 'La clave de seguridad debe tener al menos 8 caracteres.' });
    const llave = 'clave-seguridad:' + req.usuario.id;
    const espera = minutosBloqueo(llave);
    if (espera) return res.status(429).json({ estado: 'error', mensaje: mensajeBloqueo(espera) });
    try {
        const [[dir]] = await db.query('SELECT password FROM usuarios WHERE id = ?', [req.usuario.id]);
        if (!dir || !(await bcrypt.compare(String(password), dir.password || '').catch(() => false))) {
            sumarFallo(llave);
            return res.status(403).json({ estado: 'error', mensaje: 'Su contraseña no es correcta.' });
        }
        const [[fila]] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'clave_seguridad_director'");
        if (fila && fila.valor) {
            if (!actual || !(await bcrypt.compare(String(actual), fila.valor).catch(() => false))) {
                sumarFallo(llave);
                return res.status(403).json({ estado: 'error', mensaje: 'La clave de seguridad actual no es correcta.' });
            }
        }
        limpiarFallos(llave);
        if (await bcrypt.compare(String(nueva), dir.password || '').catch(() => false)) {
            return res.status(400).json({ estado: 'error', mensaje: 'La clave de seguridad debe ser distinta a su contraseña.' });
        }
        await db.query(
            "INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES ('clave_seguridad_director', ?, 'Clave de seguridad del director (cifrada)') ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
            [await bcrypt.hash(String(nueva), 10)]
        );
        res.json({ estado: 'exitoso', mensaje: 'Clave de seguridad guardada. Se la pediremos para pasar de año.' });
    } catch (err) {
        console.error('Error al guardar clave de seguridad:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo guardar la clave de seguridad.' });
    }
});

// ¿Olvidó la clave de seguridad? 1) Con su contraseña de entrada pide un código al correo.
router.post('/clave-seguridad/codigo', soloRoles('director'), async (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ estado: 'error', mensaje: 'Escriba su contraseña de entrada.' });
    const llaveFallos = 'clave-seguridad:' + req.usuario.id;
    const espera = minutosBloqueo(llaveFallos);
    if (espera) return res.status(429).json({ estado: 'error', mensaje: mensajeBloqueo(espera) });
    try {
        const [[dir]] = await db.query('SELECT nombre, email, password FROM usuarios WHERE id = ?', [req.usuario.id]);
        if (!dir || !(await bcrypt.compare(String(password || ''), dir.password || '').catch(() => false))) {
            sumarFallo(llaveFallos);
            return res.status(403).json({ estado: 'error', mensaje: 'Su contraseña no es correcta.' });
        }
        limpiarFallos(llaveFallos);
        if (!dir.email) return res.status(400).json({ estado: 'error', mensaje: 'Su cuenta no tiene correo guardado. Agréguelo en Mi perfil, o use la herramienta recuperar_acceso.js en el servidor.' });
        const llave = 'recuperar-seguridad:' + req.usuario.id;
        const minutos = puedeEnviar(llave);
        if (minutos) return res.status(429).json({ estado: 'error', mensaje: `Ya se enviaron varios códigos. Espere ${minutos} minuto(s) y revise también la carpeta de spam.` });
        const codigo = nuevoCodigo(llave);
        try {
            await enviarCodigoRecuperacion(dir.email, dir.nombre, codigo, 'clave de seguridad');
        } catch (errCorreo) {
            console.error('No se pudo enviar el código de la clave de seguridad:', errCorreo.message);
            return res.status(502).json({ estado: 'error', mensaje: 'No pudimos enviar el correo con el código. Intente en unos minutos. Quien maneja el servidor también puede quitar la clave con la herramienta recuperar_acceso.js.' });
        }
        const correo = ocultarCorreo(dir.email);
        res.json({ estado: 'exitoso', correo, mensaje: `Le enviamos un código a ${correo}. Vence en 15 minutos.` });
    } catch (err) {
        console.error('Error al pedir código de clave de seguridad:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo enviar el código.' });
    }
});

// 2) Con el código pone una clave de seguridad nueva (sin saber la anterior)
router.put('/clave-seguridad/recuperar', soloRoles('director'), async (req, res) => {
    const { codigo, nueva } = req.body || {};
    if (!codigo || !nueva) return res.status(400).json({ estado: 'error', mensaje: 'Escriba el código del correo y la nueva clave de seguridad.' });
    if (String(nueva).length < 8) return res.status(400).json({ estado: 'error', mensaje: 'La clave de seguridad debe tener al menos 8 caracteres.' });
    try {
        const [[dir]] = await db.query('SELECT password FROM usuarios WHERE id = ?', [req.usuario.id]);
        if (dir && await bcrypt.compare(String(nueva), dir.password || '').catch(() => false)) {
            return res.status(400).json({ estado: 'error', mensaje: 'La clave de seguridad debe ser distinta a su contraseña.' });
        }
        const r = revisarCodigo('recuperar-seguridad:' + req.usuario.id, codigo);
        if (r !== 'ok') return res.status(400).json({ estado: 'error', mensaje: MENSAJE_CODIGO[r] });
        await db.query(
            "INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES ('clave_seguridad_director', ?, 'Clave de seguridad del director (cifrada)') ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
            [await bcrypt.hash(String(nueva), 10)]
        );
        limpiarFallos('promocion:' + req.usuario.id);
        res.json({ estado: 'exitoso', mensaje: 'Clave de seguridad nueva guardada. La anterior ya no sirve.' });
    } catch (err) {
        console.error('Error al recuperar la clave de seguridad:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo guardar la clave de seguridad.' });
    }
});

module.exports = router;
