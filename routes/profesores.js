const express = require('express');
const router = express.Router();
const db = require('../db');
const { soloRoles, soloPropio } = require('../lib/auth');
const {
    hoyLocal, horaLocal, esFechaValida, normalizarEstado, nombreDia, leerConfig,
    eventoQueSuspende, sinAcentos, TIPOS_JUSTIFICACION, sumarDias
} = require('../lib/util');

const { notificar, idsDirectores, fechaBonita } = require('../lib/notificar');

const mismaMateria = (a, b) => sinAcentos(a).trim() === sinAcentos(b).trim();

async function asignacionesDe(profesorId) {
    const [rows] = await db.query(`
        SELECT c.id AS curso_id, c.nombre AS curso_nombre, c.seccion, c.nivel, pc.materia
        FROM profesor_curso pc
        JOIN cursos c ON pc.curso_id = c.id
        WHERE pc.profesor_id = ? AND pc.activo = 1
        ORDER BY c.nombre, c.seccion, pc.materia
    `, [profesorId]);
    return rows.map(r => ({ ...r, materia: (r.materia || '').trim() }));
}

async function materiaAsignada(profesorId, cursoId, materia) {
    const lista = (await asignacionesDe(profesorId)).filter(a => String(a.curso_id) === String(cursoId));
    if (lista.length === 0) return { error: 'Usted no tiene asignada esta sección.' };
    if (!materia) {
        if (lista.length === 1) return { materia: lista[0].materia };
        return { error: 'Usted da varias materias en esta sección. Elija la materia.' };
    }
    const m = lista.find(a => mismaMateria(a.materia, materia));
    return m ? { materia: m.materia } : { error: 'Usted no da esa materia en esta sección.' };
}

async function estudiantesDeCurso(cursoId) {
    const [rows] = await db.query(`
        SELECT DISTINCT u.id, u.nombre, u.apellido, u.cedula
        FROM estudiante_curso ec
        JOIN usuarios u ON ec.estudiante_id = u.id
        WHERE ec.curso_id = ? AND ec.activo = 1 AND u.activo = 1 AND u.rol = 'estudiante'
        ORDER BY u.apellido ASC, u.nombre ASC
    `, [cursoId]);
    return rows;
}

async function horariosDe(profesorId, cursoId, materia) {
    const [rows] = await db.query(`
        SELECT dia_semana, materia, DATE_FORMAT(hora_inicio, '%H:%i') AS inicio, DATE_FORMAT(hora_fin, '%H:%i') AS fin
        FROM horarios_clase WHERE profesor_id = ? AND curso_id = ? AND activo = 1
        ORDER BY FIELD(dia_semana, 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'), hora_inicio
    `, [profesorId, cursoId]);
    return rows.filter(h => !h.materia || mismaMateria(h.materia, materia));
}

function estaEnHorario(horarios) {
    const ahora = new Date();
    const dia = nombreDia(hoyLocal());
    const hora = horaLocal(ahora).substring(0, 5);
    return horarios.some(h => h.dia_semana === dia && h.inicio <= hora && h.fin >= hora);
}

async function pendientesDeCurso(cursoId) {
    const [rows] = await db.query(`
        SELECT COUNT(DISTINCT j.id) AS total
        FROM justificaciones j
        JOIN estudiante_curso ec ON ec.estudiante_id = j.usuario_id AND ec.activo = 1
        WHERE ec.curso_id = ? AND j.estado IN ('pendiente', 'revision')
    `, [cursoId]);
    return Number(rows[0].total || 0);
}

