const express = require('express');
const router = express.Router();
const db = require('../db');
const { anioEscolarActual } = require('../lib/periodo');
const bcrypt = require('bcryptjs');
const { ROLES, normalizarCedula, esEmailValido, buscarGroserias, errorDuplicado } = require('../lib/util');
const { notificar } = require('../lib/notificar');

// Faltas del periodo escolar actual (no se suman las de años anteriores)
const inicioPeriodo = async () => `${await anioEscolarActual(db)}-09-01`;
const SELECT_USUARIOS = `
    SELECT
        u.id, u.cedula, u.nombre, u.apellido, u.email, u.telefono, u.rol, u.activo,
        (u.password IS NOT NULL) AS tiene_cuenta,
        (SELECT COUNT(*) FROM asistencia a WHERE a.usuario_id = u.id AND a.estado = 'ausente' AND a.fecha >= ?) AS faltas,
        c.id AS curso_id, c.nombre AS curso_nombre, c.seccion, c.turno, c.nivel, ec.anio_academico
    FROM usuarios u
    LEFT JOIN estudiante_curso ec ON ec.id = (
        SELECT MAX(ec2.id) FROM estudiante_curso ec2 WHERE ec2.estudiante_id = u.id AND ec2.activo = 1
    )
    LEFT JOIN cursos c ON ec.curso_id = c.id
`;

router.get('/', async (req, res) => {
    try {
        const [results] = await db.query(`${SELECT_USUARIOS} ORDER BY u.rol ASC, u.apellido ASC, u.nombre ASC`, [await inicioPeriodo()]);
        res.json({ estado: 'exitoso', datos: results });
    } catch (err) {
        console.error('Error al consultar usuarios:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener la lista de usuarios' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const [results] = await db.query(`${SELECT_USUARIOS} WHERE u.id = ?`, [await inicioPeriodo(), req.params.id]);
        if (results.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });
        res.json({ estado: 'exitoso', datos: results[0] });
    } catch (err) {
        console.error('Error al consultar usuario:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener el usuario' });
    }
});

async function validarUsuario(body, idActual = 0) {
    const b = body || {};
    const cedula = normalizarCedula(b.cedula);
    const nombre = String(b.nombre || '').trim();
    const apellido = String(b.apellido || '').trim();
    const email = String(b.email || '').trim();
    const telefono = String(b.telefono || '').trim();
    const rol = b.rol;

    if (!b.cedula || !nombre || !apellido || !rol) return { error: 'Faltan campos obligatorios (cédula, nombre, apellido y rol).' };
    if (!cedula) return { error: 'La cédula debe tener solo números (entre 5 y 10 dígitos). Ej: 30123456' };
    if (!ROLES.includes(rol)) return { error: 'El rol no es válido. Use estudiante, profesor o director.' };
    if (email && !esEmailValido(email)) return { error: 'El correo no es válido.' };
    if (telefono && !/^[0-9+\-\s()]{7,15}$/.test(telefono)) return { error: 'El teléfono no es válido.' };

    const malas = await buscarGroserias(db, nombre, apellido);
    if (malas.length > 0) return { error: `El nombre o apellido contiene palabras no permitidas: ${malas.join(', ')}.`, groserias: malas };

    const [dupCedula] = await db.query('SELECT id FROM usuarios WHERE cedula = ? AND id <> ?', [cedula, idActual]);
    if (dupCedula.length > 0) return { error: `La cédula ${cedula} ya está registrada.` };
    if (email) {
        const [dupEmail] = await db.query('SELECT id FROM usuarios WHERE email = ? AND id <> ?', [email, idActual]);
        if (dupEmail.length > 0) return { error: 'Ese correo ya lo usa otra persona.' };
    }
    return { datos: { cedula, nombre, apellido, email: email || null, telefono, rol } };
}

async function asignarSeccion(usuarioId, rol, cursoId, anio) {
    if (rol !== 'estudiante') {
        await db.query('UPDATE estudiante_curso SET activo = 0 WHERE estudiante_id = ? AND activo = 1', [usuarioId]);
        return;
    }
    if (cursoId === undefined) return;
    if (!cursoId) {
        await db.query('UPDATE estudiante_curso SET activo = 0 WHERE estudiante_id = ? AND activo = 1', [usuarioId]);
        return;
    }
    const [actual] = await db.query('SELECT curso_id FROM estudiante_curso WHERE estudiante_id = ? AND activo = 1 ORDER BY id DESC LIMIT 1', [usuarioId]);
    if (actual[0] && String(actual[0].curso_id) === String(cursoId)) return;
    await db.query('UPDATE estudiante_curso SET activo = 0 WHERE estudiante_id = ? AND activo = 1', [usuarioId]);
    await db.query('INSERT INTO estudiante_curso (estudiante_id, curso_id, anio_academico, activo) VALUES (?, ?, ?, 1)',
        [usuarioId, cursoId, anio || await anioEscolarActual(db)]);
}

const MSG_DIRECTOR_UNICO = 'Solo existe un director (super administrador) y ya está creado. Asigne otro rol.';

