const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { crearToken, soloRoles, soloPropio } = require('../lib/auth');
const { normalizarCedula, esEmailValido } = require('../lib/util');

function crearTransporter(puertoAlternativo = null) {
    const host = (process.env.EMAIL_HOST || 'smtp-relay.brevo.com').trim();
    const port = Number(puertoAlternativo || (process.env.EMAIL_PORT || '587').toString().trim()) || 587;
    const user = (process.env.EMAIL_USER || '').trim();
    const pass = (process.env.EMAIL_PASS || '').trim();

    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        requireTLS: port === 587 || port === 2525,
        auth: { user, pass },
        connectionTimeout: 12000,
        greetingTimeout: 12000,
        socketTimeout: 15000,
        tls: {
            rejectUnauthorized: false
        }
    });
}

function escaparHtml(str) {
    return String(str || '').replace(/[&<>'"]/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[c]));
}

async function enviarCodigoVerificacion(destinatario, nombre, codigo, motivo = 'registro') {
    const esCambio = motivo === 'cambio_correo';
    const titulo = esCambio ? 'Confirmación de cambio de correo' : 'Verificación de cuenta institucional';
    const descripcion = esCambio
        ? 'Has solicitado actualizar tu dirección de correo electrónico. Ingresa el siguiente código de 6 dígitos para confirmar el cambio:'
        : 'Para completar tu registro en el Sistema de Asistencia de la U.E.P. Instituto Elena de Bueno, ingresa el siguiente código de verificación de 6 dígitos:';

    const htmlBonito = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #1a202c; margin: 0;">U.E.P. Instituto Elena de Bueno</h2>
                <p style="color: #718096; font-size: 14px; margin: 5px 0;">${titulo}</p>
            </div>
            <p style="color: #4a5568; font-size: 15px;">Hola <strong>${escaparHtml(nombre)}</strong>,</p>
            <p style="color: #4a5568; font-size: 15px; line-height: 1.5;">${descripcion}</p>
            <div style="background: white; border: 2px dashed #3182ce; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <h1 style="color: #3182ce; letter-spacing: 8px; margin: 0; font-size: 36px; font-family: monospace;">${escaparHtml(codigo)}</h1>
            </div>
            <p style="color: #718096; font-size: 13px; margin-bottom: 6px;">Este código expira en <strong>15 minutos</strong>.</p>
            <p style="color: #a0aec0; font-size: 12px; margin: 0;">Si no solicitaste este código, puedes ignorar este mensaje; tu cuenta no sufrirá ningún cambio.</p>
        </div>
    `;

    const remitente = (process.env.EMAIL_FROM || 'no-reply@elenadebueno.online').trim();
    const opcionesCorreo = {
        from: `"U.E.P. Instituto Elena de Bueno" <${remitente}>`,
        to: destinatario.trim(),
        subject: `${codigo} es tu código de verificación - Sistema de Asistencia`,
        text: `Hola ${nombre}. Tu código de verificación para el Sistema de Asistencia de la U.E.P. Instituto Elena de Bueno es: ${codigo}. Expira en 15 minutos.`,
        html: htmlBonito
    };

    try {
        const transporter = crearTransporter();
        await transporter.sendMail(opcionesCorreo);
    } catch (primerError) {
        const host = (process.env.EMAIL_HOST || 'smtp-relay.brevo.com').trim();
        const portActual = Number((process.env.EMAIL_PORT || '587').toString().trim()) || 587;
        // Si el puerto 587 falla en la nube (ej. Clever Cloud), reintentar automáticamente por el puerto 2525 de Brevo
        if (host.includes('brevo.com') && portActual !== 2525) {
            console.warn('Reintentando envío SMTP por puerto alternativo 2525:', primerError.message);
            const transporterAlt = crearTransporter(2525);
            await transporterAlt.sendMail(opcionesCorreo);
        } else {
            throw primerError;
        }
    }
}

function generarCodigo() {
    return crypto.randomInt(100000, 1000000).toString();
}

function leerDatosPendientes(textoJson) {
    if (!textoJson) return null;
    try {
        return JSON.parse(textoJson);
    } catch {
        return null;
    }
}

// Busca un usuario en proceso de verificación por cédula, por email actual o por email dentro de datos_pendientes
async function buscarUsuarioParaVerificacion({ cedula, email }) {
    const cedulaLimpia = cedula ? normalizarCedula(cedula) : null;
    const emailLimpio = String(email || '').trim().toLowerCase();

    if (cedulaLimpia) {
        const [porCedula] = await db.query('SELECT * FROM usuarios WHERE cedula = ? LIMIT 1', [cedulaLimpia]);
        if (porCedula.length > 0) return porCedula[0];
    }

    if (emailLimpio) {
        const [porEmail] = await db.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?) LIMIT 1', [emailLimpio]);
        if (porEmail.length > 0) return porEmail[0];

        // Buscar entre los que tienen registro pendiente guardado en datos_pendientes
        const [pendientes] = await db.query('SELECT * FROM usuarios WHERE datos_pendientes IS NOT NULL');
        for (const u of pendientes) {
            const dp = leerDatosPendientes(u.datos_pendientes);
            if (dp && dp.email && String(dp.email).toLowerCase() === emailLimpio) {
                return u;
            }
        }
    }
    return null;
}

// ==========================================
// LOGIN
// ==========================================
router.post('/login', async (req, res) => {
    const { usuario, password, recordar } = req.body || {};
    const entrada = String(usuario || '').trim();
    if (!entrada || !password) {
        return res.status(400).json({ estado: 'error', mensaje: 'Ingrese su correo o cédula y su contraseña.' });
    }

    try {
        const cedulaLimpia = normalizarCedula(entrada);
        const [users] = await db.query(
            'SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?) OR cedula = ? OR (? IS NOT NULL AND cedula = ?) LIMIT 1',
            [entrada, entrada, cedulaLimpia, cedulaLimpia]
        );
        if (users.length === 0) {
            return res.status(404).json({
                estado: 'error',
                mensaje: 'No existe una cuenta con ese correo o cédula.',
                sin_cuenta: true
            });
        }

        const user = users[0];
        if (user.activo == 0) {
            return res.status(403).json({ estado: 'error', mensaje: 'Su cuenta está desactivada. Consulte con la dirección.' });
        }

        // Si el usuario aún no tiene contraseña o no ha completado la verificación por código
        if (!user.password || user.verificado == 0) {
            return res.status(403).json({
                estado: 'error',
                mensaje: 'Su cédula está registrada, pero aún no ha activado su cuenta con el código de verificación.',
                sin_cuenta: true,
                requiere_verificacion: true,
                email: user.email || ''
            });
        }

        const coincide = await bcrypt.compare(String(password), user.password);
        if (!coincide) {
            return res.status(401).json({ estado: 'error', mensaje: 'Contraseña incorrecta.' });
        }

        const duracionHoras = recordar ? (24 * 30) : 12;
        const token = crearToken({ id: user.id, rol: user.rol }, duracionHoras);

        res.json({
            estado: 'exitoso',
            token,
            usuario: {
                id: user.id,
                nombre: user.nombre,
                apellido: user.apellido,
                email: user.email,
                rol: user.rol
            }
        });
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error del servidor al iniciar sesión.' });
    }
});

// ==========================================
// REGISTRO (FASE 1: ENVÍA CÓDIGO Y GUARDA PENDIENTE SIN ACTIVAR CUENTA)
// ==========================================
router.post('/registro', async (req, res) => {
    const nombre = String((req.body && req.body.nombre) || '').trim();
    const apellido = String((req.body && req.body.apellido) || '').trim();
    const cedula = normalizarCedula(req.body && req.body.cedula);
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');

    if (!nombre || !apellido || !req.body?.cedula || !email || !password) {
        return res.status(400).json({ estado: 'error', mensaje: 'Todos los campos son obligatorios.' });
    }
    if (!cedula) {
        return res.status(400).json({ estado: 'error', mensaje: 'La cédula debe tener entre 5 y 10 dígitos numéricos.' });
    }
    if (!esEmailValido(email)) {
        return res.status(400).json({ estado: 'error', mensaje: 'Ingrese un correo electrónico válido.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ estado: 'error', mensaje: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    try {
        const [existeCedula] = await db.query('SELECT * FROM usuarios WHERE cedula = ? LIMIT 1', [cedula]);
        if (existeCedula.length === 0) {
            return res.status(404).json({
                estado: 'error',
                mensaje: 'Usted no está registrado en la institución. Comuníquese con Control de Estudios.'
            });
        }

        const user = existeCedula[0];
        if (user.activo == 0) {
            return res.status(403).json({
                estado: 'error',
                mensaje: 'Su registro institucional se encuentra desactivado. Consulte con la dirección.'
            });
        }
        if (user.verificado == 1 && user.password) {
            return res.status(400).json({
                estado: 'error',
                mensaje: 'Esta cédula ya tiene una cuenta verificada. Inicie sesión.'
            });
        }

        const [existeEmail] = await db.query(
            'SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1',
            [email, user.id]
        );
        if (existeEmail.length > 0) {
            return res.status(400).json({ estado: 'error', mensaje: 'Ese correo electrónico ya está en uso por otra cuenta.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const codigo = generarCodigo();
        const expiracion = new Date(Date.now() + 15 * 60 * 1000);
        const datosPendientes = JSON.stringify({
            tipo: 'registro',
            nombre,
            apellido,
            email,
            password: hashedPassword
        });

        // 1. Primero enviamos el correo de verificación. Si falla el envío SMTP, NO se modifica la base de datos.
        await enviarCodigoVerificacion(email, nombre, codigo, 'registro');

        // 2. Guardamos los datos únicamente como pendientes (password sigue en NULL y verificado en 0).
        //    El usuario NO queda registrado hasta que introduzca el código correcto en /api/auth/verificar.
        await db.query(
            `UPDATE usuarios
             SET password = NULL,
                 verificado = 0,
                 codigo_verificacion = ?,
                 codigo_expiracion = ?,
                 datos_pendientes = ?
             WHERE id = ?`,
            [codigo, expiracion, datosPendientes, user.id]
        );

        res.json({
            estado: 'exitoso',
            mensaje: 'Te enviamos un código de 6 dígitos a tu correo.',
            requiere_verificacion: true,
            email,
            cedula
        });
    } catch (err) {
        console.error('Error en registro:', err);
        res.status(500).json({
            estado: 'error',
            mensaje: 'No se pudo enviar el código de verificación al correo indicado. Verifique que el correo exista e intente de nuevo.'
        });
    }
});

// ==========================================
// VERIFICAR CÓDIGO (FASE 2: ACTIVA Y GUARDA EL REGISTRO)
// ==========================================
router.post('/verificar', async (req, res) => {
    const { email, cedula, codigo } = req.body || {};
    const codigoLimpio = String(codigo || '').replace(/[^0-9]/g, '');

    if (codigoLimpio.length !== 6) {
        return res.status(400).json({ estado: 'error', mensaje: 'Debe ingresar los 6 dígitos del código de verificación.' });
    }

    try {
        const user = await buscarUsuarioParaVerificacion({ cedula, email });
        if (!user) {
            return res.status(404).json({ estado: 'error', mensaje: 'No se encontró una solicitud de registro pendiente para este usuario.' });
        }

        if (user.verificado == 1 && user.password) {
            return res.json({ estado: 'exitoso', mensaje: 'Tu cuenta ya está verificada. Ya puedes iniciar sesión.' });
        }

        if (!user.codigo_verificacion || String(user.codigo_verificacion).trim() !== codigoLimpio) {
            return res.status(400).json({ estado: 'error', mensaje: 'Código incorrecto. Revisa tu correo e inténtalo nuevamente.' });
        }

        if (!user.codigo_expiracion || new Date(user.codigo_expiracion) < new Date()) {
            return res.status(400).json({ estado: 'error', mensaje: 'El código ha expirado. Presiona "Reenviar código" para obtener uno nuevo.' });
        }

        const pendiente = leerDatosPendientes(user.datos_pendientes);
        if (!pendiente || pendiente.tipo !== 'registro' || !pendiente.password || !pendiente.email) {
            return res.status(400).json({
                estado: 'error',
                mensaje: 'No hay datos de registro pendientes. Por favor, complete el formulario de registro nuevamente.'
            });
        }

        // Verificar que nadie más haya ocupado ese correo mientras tanto
        const [dupEmail] = await db.query(
            'SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1',
            [pendiente.email, user.id]
        );
        if (dupEmail.length > 0) {
            return res.status(400).json({ estado: 'error', mensaje: 'Ese correo electrónico ya fue registrado por otro usuario.' });
        }

        // Ahora SÍ se confirma el registro del estudiante/profesor en la base de datos
        await db.query(
            `UPDATE usuarios
             SET nombre = ?,
                 apellido = ?,
                 email = ?,
                 password = ?,
                 verificado = 1,
                 codigo_verificacion = NULL,
                 codigo_expiracion = NULL,
                 datos_pendientes = NULL
             WHERE id = ?`,
            [pendiente.nombre, pendiente.apellido, pendiente.email, pendiente.password, user.id]
        );

        res.json({ estado: 'exitoso', mensaje: '¡Correo verificado con éxito! Ya puedes iniciar sesión.' });
    } catch (err) {
        console.error('Error al verificar código:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error del servidor al verificar el código.' });
    }
});

// ==========================================
// REENVIAR CÓDIGO (REGISTRO)
// ==========================================
router.post('/reenviar', async (req, res) => {
    const { email, cedula } = req.body || {};
    try {
        const user = await buscarUsuarioParaVerificacion({ cedula, email });
        if (!user) {
            return res.status(404).json({ estado: 'error', mensaje: 'No hay ningún registro pendiente para ese correo o cédula.' });
        }
        if (user.verificado == 1 && user.password) {
            return res.status(400).json({ estado: 'error', mensaje: 'Esta cuenta ya está verificada.' });
        }

        const pendiente = leerDatosPendientes(user.datos_pendientes);
        const correoDestino = (pendiente && pendiente.email) || user.email || String(email || '').trim().toLowerCase();
        const nombreDestino = (pendiente && pendiente.nombre) || user.nombre || 'Usuario';

        if (!esEmailValido(correoDestino)) {
            return res.status(400).json({ estado: 'error', mensaje: 'No hay un correo válido para reenviar el código.' });
        }

        const nuevoCodigo = generarCodigo();
        const nuevaExpiracion = new Date(Date.now() + 15 * 60 * 1000);

        await enviarCodigoVerificacion(correoDestino, nombreDestino, nuevoCodigo, 'registro');
        await db.query(
            'UPDATE usuarios SET codigo_verificacion = ?, codigo_expiracion = ? WHERE id = ?',
            [nuevoCodigo, nuevaExpiracion, user.id]
        );

        res.json({ estado: 'exitoso', mensaje: 'Te enviamos un nuevo código de 6 dígitos a tu correo.' });
    } catch (err) {
        console.error('Error al reenviar código:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo reenviar el código. Intente de nuevo en unos segundos.' });
    }
});

// ==========================================
// CANCELAR REGISTRO PENDIENTE
// ==========================================
router.post('/cancelar-registro', async (req, res) => {
    const { email, cedula } = req.body || {};
    try {
        const user = await buscarUsuarioParaVerificacion({ cedula, email });
        if (user && (user.verificado == 0 || !user.password)) {
            await db.query(
                `UPDATE usuarios
                 SET password = NULL,
                     verificado = 0,
                     codigo_verificacion = NULL,
                     codigo_expiracion = NULL,
                     datos_pendientes = NULL
                 WHERE id = ?`,
                [user.id]
            );
        }
        res.json({ estado: 'exitoso', mensaje: 'Solicitud de registro cancelada.' });
    } catch (err) {
        console.error('Error al cancelar registro:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al cancelar la solicitud.' });
    }
});

// ==========================================
// PERFIL Y CONTRASEÑA (CON VALIDACIÓN DE CORREO)
// ==========================================

router.get('/perfil/:id', soloPropio('id'), async (req, res) => {
    try {
        const [user] = await db.query(`
            SELECT u.id, u.nombre, u.apellido, u.cedula, u.email, u.telefono, u.rol, u.fecha_registro,
                   c.nombre AS curso_nombre, c.seccion AS curso_seccion, c.nivel AS curso_nivel
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
    const nombre = String((req.body && req.body.nombre) || '').trim();
    const apellido = String((req.body && req.body.apellido) || '').trim();
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const telefono = String((req.body && req.body.telefono) || '').trim();

    if (!email || !esEmailValido(email)) {
        return res.status(400).json({ estado: 'error', mensaje: 'Ingrese un correo electrónico válido.' });
    }
    if (telefono && !/^[0-9+\-\s()]{7,15}$/.test(telefono)) {
        return res.status(400).json({ estado: 'error', mensaje: 'El teléfono no tiene un formato válido.' });
    }

    try {
        const [users] = await db.query('SELECT email, nombre, apellido FROM usuarios WHERE id = ? LIMIT 1', [id]);
        if (users.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });

        const nombreFinal = nombre || users[0].nombre;
        const apellidoFinal = apellido || users[0].apellido;
        const emailActual = String(users[0].email || '').trim().toLowerCase();

        // ¿El correo cambió?
        if (email !== emailActual) {
            const [existe] = await db.query('SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1', [email, id]);
            if (existe.length > 0) {
                return res.status(400).json({ estado: 'error', mensaje: 'El correo ya está en uso por otra persona.' });
            }

            const codigo = generarCodigo();
            const expiracion = new Date(Date.now() + 15 * 60 * 1000);
            const datosPendientes = JSON.stringify({
                tipo: 'cambio_correo',
                nombre: nombreFinal,
                apellido: apellidoFinal,
                email,
                telefono
            });

            // Primero enviamos el código al nuevo correo; si falla no alteramos nada
            await enviarCodigoVerificacion(email, nombreFinal, codigo, 'cambio_correo');

            await db.query(
                'UPDATE usuarios SET codigo_verificacion = ?, codigo_expiracion = ?, datos_pendientes = ? WHERE id = ?',
                [codigo, expiracion, datosPendientes, id]
            );

            return res.json({
                estado: 'exitoso',
                requiere_verificacion_cambio: true,
                mensaje: 'Te enviamos un código al nuevo correo para confirmar el cambio.'
            });
        }

        // Si NO cambió el correo, actualizamos todo normal
        await db.query(
            'UPDATE usuarios SET nombre = ?, apellido = ?, email = ?, telefono = ? WHERE id = ?',
            [nombreFinal, apellidoFinal, email, telefono, id]
        );
        res.json({ estado: 'exitoso', mensaje: 'Perfil actualizado correctamente' });
    } catch (err) {
        console.error('Error al actualizar perfil:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo enviar el código de verificación al nuevo correo.' });
    }
});