async function detalleClase(profesorId, a, hoy, feriado) {
    const horarios = await horariosDe(profesorId, a.curso_id, a.materia);
    const estudiantes = await estudiantesDeCurso(a.curso_id);
    const detalle = [];
    let asistidos = 0, marcados = 0;

    for (const est of estudiantes) {
        const [hoyRows] = await db.query(
            'SELECT estado FROM asistencia WHERE usuario_id = ? AND fecha = ? AND curso_id = ? AND materia = ? LIMIT 1',
            [est.id, hoy, a.curso_id, a.materia]
        );
        const estadoHoy = hoyRows.length > 0 ? normalizarEstado(hoyRows[0].estado) : 'sin-marcar';
        if (hoyRows.length > 0) {
            marcados++;
            if (['presente', 'tarde', 'justificada'].includes(estadoHoy)) asistidos++;
        }
        const [ultimas] = await db.query(
            'SELECT estado FROM asistencia WHERE usuario_id = ? AND curso_id = ? AND materia = ? ORDER BY fecha DESC LIMIT 3',
            [est.id, a.curso_id, a.materia]
        );
        detalle.push({
            id: est.id,
            nombre: `${est.nombre} ${est.apellido}`,
            cedula: est.cedula,
            estado_hoy: estadoHoy,
            ultimas: ultimas.map(u => normalizarEstado(u.estado))
        });
    }

    return {
        curso_id: a.curso_id,
        curso_nombre: a.curso_nombre,
        seccion: a.seccion,
        materia: a.materia || 'Materia General',
        horarios,
        horarios_text: horarios.length > 0 ? horarios.map(h => `${h.dia_semana} ${h.inicio} - ${h.fin}`) : ['Sin horario asignado'],
        en_horario: !feriado && estaEnHorario(horarios),
        es_feriado: !!feriado,
        total_estudiantes: estudiantes.length,
        marcados_hoy: marcados,
        lista_guardada_hoy: estudiantes.length > 0 && marcados === estudiantes.length,
        presentes_hoy: asistidos,
        porcentaje_asistencia: marcados > 0 ? Number(((asistidos / marcados) * 100).toFixed(1)) : 0,
        justificaciones_pendientes: await pendientesDeCurso(a.curso_id),
        estudiantes: detalle
    };
}

async function justificacionAprobadaQueCubre(usuarioId, fecha, materia) {
    const [rows] = await db.query(
        "SELECT id FROM justificaciones WHERE usuario_id = ? AND estado = 'aprobada' AND ? BETWEEN fecha_inicio AND fecha_fin AND (materia IS NULL OR materia = '' OR materia = ?) LIMIT 1",
        [usuarioId, fecha, materia]
    );
    return rows[0] ? rows[0].id : null;
}

router.get('/', soloRoles('director'), async (req, res) => {
    try {
        const [results] = await db.query(`
            SELECT id, cedula, nombre, apellido, email
            FROM usuarios
            WHERE rol = 'profesor' AND activo = 1
            ORDER BY nombre ASC, apellido ASC
        `);
        res.json({ estado: 'exitoso', datos: results });
    } catch (err) {
        console.error('Error al consultar profesores:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener la lista de profesores' });
    }
});

async function cargarProfesor(req, res) {
    const [profesor] = await db.query("SELECT id, nombre, apellido FROM usuarios WHERE id = ? AND rol = 'profesor'", [req.params.id]);
    if (profesor.length === 0) {
        res.status(404).json({ estado: 'error', mensaje: 'Profesor no encontrado' });
        return null;
    }
    return profesor[0];
}

router.get('/dashboard/:id', soloPropio('id'), async (req, res) => {
    try {
        const profesor = await cargarProfesor(req, res);
        if (!profesor) return;
        const hoy = hoyLocal();
        const feriado = await eventoQueSuspende(db, hoy);

        const asignaciones = await asignacionesDe(profesor.id);
        const secciones = [];
        for (const a of asignaciones) {
            const d = await detalleClase(profesor.id, a, hoy, feriado);
            delete d.estudiantes;
            d.justificaciones_count = d.justificaciones_pendientes;
            secciones.push(d);
        }

        const [justPendientes] = await db.query(`
            SELECT COUNT(DISTINCT j.id) AS total
            FROM justificaciones j
            JOIN estudiante_curso ec ON ec.estudiante_id = j.usuario_id AND ec.activo = 1
            JOIN profesor_curso pc ON pc.curso_id = ec.curso_id AND pc.activo = 1
            WHERE pc.profesor_id = ? AND j.estado IN ('pendiente', 'revision')
        `, [profesor.id]);
        const [eventos] = await db.query(`
            SELECT titulo, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin,
                   tipo_evento AS tipo, color_evento AS color
            FROM calendario_academico WHERE fecha_fin >= ? ORDER BY fecha_inicio ASC LIMIT 3
        `, [hoy]);

        res.json({
            profesor,
            secciones,
            justificacionesPendientesCount: Number(justPendientes[0].total || 0),
            eventosProximos: eventos,
            esFeriado: !!feriado,
            feriado: feriado ? feriado.titulo : null
        });
    } catch (err) {
        console.error('Error en dashboard profesor:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al cargar el panel del profesor' });
    }
});

