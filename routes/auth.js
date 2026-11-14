const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { crearToken, soloRoles, soloPropio } = require('../lib/auth');
const { normalizarCedula, esEmailValido } = require('../lib/util');
const { puedeEnviar, nuevoCodigo, revisarCodigo, MENSAJE_CODIGO } = require('../lib/codigos');
const { enviarCodigoRecuperacion, ocultarCorreo } = require('../lib/correo');

const CLAVE_MINIMA = 6;
const MSG_DIRECTOR_UNICO = 'Solo existe un director (super administrador). Asigne el rol de estudiante o profesor.';

// Intentos fallidos de código por correo (se borra al reiniciar el servidor)
const intentosCodigo = new Map();
function codigoBloqueado(email) {
    const r = intentosCodigo.get(String(email || '').toLowerCase());
    return r && r.n >= 5 && r.hasta > Date.now();
}
function sumarIntento(email) {
    const k = String(email || '').toLowerCase();
    const r = intentosCodigo.get(k) || { n: 0, hasta: 0 };
    r.n++; r.hasta = Date.now() + 15 * 60 * 1000;
    intentosCodigo.set(k, r);
    return r.n;
}
const limpiarIntentos = (email) => intentosCodigo.delete(String(email || '').toLowerCase());

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

async function enviarCodigoVerificacion(destinatario, nombre, codigo) {
    const htmlBonito = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #1a202c; margin: 0;">U.E. Instituto Elena de Bueno</h2>
                <p style="color: #718096; font-size: 14px; margin: 5px 0;">Verificación de correo</p>
            </div>
            <p style="color: #4a5568; font-size: 15px;">Hola <strong>${nombre}</strong>,</p>
            <p style="color: #4a5568; font-size: 15px;">Tu código de verificación para el nuevo correo es:</p>
            <div style="background: white; border: 2px dashed #3182ce; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <h1 style="color: #3182ce; letter-spacing: 8px; margin: 0; font-size: 36px;">${codigo}</h1>
            </div>
            <p style="color: #718096; font-size: 13px;">Expira en 15 minutos.</p>
        </div>
    `;
    await transporter.sendMail({
        from: `"U.E. Elena de Bueno" <${process.env.EMAIL_FROM}>`,
        to: destinatario,
        subject: 'Verificación de nuevo correo - Sistema de Asistencia',
        html: htmlBonito
    });
}

function generarCodigo() { return Math.floor(100000 + Math.random() * 900000).toString(); }

// Busca una cuenta por correo o cédula (igual que el login)
async function buscarPorIdentificador(usuario) {
    const identificador = String(usuario || '').trim();
    if (!identificador) return null;
    const cedula = identificador.includes('@') ? null : normalizarCedula(identificador);
    const [users] = await db.query('SELECT * FROM usuarios WHERE email = ? OR cedula = ? LIMIT 1', [identificador, cedula || identificador]);
    return users[0] || null;
}

const MSG_CLAVE_TEMPORAL = 'Pida al director o a Control de Estudios una clave temporal. Ellos la asignan en Usuarios > Editar. Luego cámbiela en "Mi Perfil".';
const MSG_HERRAMIENTA = 'Quien maneja el servidor también puede poner una clave nueva con la herramienta recuperar_acceso.js.';

// ¿Olvidó su contraseña? El director recibe un código en su correo; los demás piden una clave temporal a la dirección.
router.post('/recuperar', async (req, res) => {
    try {
        const user = await buscarPorIdentificador(req.body && req.body.usuario);
        if (!user || user.rol !== 'director' || !user.password) {
            return res.json({ estado: 'exitoso', enviado: false, mensaje: MSG_CLAVE_TEMPORAL });
        }
        if (!user.email) return res.status(400).json({ estado: 'error', mensaje: 'La cuenta del director no tiene correo guardado. ' + MSG_HERRAMIENTA });
        const llave = 'recuperar-clave:' + user.id;
        const espera = puedeEnviar(llave);
        if (espera) return res.status(429).json({ estado: 'error', mensaje: `Ya se enviaron varios códigos. Espere ${espera} minuto(s) y revise también la carpeta de spam.` });
        const codigo = nuevoCodigo(llave);
        try {
            await enviarCodigoRecuperacion(user.email, user.nombre, codigo, 'contraseña');
        } catch (errCorreo) {
            console.error('No se pudo enviar el código de recuperación:', errCorreo.message);
            return res.status(502).json({ estado: 'error', mensaje: 'No pudimos enviar el correo con el código. Intente en unos minutos. ' + MSG_HERRAMIENTA });
        }
        const correo = ocultarCorreo(user.email);
        res.json({ estado: 'exitoso', enviado: true, correo, mensaje: `Le enviamos un código a ${correo}. Vence en 15 minutos.` });
    } catch (err) {
        console.error('Error al recuperar contraseña:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error del servidor. Intente de nuevo.' });
    }
});

// Con el código del correo, el director pone una contraseña nueva
router.post('/recuperar/cambiar', async (req, res) => {
    const { usuario, codigo, nueva } = req.body || {};
    if (!codigo || !nueva) return res.status(400).json({ estado: 'error', mensaje: 'Escriba el código del correo y la contraseña nueva.' });
    if (String(nueva).length < CLAVE_MINIMA) return res.status(400).json({ estado: 'error', mensaje: `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.` });
    try {
        const user = await buscarPorIdentificador(usuario);
        if (!user || user.rol !== 'director') return res.status(400).json({ estado: 'error', mensaje: 'El código no es correcto. Pida uno nuevo.' });
        const r = revisarCodigo('recuperar-clave:' + user.id, codigo);
        if (r !== 'ok') return res.status(400).json({ estado: 'error', mensaje: MENSAJE_CODIGO[r] });
        await db.query('UPDATE usuarios SET password = ?, verificado = 1 WHERE id = ?', [await bcrypt.hash(String(nueva), 10), user.id]);
        res.json({ estado: 'exitoso', mensaje: 'Contraseña cambiada. Ya puede iniciar sesión con la nueva.' });
    } catch (err) {
        console.error('Error al cambiar la contraseña con código:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error del servidor. Intente de nuevo.' });
    }
});

// LOGIN
router.post('/login', async (req, res) => {
    const { usuario, password, recordar } = req.body;
    if (!usuario || !password) return res.status(400).json({ estado: 'error', mensaje: 'Ingrese correo/cédula y contraseña.' });

    try {
        const identificador = String(usuario).trim();
        // Correo tal cual; cédula también con V-, puntos o espacios
        const cedula = identificador.includes('@') ? null : normalizarCedula(identificador);
        const [users] = await db.query('SELECT * FROM usuarios WHERE email = ? OR cedula = ? LIMIT 1', [identificador, cedula || identificador]);
        if (users.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'No existe una cuenta con ese correo o cédula.', sin_cuenta: true });

        const user = users[0];
        // Inscrito por el director pero aún sin cuenta: antes daba "Error del servidor"
        if (!user.password) {
            return res.status(401).json({ estado: 'error', sin_cuenta: true, mensaje: 'Esta persona aún no ha creado su cuenta. Use "Regístrese aquí" con su cédula.' });
        }
        if (!(await bcrypt.compare(String(password), user.password).catch(() => false))) {
            return res.status(401).json({ estado: 'error', mensaje: 'Contraseña incorrecta.' });
        }
        if (user.activo == 0) return res.status(403).json({ estado: 'error', mensaje: 'Cuenta desactivada.' });
        if (user.verificado == 0) return res.status(403).json({ estado: 'error', mensaje: 'Falta confirmar su correo. Entre a "Regístrese aquí" con su cédula y el mismo correo: le llegará un código nuevo.', requiere_verificacion: true, email: user.email });

        const duracionHoras = recordar ? (24 * 30) : 12; 
        const token = crearToken({ id: user.id, rol: user.rol }, duracionHoras);

        res.json({
            estado: 'exitoso',
            token: token,
            usuario: { id: user.id, nombre: user.nombre, apellido: user.apellido, email: user.email, rol: user.rol }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ estado: 'error', mensaje: 'Error del servidor.' });
    }
});

// REGISTRO
router.post('/registro', async (req, res) => {
    const { nombre, apellido, cedula, email, password } = req.body;
    if (!nombre || !apellido || !cedula || !email || !password) return res.status(400).json({ estado: 'error', mensaje: 'Todos los campos son obligatorios.' });
    const cedulaLimpia = normalizarCedula(cedula);
    if (!cedulaLimpia) return res.status(400).json({ estado: 'error', mensaje: 'La cédula debe tener solo números (5 a 10 dígitos).' });
    if (!esEmailValido(email)) return res.status(400).json({ estado: 'error', mensaje: 'Escriba un correo válido.' });
    if (String(password).length < CLAVE_MINIMA) return res.status(400).json({ estado: 'error', mensaje: `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.` });

    try {
        const [existeCedula] = await db.query('SELECT * FROM usuarios WHERE cedula = ?', [cedulaLimpia]);
        if (existeCedula.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usted no está registrado en la institución.' });

        const user = existeCedula[0];
        if (user.activo == 0) return res.status(403).json({ estado: 'error', mensaje: 'Esta cuenta está desactivada. Hable con la dirección.' });
        if (user.verificado == 1 && user.password) return res.status(400).json({ estado: 'error', mensaje: 'Esta cédula ya tiene una cuenta verificada.' });
        // Ya empezó el registro con otro correo: nadie más puede "tomar" esa cuenta cambiando el correo
        if (user.password && user.email && user.email.toLowerCase() !== String(email).trim().toLowerCase()) {
            return res.status(400).json({ estado: 'error', mensaje: 'Esta cédula ya empezó el registro con otro correo. Revise ese correo o pida a la dirección que lo reinicie.' });
        }

        const [existeEmail] = await db.query('SELECT * FROM usuarios WHERE email = ? AND id != ?', [email, user.id]);
        if (existeEmail.length > 0) return res.status(400).json({ estado: 'error', mensaje: 'El correo ya está en uso.' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const codigo = generarCodigo();
        const expiracion = new Date(Date.now() + 15 * 60 * 1000);

        await db.query(
            // Si la dirección ya cargó nombre y apellido, esos se quedan (son los oficiales)
            `UPDATE usuarios SET nombre = IF(nombre IS NULL OR TRIM(nombre) = '', ?, nombre), apellido = IF(apellido IS NULL OR TRIM(apellido) = '', ?, apellido),
                    email = ?, password = ?, verificado = 0, codigo_verificacion = ?, codigo_expiracion = ? WHERE id = ?`,
            [String(nombre).trim(), String(apellido).trim(), email, hashedPassword, codigo, expiracion, user.id]
        );

        try {
            await enviarCodigoVerificacion(email, nombre, codigo);
        } catch (errCorreo) {
            console.error('No se pudo enviar el código de registro:', errCorreo.message);
            return res.status(502).json({
                estado: 'error', requiere_verificacion: true, email,
                mensaje: 'Su registro quedó guardado, pero no pudimos enviar el correo con el código. Revise que el correo esté bien escrito y toque "Reenviar código" en unos minutos. Si sigue fallando, avise a la dirección.'
            });
        }
        res.json({ estado: 'exitoso', mensaje: 'Te enviamos un código a tu correo.', requiere_verificacion: true, email: email });
    } catch (err) {
        console.error(err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al registrar.' });
    }
});

// VERIFICAR (Registro)
router.post('/verificar', async (req, res) => {
    const { email, codigo } = req.body;
    try {
        const [users] = await db.query('SELECT id, codigo_verificacion, codigo_expiracion, verificado FROM usuarios WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado.' });

        const user = users[0];
        if (user.verificado == 1) return res.json({ estado: 'exitoso', mensaje: 'Tu cuenta ya está verificada.' });
        if (codigoBloqueado(email)) return res.status(429).json({ estado: 'error', mensaje: 'Demasiados intentos. Pida un código nuevo con "Reenviar".' });
        if (!user.codigo_verificacion || user.codigo_verificacion !== String(codigo || '').trim()) {
            if (sumarIntento(email) >= 5) {
                await db.query('UPDATE usuarios SET codigo_verificacion = NULL WHERE id = ?', [user.id]);
                return res.status(429).json({ estado: 'error', mensaje: 'Demasiados intentos. Pida un código nuevo con "Reenviar".' });
            }
            return res.status(400).json({ estado: 'error', mensaje: 'Código incorrecto.' });
        }
        if (new Date(user.codigo_expiracion) < new Date()) return res.status(400).json({ estado: 'error', mensaje: 'El código ha expirado.' });

        await db.query('UPDATE usuarios SET verificado = 1, codigo_verificacion = NULL, codigo_expiracion = NULL WHERE id = ?', [user.id]);
        limpiarIntentos(email);
        res.json({ estado: 'exitoso', mensaje: '¡Correo verificado! Ya puedes iniciar sesión.' });
    } catch (err) {
        res.status(500).json({ estado: 'error', mensaje: 'Error al verificar.' });
    }
});

// REENVIAR (Registro)
router.post('/reenviar', async (req, res) => {
    const { email } = req.body;
    try {
        const [users] = await db.query('SELECT id, nombre, verificado FROM usuarios WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'No hay cuenta con ese correo.' });
        if (users[0].verificado == 1) return res.status(400).json({ estado: 'error', mensaje: 'Esta cuenta ya está verificada.' });

        const nuevoCodigo = generarCodigo();
        const nuevaExpiracion = new Date(Date.now() + 15 * 60 * 1000);
        await db.query('UPDATE usuarios SET codigo_verificacion = ?, codigo_expiracion = ? WHERE id = ?', [nuevoCodigo, nuevaExpiracion, users[0].id]);
        limpiarIntentos(email);
        await enviarCodigoVerificacion(email, users[0].nombre, nuevoCodigo);
        res.json({ estado: 'exitoso', mensaje: 'Te enviamos un nuevo código.' });
    } catch (err) {
        console.error('No se pudo reenviar el código:', err.message);
        res.status(502).json({ estado: 'error', mensaje: 'No pudimos enviar el correo. Intente en unos minutos; si sigue fallando, avise a la dirección.' });
    }
});

// ==========================================
// PERFIL Y CONTRASEÑA (CON VALIDACIÓN DE CORREO)
// ==========================================

router.get('/perfil/:id', soloPropio('id'), async (req, res) => {
    try {
        const [user] = await db.query(`
            SELECT u.id, u.nombre, u.apellido, u.cedula, u.email, u.telefono, u.rol, u.fecha_registro,
                   c.nombre AS curso_nombre, c.seccion AS curso_seccion, c.turno AS curso_turno, c.nivel AS curso_nivel, ec.anio_academico
            FROM usuarios u
            LEFT JOIN estudiante_curso ec ON u.id = ec.estudiante_id AND ec.activo = 1
            LEFT JOIN cursos c ON ec.curso_id = c.id
            WHERE u.id = ? LIMIT 1
        `, [req.params.id]);
        if (user.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });
        res.json({ estado: 'exitoso', datos: user[0] });
    } catch (err) {
        res.status(500).json({ estado: 'error', mensaje: err.message });
    }
});

router.put('/perfil/:id', soloPropio('id'), async (req, res) => {
    const { id } = req.params;
    let { nombre, apellido } = req.body || {};
    const { telefono } = req.body || {};
    const email = String((req.body && req.body.email) || '').trim();
    if (req.usuario.rol === 'estudiante') {
        const [[actual]] = await db.query('SELECT nombre, apellido FROM usuarios WHERE id = ?', [id]);
        if (actual) { nombre = actual.nombre; apellido = actual.apellido; }
    }
    if (!String(nombre || '').trim() || !String(apellido || '').trim()) {
        return res.status(400).json({ estado: 'error', mensaje: 'Nombre y apellido son obligatorios.' });
    }
    if (email && !esEmailValido(email)) return res.status(400).json({ estado: 'error', mensaje: 'Escriba un correo válido.' });

    try {
        const [users] = await db.query('SELECT email, nombre FROM usuarios WHERE id = ?', [id]);
        if (users.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });

        const emailActual = users[0].email;

        // ¿El correo cambió?
        if (email && email.toLowerCase() !== (emailActual || '').toLowerCase()) {
            const [existe] = await db.query('SELECT id FROM usuarios WHERE email = ? AND id != ?', [email, id]);
            if (existe.length > 0) return res.status(400).json({ estado: 'error', mensaje: 'El correo ya está en uso por otra persona.' });

            // Generamos código para el nuevo correo
            const codigo = generarCodigo();
            const expiracion = new Date(Date.now() + 15 * 60 * 1000);

            // Se guarda a qué correo se mandó el código: solo ESE correo se puede confirmar
            await db.query('UPDATE usuarios SET codigo_verificacion = ?, codigo_expiracion = ?, email_pendiente = ? WHERE id = ?', [codigo, expiracion, email, id]);
            limpiarIntentos(email);
            try {
                await enviarCodigoVerificacion(email, nombre || users[0].nombre, codigo);
            } catch (errCorreo) {
                console.error('No se pudo enviar el código del correo nuevo:', errCorreo.message);
                await db.query('UPDATE usuarios SET codigo_verificacion = NULL, email_pendiente = NULL WHERE id = ?', [id]);
                return res.status(502).json({ estado: 'error', mensaje: 'No pudimos enviar el código al correo nuevo. Revise que esté bien escrito e intente en unos minutos. Su correo actual no cambió.' });
            }

            return res.json({ 
                estado: 'exitoso', 
                requiere_verificacion_cambio: true, 
                mensaje: 'Te enviamos un código al nuevo correo para confirmar el cambio.' 
            });
        }

        // Si NO cambió el correo, actualizamos todo normal
        await db.query('UPDATE usuarios SET nombre = ?, apellido = ?, email = ?, telefono = ? WHERE id = ?', [String(nombre).trim(), String(apellido).trim(), email || emailActual, telefono || '', id]);
        res.json({ estado: 'exitoso', mensaje: 'Perfil actualizado correctamente' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al actualizar el perfil.' });
    }
});

// NUEVA RUTA: Confirmar el cambio de correo con el código
router.post('/perfil/verificar-nuevo-correo', async (req, res) => {
    const { codigo, nombre, apellido, telefono } = req.body;
    // Cada quien confirma SU correo (el director puede hacerlo por otro)
    const id = req.usuario.rol === 'director' && req.body.id ? req.body.id : req.usuario.id;

    try {
        const [users] = await db.query('SELECT nombre, apellido, telefono, codigo_verificacion, codigo_expiracion, email_pendiente FROM usuarios WHERE id = ?', [id]);
        if (users.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });

        const user = users[0];
        const nuevoEmail = user.email_pendiente;
        if (!nuevoEmail) return res.status(400).json({ estado: 'error', mensaje: 'No hay un cambio de correo pendiente. Vuelva a guardar su perfil.' });
        if (codigoBloqueado(nuevoEmail)) return res.status(429).json({ estado: 'error', mensaje: 'Demasiados intentos. Vuelva a guardar su perfil para recibir otro código.' });
        if (!user.codigo_verificacion || user.codigo_verificacion !== String(codigo || '').trim()) {
            if (sumarIntento(nuevoEmail) >= 5) await db.query('UPDATE usuarios SET codigo_verificacion = NULL WHERE id = ?', [id]);
            return res.status(400).json({ estado: 'error', mensaje: 'Código incorrecto.' });
        }
        if (new Date(user.codigo_expiracion) < new Date()) return res.status(400).json({ estado: 'error', mensaje: 'El código ha expirado.' });
        const [ocupado] = await db.query('SELECT id FROM usuarios WHERE email = ? AND id <> ?', [nuevoEmail, id]);
        if (ocupado.length > 0) return res.status(400).json({ estado: 'error', mensaje: 'Ese correo ya lo usa otra persona.' });

        // Código correcto: se guarda el correo al que se mandó el código (no el que venga en la petición)
        await db.query(
            'UPDATE usuarios SET nombre = ?, apellido = ?, email = ?, telefono = ?, codigo_verificacion = NULL, codigo_expiracion = NULL, email_pendiente = NULL WHERE id = ?',
            [String((req.usuario.rol !== 'estudiante' && nombre) || user.nombre).trim(), String((req.usuario.rol !== 'estudiante' && apellido) || user.apellido).trim(), nuevoEmail, telefono !== undefined ? telefono : (user.telefono || ''), id]
        );
        limpiarIntentos(nuevoEmail);

        res.json({ estado: 'exitoso', mensaje: 'Correo actualizado y verificado correctamente.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al verificar el nuevo correo.' });
    }
});

router.put('/cambiar-password/:id', soloPropio('id'), async (req, res) => {
    const { actual, nueva } = req.body;
    if (!actual || !nueva) return res.status(400).json({ estado: 'error', mensaje: 'Escriba la contraseña actual y la nueva.' });
    if (String(nueva).length < CLAVE_MINIMA) return res.status(400).json({ estado: 'error', mensaje: `La nueva contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.` });
    try {
        const [users] = await db.query('SELECT password FROM usuarios WHERE id = ?', [req.params.id]);
        if (users.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });
        if (!users[0].password) return res.status(400).json({ estado: 'error', mensaje: 'Esta cuenta aún no tiene contraseña.' });

        const passwordValida = await bcrypt.compare(String(actual), users[0].password).catch(() => false);
        if (!passwordValida) return res.status(403).json({ estado: 'error', mensaje: 'La contraseña actual es incorrecta' });

        const nuevaEncriptada = await bcrypt.hash(nueva, 10);
        await db.query('UPDATE usuarios SET password = ? WHERE id = ?', [nuevaEncriptada, req.params.id]);
        res.json({ estado: 'exitoso', mensaje: 'Contraseña actualizada correctamente' });
    } catch (err) {
        res.status(500).json({ estado: 'error', mensaje: 'Error del servidor' });
    }
});

router.post('/pre-registro', soloRoles('director'), async (req, res) => {
    const { rol } = req.body;
    const cedula = normalizarCedula(req.body.cedula);
    if (rol === 'director') return res.status(400).json({ estado: 'error', mensaje: MSG_DIRECTOR_UNICO });
    const rolesPermitidos = ['estudiante', 'profesor'];
    if (!rolesPermitidos.includes(rol)) return res.status(400).json({ estado: 'error', mensaje: 'Rol no válido.' });
    if (!cedula) return res.status(400).json({ estado: 'error', mensaje: 'La cédula debe tener solo números (5 a 10 dígitos).' });

    try {
        const [existe] = await db.query('SELECT id, rol, nombre, apellido FROM usuarios WHERE cedula = ?', [cedula]);
        if (existe.length > 0) {
            return res.status(400).json({ estado: 'duplicado', mensaje: `La cédula ya está registrada con el rol de ${existe[0].rol}.`, usuarioExistente: existe[0] });
        }
        await db.query("INSERT INTO usuarios (cedula, nombre, apellido, rol, password, verificado) VALUES (?, '', '', ?, NULL, 0)", [cedula, rol]);
        res.json({ estado: 'exitoso', mensaje: 'Cédula pre-registrada correctamente.' });
    } catch (err) {
        res.status(500).json({ estado: 'error', mensaje: 'Error al registrar.' });
    }
});

router.put('/actualizar-rol/:id', soloRoles('director'), async (req, res) => {
    const { nuevoRol } = req.body;
    if (nuevoRol === 'director') return res.status(400).json({ estado: 'error', mensaje: MSG_DIRECTOR_UNICO });
    const rolesPermitidos = ['estudiante', 'profesor'];
    if (!rolesPermitidos.includes(nuevoRol)) return res.status(400).json({ estado: 'error', mensaje: 'Rol no válido.' });

    try {
        const [[u]] = await db.query('SELECT rol FROM usuarios WHERE id = ?', [req.params.id]);
        if (!u) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado.' });
        if (u.rol === 'director') return res.status(400).json({ estado: 'error', mensaje: 'El director (super administrador) no puede cambiar de rol.' });
        await db.query('UPDATE usuarios SET rol = ? WHERE id = ?', [nuevoRol, req.params.id]);
        res.json({ estado: 'exitoso', mensaje: 'Rol actualizado correctamente.' });
    } catch (err) {
        res.status(500).json({ estado: 'error', mensaje: 'Error al actualizar el rol.' });
    }
});

module.exports = router;