// Confirmar el cambio de correo con el código
router.post('/perfil/verificar-nuevo-correo', async (req, res) => {
    const { id, codigo, nombre, apellido, nuevo_email, telefono } = req.body || {};
    const codigoLimpio = String(codigo || '').replace(/[^0-9]/g, '');

    if (!req.usuario || (req.usuario.rol !== 'director' && String(req.usuario.id) !== String(id))) {
        return res.status(403).json({ estado: 'error', mensaje: 'Solo puede modificar su propio perfil.' });
    }
    if (codigoLimpio.length !== 6) {
        return res.status(400).json({ estado: 'error', mensaje: 'Ingrese los 6 dígitos del código.' });
    }

    try {
        const [users] = await db.query(
            'SELECT nombre, apellido, email, telefono, codigo_verificacion, codigo_expiracion, datos_pendientes FROM usuarios WHERE id = ? LIMIT 1',
            [id]
        );
        if (users.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });

        const user = users[0];
        if (!user.codigo_verificacion || String(user.codigo_verificacion).trim() !== codigoLimpio) {
            return res.status(400).json({ estado: 'error', mensaje: 'Código incorrecto.' });
        }
        if (!user.codigo_expiracion || new Date(user.codigo_expiracion) < new Date()) {
            return res.status(400).json({ estado: 'error', mensaje: 'El código ha expirado. Vuelva a guardar para recibir otro.' });
        }

        const pendiente = leerDatosPendientes(user.datos_pendientes) || {};
        const nombreFinal = String(nombre || pendiente.nombre || user.nombre || '').trim();
        const apellidoFinal = String(apellido || pendiente.apellido || user.apellido || '').trim();
        const emailFinal = String(nuevo_email || pendiente.email || '').trim().toLowerCase();
        const telefonoFinal = telefono !== undefined ? String(telefono).trim() : (pendiente.telefono ?? user.telefono ?? '');

        if (!esEmailValido(emailFinal)) {
            return res.status(400).json({ estado: 'error', mensaje: 'El nuevo correo no es válido.' });
        }

        const [dup] = await db.query('SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1', [emailFinal, id]);
        if (dup.length > 0) {
            return res.status(400).json({ estado: 'error', mensaje: 'Ese correo ya está en uso por otra cuenta.' });
        }

        await db.query(
            `UPDATE usuarios
             SET nombre = ?, apellido = ?, email = ?, telefono = ?,
                 codigo_verificacion = NULL, codigo_expiracion = NULL, datos_pendientes = NULL
             WHERE id = ?`,
            [nombreFinal, apellidoFinal, emailFinal, telefonoFinal, id]
        );

        res.json({
            estado: 'exitoso',
            mensaje: 'Correo actualizado y verificado correctamente.',
            datos: { nombre: nombreFinal, apellido: apellidoFinal, email: emailFinal, telefono: telefonoFinal }
        });
    } catch (err) {
        console.error('Error al verificar nuevo correo:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al verificar el nuevo correo.' });
    }
});