router.get('/mis-secciones/:id', soloPropio('id'), async (req, res) => {
    try {
        const profesor = await cargarProfesor(req, res);
        if (!profesor) return;
        const hoy = hoyLocal();
        const feriado = await eventoQueSuspende(db, hoy);

        const asignaciones = await asignacionesDe(profesor.id);
        const datos = [];
        for (const a of asignaciones) {
            const d = await detalleClase(profesor.id, a, hoy, feriado);
            datos.push({
                ...d,
                horario_texto: d.horarios_text.join(', '),
                estudiantes_count: d.total_estudiantes
            });
        }
        res.json({ estado: 'exitoso', datos, esFeriado: !!feriado, feriado: feriado ? feriado.titulo : null });
    } catch (err) {
        console.error('Error en mis-secciones:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al cargar las secciones' });
    }
});

router.get('/pasar-lista/:cursoId', soloRoles('profesor', 'director'), async (req, res) => {
    const { cursoId } = req.params;
    const hoy = hoyLocal();
    const fecha = esFechaValida(req.query.fecha) ? req.query.fecha : hoy;

    try {
        const config = await leerConfig(db);
        let materia = req.query.materia || '';
        if (req.usuario.rol === 'profesor') {
            const asig = await materiaAsignada(req.usuario.id, cursoId, materia);
            if (asig.error) return res.status(403).json({ estado: 'error', mensaje: asig.error });
            materia = asig.materia;
        }

        const [curso] = await db.query('SELECT nombre, seccion FROM cursos WHERE id = ?', [cursoId]);
        if (curso.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Sección no encontrada' });

        const estudiantes = await estudiantesDeCurso(cursoId);
        const lista = [];
        for (const est of estudiantes) {
            const [asist] = await db.query(
                'SELECT estado, observaciones FROM asistencia WHERE usuario_id = ? AND fecha = ? AND curso_id = ? AND materia = ? LIMIT 1',
                [est.id, fecha, cursoId, materia]
            );
            lista.push({
                ...est,
                estado: asist[0] ? normalizarEstado(asist[0].estado) : '',
                observaciones: asist[0] ? (asist[0].observaciones || '') : ''
            });
        }

        const feriado = await eventoQueSuspende(db, fecha);
        res.json({
            estado: 'exitoso',
            curso: `${curso[0].nombre} - ${curso[0].seccion}`,
            materia,
            fecha,
            hoy,
            puede_editar_pasadas: config.permitir_edicion_asistencia,
            hora_limite: config.hora_entrada,
            feriado: feriado ? feriado.titulo : null,
            estudiantes: lista
        });
    } catch (err) {
        console.error('Error al cargar lista:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al cargar la lista' });
    }
});