router.post('/', async (req, res) => {
    try {
        if (req.body && req.body.rol === 'director') {
            return res.status(400).json({ estado: 'error', mensaje: MSG_DIRECTOR_UNICO });
        }
        const v = await validarUsuario(req.body);
        if (v.error) return res.status(400).json({ estado: 'error', mensaje: v.error, groserias: v.groserias });
        const d = v.datos;
        const { activo, curso_id, anio_academico } = req.body;
        const activoVal = (activo === undefined || activo === true || activo == 1) ? 1 : 0;

        const [result] = await db.query(
            'INSERT INTO usuarios (cedula, nombre, apellido, email, telefono, rol, activo, password) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
            [d.cedula, d.nombre, d.apellido, d.email, d.telefono, d.rol, activoVal]
        );
        await asignarSeccion(result.insertId, d.rol, curso_id || null, anio_academico);

        res.json({ estado: 'exitoso', mensaje: 'Usuario registrado. Ya puede crear su cuenta con su cédula en "Regístrese aquí".', id: result.insertId });
    } catch (err) {
        if (errorDuplicado(err)) return res.status(400).json({ estado: 'error', mensaje: 'La cédula o el correo ya existen.' });
        console.error('Error al registrar usuario:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al registrar el usuario en la base de datos' });
    }
});


router.put('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [existe] = await db.query('SELECT id, rol FROM usuarios WHERE id = ?', [id]);
        if (existe.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });

        if (req.body && req.body.rol === 'director' && existe[0].rol !== 'director') {
            return res.status(400).json({ estado: 'error', mensaje: MSG_DIRECTOR_UNICO });
        }
        if (existe[0].rol === 'director' && req.body && req.body.rol && req.body.rol !== 'director') {
            return res.status(400).json({ estado: 'error', mensaje: 'El director (super administrador) no puede cambiar de rol.' });
        }
        const v = await validarUsuario(req.body, Number(id));
        if (v.error) return res.status(400).json({ estado: 'error', mensaje: v.error, groserias: v.groserias });
        const d = v.datos;
        const { activo, curso_id, anio_academico } = req.body;
        const activoVal = (activo === true || activo == 1) ? 1 : 0;

        if (String(id) === String(req.usuario.id) && (d.rol !== 'director' || activoVal === 0)) {
            return res.status(400).json({ estado: 'error', mensaje: 'No puede quitarse el rol de director ni desactivarse a sí mismo.' });
        }

        await db.query(
            'UPDATE usuarios SET cedula = ?, nombre = ?, apellido = ?, email = ?, telefono = ?, rol = ?, activo = ? WHERE id = ?',
            [d.cedula, d.nombre, d.apellido, d.email, d.telefono, d.rol, activoVal, id]
        );
        await asignarSeccion(id, d.rol, curso_id, anio_academico);

        res.json({ estado: 'exitoso', mensaje: 'Usuario actualizado correctamente' });
    } catch (err) {
        if (errorDuplicado(err)) return res.status(400).json({ estado: 'error', mensaje: 'La cédula o el correo ya existen.' });
        console.error('Error al actualizar usuario:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al actualizar el usuario' });
    }
});


router.put('/:id/clave', async (req, res) => {
    const nueva = String((req.body && req.body.nueva) || '');
    if (nueva.length < 6) {
        return res.status(400).json({ estado: 'error', mensaje: 'La clave temporal debe tener al menos 6 caracteres.' });
    }
    try {
        // Clave puesta por el director: la cuenta queda verificada para poder entrar
        const [r] = await db.query('UPDATE usuarios SET password = ?, verificado = 1, codigo_verificacion = NULL WHERE id = ?', [await bcrypt.hash(nueva, 10), req.params.id]);
        if (r.affectedRows === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });
        await notificar(db, req.params.id, 'Su contraseña fue restablecida',
            'El director le asignó una clave temporal. Cámbiela en "Mi Perfil".', null);
        res.json({ estado: 'exitoso', mensaje: 'Clave temporal guardada. Entréguesela a la persona y pídale que la cambie en "Mi Perfil".' });
    } catch (err) {
        console.error('Error al restablecer clave:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al guardar la clave' });
    }
});


// TRANSACCIÓN SEGURA: Evita errores de llaves foráneas al eliminar
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    if (String(id) === String(req.usuario.id)) {
        return res.status(400).json({ estado: 'error', mensaje: 'No puede eliminar su propia cuenta.' });
    }
    
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [[h]] = await conn.query(`
            SELECT (SELECT COUNT(*) FROM asistencia WHERE usuario_id = ?) +
                   (SELECT COUNT(*) FROM justificaciones WHERE usuario_id = ?) +
                   (SELECT COUNT(*) FROM horarios_clase WHERE profesor_id = ?) +
                   (SELECT COUNT(*) FROM profesor_curso WHERE profesor_id = ?) AS total
        `, [id, id, id, id]);

        if (h.total > 0) {
            const [r] = await conn.query('UPDATE usuarios SET activo = 0 WHERE id = ?', [id]);
            await conn.commit();
            if (r.affectedRows === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });
            return res.json({ estado: 'exitoso', desactivado: true, mensaje: 'El usuario tiene historial, así que se desactivó (no se borró) para no perder sus registros.' });
        }

        // Limpieza manual de tablas relacionadas antes de borrar (por seguridad)
        await conn.query('DELETE FROM estudiante_curso WHERE estudiante_id = ?', [id]);
        await conn.query('DELETE FROM notificaciones WHERE usuario_id = ?', [id]);

        const [r] = await conn.query('DELETE FROM usuarios WHERE id = ?', [id]);
        await conn.commit();

        if (r.affectedRows === 0) return res.status(404).json({ estado: 'error', mensaje: 'Usuario no encontrado' });
        res.json({ estado: 'exitoso', mensaje: 'Usuario eliminado correctamente' });
    } catch (err) {
        await conn.rollback();
        console.error('Error al eliminar usuario:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo eliminar el usuario: ' + err.message });
    } finally {
        conn.release();
    }
});

module.exports = router;