// Cancelar el cambio de correo pendiente
router.post('/perfil/cancelar-cambio-correo', async (req, res) => {
    const { id } = req.body || {};
    if (!req.usuario || (req.usuario.rol !== 'director' && String(req.usuario.id) !== String(id))) {
        return res.status(403).json({ estado: 'error', mensaje: 'No autorizado.' });
    }
    try {
        await db.query(
            'UPDATE usuarios SET codigo_verificacion = NULL, codigo_expiracion = NULL, datos_pendientes = NULL WHERE id = ?',
            [id]
        );
        res.json({ estado: 'exitoso' });
    } catch (err) {
        res.status(500).json({ estado: 'error', mensaje: 'Error al cancelar cambio de correo.' });
    }
});

router.put('/cambiar-password/:id', soloPropio('id'), async (req, res) => {
    const { actual, nueva } = req.body || {};
    if (!actual || !nueva || String(nueva).length < 6) {
        return res.status(400).json({ estado: 'error', mensaje: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }
    try {
        const [users] = await db.query('SELECT password FROM usuarios WHERE id = ? LIMIT 1', [req.params.id]);
        if (users.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });

        const passwordValida = users[0].password ? await bcrypt.compare(String(actual), users[0].password) : false;
        if (!passwordValida) return res.status(401).json({ estado: 'error', mensaje: 'La contraseña actual es incorrecta' });

        const nuevaEncriptada = await bcrypt.hash(String(nueva), 10);
        await db.query('UPDATE usuarios SET password = ?, verificado = 1 WHERE id = ?', [nuevaEncriptada, req.params.id]);
        res.json({ estado: 'exitoso', mensaje: 'Contraseña actualizada correctamente' });
    } catch (err) {
        res.status(500).json({ estado: 'error', mensaje: 'Error del servidor' });
    }
});

router.post('/pre-registro', soloRoles('director'), async (req, res) => {
    const cedula = normalizarCedula(req.body && req.body.cedula);
    const rol = req.body && req.body.rol;
    const rolesPermitidos = ['estudiante', 'profesor'];

    if (!cedula) {
        return res.status(400).json({ estado: 'error', mensaje: 'La cédula debe tener entre 5 y 10 dígitos numéricos.' });
    }
    if (!rolesPermitidos.includes(rol)) {
        return res.status(400).json({ estado: 'error', mensaje: 'Rol no válido. Solo se puede pre-registrar estudiantes o profesores.' });
    }

    try {
        const [existe] = await db.query('SELECT id, rol, nombre, apellido FROM usuarios WHERE cedula = ? LIMIT 1', [cedula]);
        if (existe.length > 0) {
            return res.status(400).json({
                estado: 'duplicado',
                mensaje: `La cédula ${cedula} ya está registrada con el rol de ${existe[0].rol}.`,
                usuarioExistente: existe[0]
            });
        }
        await db.query(
            "INSERT INTO usuarios (cedula, nombre, apellido, rol, password, activo, verificado) VALUES (?, '', '', ?, NULL, 1, 0)",
            [cedula, rol]
        );
        res.json({ estado: 'exitoso', mensaje: 'Cédula pre-registrada correctamente. El usuario ya puede activar su cuenta en "Regístrese aquí".' });
    } catch (err) {
        console.error('Error en pre-registro:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al pre-registrar la cédula.' });
    }
});

router.put('/actualizar-rol/:id', soloRoles('director'), async (req, res) => {
    const { nuevoRol } = req.body || {};
    const rolesPermitidos = ['estudiante', 'profesor'];
    if (!rolesPermitidos.includes(nuevoRol)) {
        return res.status(400).json({ estado: 'error', mensaje: 'Rol no válido.' });
    }

    try {
        const [actual] = await db.query('SELECT rol FROM usuarios WHERE id = ? LIMIT 1', [req.params.id]);
        if (actual.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado.' });
        if (actual[0].rol === 'director') {
            return res.status(400).json({ estado: 'error', mensaje: 'El director (super administrador) no puede cambiar de rol.' });
        }

        await db.query('UPDATE usuarios SET rol = ? WHERE id = ?', [nuevoRol, req.params.id]);
        res.json({ estado: 'exitoso', mensaje: 'Rol actualizado correctamente.' });
    } catch (err) {
        res.status(500).json({ estado: 'error', mensaje: 'Error al actualizar el rol.' });
    }
});

module.exports = router;