router.post('/guardar-asistencia', soloRoles('profesor', 'director'), async (req, res) => {
    const { curso_id, asistencia } = req.body || {};
    const hoy = hoyLocal();
    const fecha = req.body && req.body.fecha ? req.body.fecha : hoy;

    if (!curso_id || !Array.isArray(asistencia) || asistencia.length === 0) {
        return res.status(400).json({ estado: 'error', mensaje: 'No hay datos de asistencia para guardar.' });
    }
    if (!esFechaValida(fecha)) {
        return res.status(400).json({ estado: 'error', mensaje: 'La fecha no es válida.' });
    }
    if (fecha > hoy) {
        return res.status(400).json({ estado: 'error', mensaje: 'No se puede pasar lista de un día que aún no llega.' });
    }

    try {
        const config = await leerConfig(db);
        if (fecha < hoy && req.usuario.rol === 'profesor' && !config.permitir_edicion_asistencia) {
            return res.status(403).json({ estado: 'error', mensaje: 'El director no permite editar asistencias de días pasados.' });
        }

        let materia = req.body.materia || '';
        if (req.usuario.rol === 'profesor') {
            const asig = await materiaAsignada(req.usuario.id, curso_id, materia);
            if (asig.error) return res.status(403).json({ estado: 'error', mensaje: asig.error });
            materia = asig.materia;
        }

        const feriado = await eventoQueSuspende(db, fecha);
        if (feriado) {
            return res.status(400).json({ estado: 'error', mensaje: `No hay clases ese día (${feriado.titulo}). No se pasa lista.` });
        }

        const permitidos = new Set((await estudiantesDeCurso(curso_id)).map(e => String(e.id)));
        const ajenos = asistencia.filter(i => !permitidos.has(String(i.usuario_id)));
        if (ajenos.length > 0) {
            return res.status(400).json({ estado: 'error', mensaje: 'La lista tiene estudiantes que no son de esta sección.' });
        }
        const invalidos = asistencia.filter(i => !normalizarEstado(i.estado));
        if (invalidos.length > 0) {
            return res.status(400).json({ estado: 'error', mensaje: `Faltan ${invalidos.length} estudiante(s) por marcar.` });
        }

        const hora = horaLocal();
        const [[cursoInfo]] = await db.query('SELECT nombre, seccion FROM cursos WHERE id = ?', [curso_id]);
        const nombreClase = `${materia}${cursoInfo ? ` (${cursoInfo.nombre} ${cursoInfo.seccion})` : ''}`;
        for (const item of asistencia) {
            const [previo] = await db.query(
                'SELECT estado FROM asistencia WHERE usuario_id = ? AND fecha = ? AND curso_id = ? AND materia = ?',
                [item.usuario_id, fecha, curso_id, materia]
            );
            const estadoAntes = previo[0] ? normalizarEstado(previo[0].estado) : null;
            let estado = normalizarEstado(item.estado);
            let justificacionId = null;
            let estadoPrevio = null;
            
            if (estado === 'ausente') {
                justificacionId = await justificacionAprobadaQueCubre(item.usuario_id, fecha, materia);
                if (justificacionId) { estado = 'justificada'; estadoPrevio = 'ausente'; }
            }
            await db.query(`
                INSERT INTO asistencia (usuario_id, curso_id, materia, profesor_id, fecha, hora_entrada, estado, observaciones, justificacion_id, estado_previo)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE estado = VALUES(estado), observaciones = VALUES(observaciones),
                    profesor_id = VALUES(profesor_id), justificacion_id = VALUES(justificacion_id), estado_previo = VALUES(estado_previo)
            `, [item.usuario_id, curso_id, materia, req.usuario.id, fecha, hora, estado, (item.observaciones || '').toString().slice(0, 500), justificacionId, estadoPrevio]);

            if ((estado === 'ausente' || estado === 'tarde') && estado !== estadoAntes) {
                await notificar(db, item.usuario_id,
                    estado === 'ausente' ? 'Inasistencia registrada' : 'Llegada tarde registrada',
                    `${estado === 'ausente' ? 'Ausente' : 'Tarde'} en ${nombreClase} el ${fechaBonita(fecha)}. Si tiene un motivo, puede solicitar una justificación.`,
                    '/interfaces/estudiante/justificaciones.html');
            }
        }
        res.json({ estado: 'exitoso', mensaje: 'Lista de asistencia guardada correctamente.' });
    } catch (err) {
        console.error('Error al guardar asistencia:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al guardar la asistencia' });
    }
});

router.get('/justificaciones/:id', soloPropio('id'), async (req, res) => {
    try {
        const profesor = await cargarProfesor(req, res);
        if (!profesor) return;

        const [results] = await db.query(`
            SELECT j.id, DATE_FORMAT(j.fecha_inicio, '%d/%m/%Y') AS fecha_inicio, DATE_FORMAT(j.fecha_fin, '%d/%m/%Y') AS fecha_fin,
                   j.tipo_justificacion AS tipo, j.descripcion, j.estado, j.observaciones_director, j.materia,
                   (j.documento_url IS NOT NULL AND j.documento_url <> '') AS tiene_archivo,
                   CONCAT(u.nombre, ' ', u.apellido) AS estudiante, u.cedula,
                   CONCAT(c.nombre, ' ', c.seccion) AS curso
            FROM justificaciones j
            JOIN usuarios u ON j.usuario_id = u.id
            JOIN estudiante_curso ec ON u.id = ec.estudiante_id AND ec.activo = 1
            JOIN cursos c ON ec.curso_id = c.id
            WHERE ec.curso_id IN (SELECT curso_id FROM profesor_curso WHERE profesor_id = ? AND activo = 1)
            AND (
                j.materia IS NULL 
                OR j.materia = '' 
                OR j.materia IN (SELECT materia FROM profesor_curso WHERE profesor_id = ? AND activo = 1)
            )
            GROUP BY j.id
            ORDER BY j.fecha_inicio DESC
        `, [profesor.id, profesor.id]);
        res.json({ estado: 'exitoso', datos: results });
    } catch (err) {
        console.error('Error al obtener justificaciones del profesor:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener las justificaciones' });
    }
});

router.get('/estudiantes/:id', soloPropio('id'), async (req, res) => {
    try {
        const profesor = await cargarProfesor(req, res);
        if (!profesor) return;

        const [results] = await db.query(`
            SELECT DISTINCT u.id, u.nombre, u.apellido, c.nombre AS curso_nombre, c.seccion
            FROM usuarios u
            JOIN estudiante_curso ec ON u.id = ec.estudiante_id AND ec.activo = 1
            JOIN cursos c ON ec.curso_id = c.id
            WHERE ec.curso_id IN (SELECT curso_id FROM profesor_curso WHERE profesor_id = ? AND activo = 1)
              AND u.activo = 1
            ORDER BY u.nombre ASC
        `, [profesor.id]);
        res.json({ estado: 'exitoso', datos: results });
    } catch (err) {
        console.error('Error al obtener estudiantes del profesor:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener los estudiantes' });
    }
});

router.post('/justificaciones', soloRoles('profesor'), async (req, res) => {
    const { estudiante_id, fecha_inicio, fecha_fin, tipo, descripcion } = req.body || {};
    if (!estudiante_id || !esFechaValida(fecha_inicio) || !esFechaValida(fecha_fin)) {
        return res.status(400).json({ estado: 'error', mensaje: 'Estudiante y fechas son obligatorios.' });
    }
    if (fecha_fin < fecha_inicio) {
        return res.status(400).json({ estado: 'error', mensaje: 'La fecha fin no puede ser antes de la fecha inicio.' });
    }
    if (!TIPOS_JUSTIFICACION.includes(tipo)) {
        return res.status(400).json({ estado: 'error', mensaje: 'Tipo de justificación no válido.' });
    }
    try {
        const [es] = await db.query(`
            SELECT 1 FROM estudiante_curso ec
            JOIN profesor_curso pc ON pc.curso_id = ec.curso_id AND pc.activo = 1
            WHERE ec.estudiante_id = ? AND ec.activo = 1 AND pc.profesor_id = ? LIMIT 1
        `, [estudiante_id, req.usuario.id]);
        if (es.length === 0) {
            return res.status(403).json({ estado: 'error', mensaje: 'Ese estudiante no es de sus secciones.' });
        }
        const config = await leerConfig(db);
        if (fecha_fin < sumarDias(hoyLocal(), -config.dias_maximos_justificar)) {
            return res.status(400).json({ estado: 'error', mensaje: `El plazo para justificar es de ${config.dias_maximos_justificar} día(s) después de la falta.` });
        }
        await db.query(`
            INSERT INTO justificaciones (usuario_id, fecha_inicio, fecha_fin, tipo_justificacion, descripcion, estado)
            VALUES (?, ?, ?, ?, ?, 'pendiente')
        `, [estudiante_id, fecha_inicio, fecha_fin, tipo, (descripcion || '').toString().slice(0, 2000)]);
        const [[est]] = await db.query('SELECT nombre, apellido FROM usuarios WHERE id = ?', [estudiante_id]);
        const quien = est ? `${est.nombre} ${est.apellido}` : 'un estudiante';
        await notificar(db, await idsDirectores(db), 'Nueva justificación por revisar',
            `${req.usuario.nombre} ${req.usuario.apellido} registró una justificación de ${quien} (${fechaBonita(fecha_inicio)} al ${fechaBonita(fecha_fin)}).`,
            '/interfaces/director/justificaciones.html');
        await notificar(db, estudiante_id, 'Su profesor registró una justificación',
            `Del ${fechaBonita(fecha_inicio)} al ${fechaBonita(fecha_fin)}. Queda pendiente de aprobación del director.`,
            '/interfaces/estudiante/justificaciones.html');
        res.json({ estado: 'exitoso', mensaje: 'Justificación creada. Queda pendiente de aprobación del director.' });
    } catch (err) {
        console.error('Error al crear justificación:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al crear la justificación' });
    }
});

router.get('/horario/:id', soloPropio('id'), async (req, res) => {
    try {
        const profesor = await cargarProfesor(req, res);
        if (!profesor) return;

        const [results] = await db.query(`
            SELECT hc.id, hc.dia_semana, DATE_FORMAT(hc.hora_inicio, '%H:%i') AS hora_inicio,
                   DATE_FORMAT(hc.hora_fin, '%H:%i') AS hora_fin, hc.aula, hc.materia,
                   c.nombre AS curso_nombre, c.seccion
            FROM horarios_clase hc
            JOIN cursos c ON hc.curso_id = c.id
            WHERE hc.profesor_id = ? AND hc.activo = 1
            ORDER BY FIELD(hc.dia_semana, 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'), hc.hora_inicio
        `, [profesor.id]);
        res.json({ estado: 'exitoso', datos: results });
    } catch (err) {
        console.error('Error al obtener el horario del profesor:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al obtener el horario' });
    }
});

router.get('/reporte/:cursoId', soloRoles('profesor', 'director'), async (req, res) => {
    const { cursoId } = req.params;
    const mes = parseInt(req.query.mes, 10);
    const anio = parseInt(req.query.anio, 10);
    if (!(mes >= 1 && mes <= 12) || !(anio >= 2000 && anio <= 2100)) {
        return res.status(400).json({ estado: 'error', mensaje: 'Mes o año no válido.' });
    }

    try {
        let materia = req.query.materia || '';
        if (req.usuario.rol === 'profesor') {
            const asig = await materiaAsignada(req.usuario.id, cursoId, materia);
            if (asig.error) return res.status(403).json({ estado: 'error', mensaje: asig.error });
            materia = asig.materia;
        }

        const estudiantes = await estudiantesDeCurso(cursoId);
        const [asistencias] = await db.query(`
            SELECT a.usuario_id, DAY(a.fecha) AS dia, a.estado
            FROM asistencia a
            WHERE a.curso_id = ? AND a.materia = ? AND MONTH(a.fecha) = ? AND YEAR(a.fecha) = ?
        `, [cursoId, materia, mes, anio]);
        asistencias.forEach(a => { a.estado = normalizarEstado(a.estado) || a.estado; });

        const diasClase = [...new Set(asistencias.map(a => a.dia))].sort((x, y) => x - y);
        const config = await leerConfig(db);

        res.json({
            estado: 'exitoso',
            materia,
            estudiantes,
            asistencias,
            dias_clase: diasClase,
            porcentaje_minimo: config.porcentaje_asistencia_minimo
        });

    } catch (err) {
        console.error('Error al generar matriz de reporte:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al generar el reporte' });
    }
});

module.exports = router;