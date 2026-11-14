const express = require('express');
const router = express.Router();
const db = require('../db');
const { soloRoles, soloPropio } = require('../lib/auth');
const {
    hoyLocal, horaLocal, esFechaValida, normalizarEstado, nombreDia, leerConfig,
    eventoQueSuspende, sinAcentos, TIPOS_JUSTIFICACION, sumarDias, bloqueoPorTurno } = require('../lib/util');

const { notificar, idsDirectores, fechaBonita } = require('../lib/notificar');
const { noDadaDe, suplenciaDe } = require('../lib/clases');
const { extraerCodigo } = require('../lib/carnet');
const { anioEscolarActual } = require('../lib/periodo');

const mismaMateria = (a, b) => sinAcentos(a).trim() === sinAcentos(b).trim();

async function asignacionesDe(profesorId) {
    const [rows] = await db.query(`
        SELECT c.id AS curso_id, c.nombre AS curso_nombre, c.seccion, c.turno, c.nivel, pc.materia
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

// La clase es del profesor... o la cubre como suplente ese día
async function claseQuePuedePasar(profesorId, cursoId, materia, fecha) {
    const asig = await materiaAsignada(profesorId, cursoId, materia);
    if (!asig.error) return asig;
    const sup = await suplenciaDe(db, profesorId, cursoId, materia, fecha);
    if (sup) return { materia: sup.materia, suplencia: sup };
    return asig;
}
const MSG_NO_DADA = (nd) => `La dirección marcó esta clase como no dada (${nd.motivo}). No se pasa lista. Si al final sí se dio, pida a la dirección que quite esa marca.`;

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
        turno: a.turno || '',
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
        let suplencia = null;
        if (req.usuario.rol === 'profesor') {
            const asig = await claseQuePuedePasar(req.usuario.id, cursoId, materia, fecha);
            if (asig.error) return res.status(403).json({ estado: 'error', mensaje: asig.error });
            materia = asig.materia;
            suplencia = asig.suplencia || null;
        }

        const [curso] = await db.query('SELECT nombre, seccion, turno FROM cursos WHERE id = ?', [cursoId]);
        if (curso.length === 0) return res.status(404).json({ estado: 'error', mensaje: 'Sección no encontrada' });

        const estudiantes = await estudiantesDeCurso(cursoId);
        const lista = [];
        for (const est of estudiantes) {
            const [asist] = await db.query(
                "SELECT estado, observaciones, DATE_FORMAT(hora_entrada, '%H:%i') AS hora, metodo FROM asistencia WHERE usuario_id = ? AND fecha = ? AND curso_id = ? AND materia = ? LIMIT 1",
                [est.id, fecha, cursoId, materia]
            );
            lista.push({
                ...est,
                estado: asist[0] ? normalizarEstado(asist[0].estado) : '',
                observaciones: asist[0] ? (asist[0].observaciones || '') : '',
                hora: asist[0] ? asist[0].hora : '',
                metodo: asist[0] ? (asist[0].metodo || 'manual') : ''
            });
        }

        const feriado = await eventoQueSuspende(db, fecha);
        // Bloque de la clase ese día: "tarde" = inicio de la clase + tolerancia (igual que al escanear el carnet)
        const tolerancia = await minutosTolerancia();
        const profId = req.usuario.rol === 'profesor' && !suplencia ? req.usuario.id : (suplencia && suplencia.profesor_titular_id) || await profesorDeClase(cursoId, materia);
        const noDada = await noDadaDe(db, cursoId, materia, fecha);
        const bloquesDia = (await horariosDe(profId, cursoId, materia)).filter(h => h.dia_semana === nombreDia(fecha));
        let clase = null;
        if (bloquesDia.length) {
            const m = aMinutos(bloquesDia[0].inicio) + tolerancia;
            clase = { inicio: bloquesDia[0].inicio, fin: bloquesDia[bloquesDia.length - 1].fin,
                tarde_desde: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` };
        }
        res.json({
            estado: 'exitoso',
            clase,
            suplencia: suplencia ? { titular: suplencia.titular } : null,
            clase_no_dada: noDada ? MSG_NO_DADA(noDada) : null,
            curso: `${curso[0].nombre} - ${curso[0].seccion}${curso[0].turno ? ` · ${curso[0].turno}` : ''}`,
            turno: curso[0].turno || '',
            materia,
            fecha,
            hoy,
            puede_editar_pasadas: config.permitir_edicion_asistencia,
            // El profesor no pasa lista de una sección de la mañana en la tarde (ni al revés). El director sí puede.
            turno_bloqueado: req.usuario.rol === 'profesor' ? bloqueoPorTurno(curso[0].turno, config.hora_cambio_turno) : null,
            hora_cambio_turno: config.hora_cambio_turno,
            minutos_tolerancia: await minutosTolerancia(),
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
            const asig = await claseQuePuedePasar(req.usuario.id, curso_id, materia, fecha);
            if (asig.error) return res.status(403).json({ estado: 'error', mensaje: asig.error });
            materia = asig.materia;
        }
        const noDada = await noDadaDe(db, curso_id, materia, fecha);
        if (noDada) return res.status(400).json({ estado: 'error', mensaje: MSG_NO_DADA(noDada), clase_no_dada: true });

        if (req.usuario.rol === 'profesor') {
            const [[ct]] = await db.query('SELECT turno FROM cursos WHERE id = ?', [curso_id]);
            const fueraDeTurno = bloqueoPorTurno(ct && ct.turno, config.hora_cambio_turno);
            if (fueraDeTurno) return res.status(403).json({ estado: 'error', mensaje: fueraDeTurno, fuera_de_turno: true });
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
                INSERT INTO asistencia (usuario_id, curso_id, materia, profesor_id, fecha, hora_entrada, estado, observaciones, justificacion_id, estado_previo, metodo)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
                ON DUPLICATE KEY UPDATE metodo = IF(estado = VALUES(estado), COALESCE(metodo, 'manual'), 'manual'),
                    estado = VALUES(estado), observaciones = VALUES(observaciones),
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

async function minutosTolerancia() {
    const [[c]] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'minutos_tolerancia'");
    const n = c ? parseInt(c.valor, 10) : 10;
    return Number.isFinite(n) && n >= 0 && n <= 120 ? n : 10;
}

const aMinutos = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };

// Escanear el carnet (cámara del celular o lector USB) mientras se pasa lista HOY.
// Marca Presente, o Tarde si llega después del inicio de la clase + la tolerancia.
router.post('/escanear', soloRoles('profesor', 'director'), async (req, res) => {
    const { curso_id } = req.body || {};
    const hoy = hoyLocal();
    const ahora = horaLocal();
    const codigo = extraerCodigo(req.body && req.body.codigo);
    let materia = (req.body && req.body.materia) || '';

    const registrar = (resultado, extra = {}) => db.query(
        'INSERT INTO escaneos (carnet_id, estudiante_id, profesor_id, curso_id, materia, fecha, hora, resultado, detalle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [extra.carnet_id || null, extra.estudiante_id || null, req.usuario.id, Number(curso_id) || 0, materia, hoy, ahora, resultado, (extra.detalle || '').slice(0, 255)]
    ).catch(() => {});

    if (!curso_id) return res.status(400).json({ estado: 'error', mensaje: 'Abra primero la lista de una clase.' });
    if (!codigo) {
        await registrar('ilegible', { detalle: String((req.body && req.body.codigo) || '').slice(0, 60) });
        return res.status(400).json({ estado: 'error', resultado: 'invalido', mensaje: 'Ese código no es un carnet del instituto.' });
    }

    try {
        let suplenciaEsc = null;
        if (req.usuario.rol === 'profesor') {
            const asig = await claseQuePuedePasar(req.usuario.id, curso_id, materia, hoy);
            if (asig.error) return res.status(403).json({ estado: 'error', mensaje: asig.error });
            materia = asig.materia;
            suplenciaEsc = asig.suplencia || null;
            const [[ct]] = await db.query('SELECT turno FROM cursos WHERE id = ?', [curso_id]);
            const fueraDeTurno = bloqueoPorTurno(ct && ct.turno, (await leerConfig(db)).hora_cambio_turno);
            if (fueraDeTurno) {
                await registrar('fuera_de_turno');
                return res.status(403).json({ estado: 'error', resultado: 'fuera_de_turno', mensaje: fueraDeTurno });
            }
        }
        const feriado = await eventoQueSuspende(db, hoy);
        if (feriado) return res.status(400).json({ estado: 'error', mensaje: `Hoy no hay clases (${feriado.titulo}).` });
        const noDadaEsc = await noDadaDe(db, curso_id, materia, hoy);
        if (noDadaEsc) return res.status(400).json({ estado: 'error', resultado: 'no_dada', mensaje: MSG_NO_DADA(noDadaEsc) });

        const [[carnet]] = await db.query(`
            SELECT k.id, k.estudiante_id, k.activo, k.anio_academico, u.nombre, u.apellido, u.cedula, u.activo AS usuario_activo
            FROM carnets k JOIN usuarios u ON u.id = k.estudiante_id WHERE k.codigo = ?
        `, [codigo]);
        if (!carnet) {
            await registrar('desconocido', { detalle: codigo });
            return res.status(404).json({ estado: 'error', resultado: 'invalido', mensaje: 'Carnet no registrado en el sistema.' });
        }
        const estudiante = { id: carnet.estudiante_id, nombre: carnet.nombre, apellido: carnet.apellido, cedula: carnet.cedula };
        const [[foto]] = await db.query('SELECT 1 AS si FROM fotos_usuario WHERE usuario_id = ?', [carnet.estudiante_id]);
        estudiante.tiene_foto = !!foto;

        if (!carnet.activo || Number(carnet.anio_academico) !== await anioEscolarActual(db)) {
            await registrar('anulado', { carnet_id: carnet.id, estudiante_id: carnet.estudiante_id });
            return res.status(400).json({ estado: 'error', resultado: 'anulado', estudiante,
                mensaje: 'Este carnet ya no sirve (fue reemplazado o es de otro periodo). Márquelo a mano y avise a la dirección.' });
        }
        if (!carnet.usuario_activo) {
            await registrar('inactivo', { carnet_id: carnet.id, estudiante_id: carnet.estudiante_id });
            return res.status(400).json({ estado: 'error', resultado: 'inactivo', estudiante, mensaje: 'El estudiante está desactivado en el sistema.' });
        }
        const [[enSeccion]] = await db.query(
            'SELECT 1 AS si FROM estudiante_curso WHERE estudiante_id = ? AND curso_id = ? AND activo = 1 LIMIT 1',
            [carnet.estudiante_id, curso_id]
        );
        if (!enSeccion) {
            const [[otra]] = await db.query(`
                SELECT c.nombre, c.seccion, c.turno FROM estudiante_curso ec JOIN cursos c ON c.id = ec.curso_id
                WHERE ec.estudiante_id = ? AND ec.activo = 1 LIMIT 1
            `, [carnet.estudiante_id]);
            await registrar('otra_seccion', { carnet_id: carnet.id, estudiante_id: carnet.estudiante_id });
            return res.status(400).json({ estado: 'error', resultado: 'otra_seccion', estudiante,
                mensaje: otra ? `No es de esta sección: está en ${otra.nombre} ${otra.seccion}${otra.turno ? ` (${otra.turno})` : ''}.` : 'No está inscrito en esta sección.' });
        }

        // ¿Ya estaba marcado en esta clase hoy?
        const [[previo]] = await db.query(
            "SELECT estado, DATE_FORMAT(hora_entrada, '%H:%i') AS hora, metodo FROM asistencia WHERE usuario_id = ? AND fecha = ? AND curso_id = ? AND materia = ?",
            [carnet.estudiante_id, hoy, curso_id, materia]
        );
        if (previo && ['presente', 'tarde', 'justificada'].includes(normalizarEstado(previo.estado))) {
            await registrar('repetido', { carnet_id: carnet.id, estudiante_id: carnet.estudiante_id });
            return res.json({ estado: 'exitoso', resultado: 'ya_marcado', estudiante, marca: normalizarEstado(previo.estado), hora: previo.hora,
                mensaje: `Ya estaba marcado: ${normalizarEstado(previo.estado)} (${previo.hora}).` });
        }

        // ¿Presente o tarde? Según el bloque de horario de esta clase hoy
        const tolerancia = await minutosTolerancia();
        const dia = nombreDia(hoy);
        const bloques = (await horariosDe(req.usuario.rol === 'profesor' && !suplenciaEsc ? req.usuario.id : ((suplenciaEsc && suplenciaEsc.profesor_titular_id) || await profesorDeClase(curso_id, materia)), curso_id, materia))
            .filter(h => h.dia_semana === dia);
        const minAhora = aMinutos(ahora);
        // El bloque que está en curso; si no hay, el último que ya empezó hoy
        const bloque = bloques.find(h => aMinutos(h.inicio) <= minAhora && minAhora <= aMinutos(h.fin))
            || bloques.filter(h => aMinutos(h.inicio) <= minAhora).pop();
        let marca = 'presente';
        if (bloque && minAhora > aMinutos(bloque.inicio) + tolerancia) marca = 'tarde';

        await db.query(`
            INSERT INTO asistencia (usuario_id, curso_id, materia, profesor_id, fecha, hora_entrada, estado, observaciones, metodo)
            VALUES (?, ?, ?, ?, ?, ?, ?, '', 'qr')
            ON DUPLICATE KEY UPDATE estado = VALUES(estado), hora_entrada = VALUES(hora_entrada), profesor_id = VALUES(profesor_id),
                metodo = 'qr', justificacion_id = NULL, estado_previo = NULL
        `, [carnet.estudiante_id, curso_id, materia, req.usuario.id, hoy, ahora, marca]);

        // ¿El mismo carnet ya se marcó hoy en OTRA clase que sigue en curso ahora mismo?
        // Un estudiante no puede estar en dos clases a la vez: posible carnet copiado.
        // (Clases seguidas no cuentan: la anterior ya terminó.)
        const [otros] = await db.query(`
            SELECT e.hora, e.materia, e.curso_id, c.nombre, c.seccion FROM escaneos e JOIN cursos c ON c.id = e.curso_id
            WHERE e.estudiante_id = ? AND e.fecha = ? AND e.resultado = 'marcado'
              AND (e.curso_id <> ? OR e.materia <> ?) AND ABS(TIME_TO_SEC(TIMEDIFF(e.hora, ?))) < 3600
            ORDER BY e.id DESC LIMIT 5
        `, [carnet.estudiante_id, hoy, curso_id, materia, ahora]);
        await registrar('marcado', { carnet_id: carnet.id, estudiante_id: carnet.estudiante_id, detalle: marca });

        let choque = null;
        for (const o of otros) {
            const bl = (await horariosDe(await profesorDeClase(o.curso_id, o.materia), o.curso_id, o.materia)).filter(h => h.dia_semana === dia);
            if (bl.some(h => aMinutos(h.inicio) <= minAhora && minAhora < aMinutos(h.fin))) { choque = o; break; }
        }
        let alerta = null;
        if (choque) {
            alerta = `Ojo: este carnet ya se marcó a las ${String(choque.hora).slice(0, 5)} en ${choque.materia} (${choque.nombre} ${choque.seccion}), clase que sigue en curso. Verifique que sea el estudiante.`;
            await notificar(db, await idsDirectores(db), 'Posible carnet copiado',
                `El carnet de ${estudiante.nombre} ${estudiante.apellido} se marcó en dos clases que ocurren a la misma hora: ${choque.materia} (${String(choque.hora).slice(0, 5)}) y ${materia} (${ahora.slice(0, 5)}).`,
                '/interfaces/director/asistencia.html');
        }
        if (marca === 'tarde') {
            const [[cursoInfo]] = await db.query('SELECT nombre, seccion FROM cursos WHERE id = ?', [curso_id]);
            await notificar(db, carnet.estudiante_id, 'Llegada tarde registrada',
                `Tarde en ${materia}${cursoInfo ? ` (${cursoInfo.nombre} ${cursoInfo.seccion})` : ''} el ${fechaBonita(hoy)}. Si tiene un motivo, puede solicitar una justificación.`,
                '/interfaces/estudiante/justificaciones.html');
        }
        res.json({
            estado: 'exitoso', resultado: 'marcado', estudiante, marca, hora: ahora.slice(0, 5), alerta,
            mensaje: marca === 'tarde' ? `Tarde (llegó ${minAhora - aMinutos(bloque.inicio)} min después del inicio).` : 'Presente.'
        });
    } catch (err) {
        console.error('Error al escanear carnet:', err);
        res.status(500).json({ estado: 'error', mensaje: 'No se pudo registrar el escaneo.' });
    }
});

// Para el director que pasa lista: profesor que tiene esa clase (para leer su horario)
async function profesorDeClase(cursoId, materia) {
    const [filas] = await db.query('SELECT profesor_id, materia FROM profesor_curso WHERE curso_id = ? AND activo = 1', [cursoId]);
    const f = filas.find(x => mismaMateria(x.materia || '', materia)) || filas[0];
    return f ? f.profesor_id : 0;
}

router.get('/justificaciones/:id', soloPropio('id'), async (req, res) => {
    try {
        const profesor = await cargarProfesor(req, res);
        if (!profesor) return;

        const [results] = await db.query(`
            SELECT j.id, DATE_FORMAT(j.fecha_inicio, '%d/%m/%Y') AS fecha_inicio, DATE_FORMAT(j.fecha_fin, '%d/%m/%Y') AS fecha_fin,
                   j.tipo_justificacion AS tipo, j.descripcion, j.estado, j.observaciones_director, j.materia,
                   (j.documento_url IS NOT NULL AND j.documento_url <> '') AS tiene_archivo,
                   CONCAT(u.nombre, ' ', u.apellido) AS estudiante, u.cedula,
                   CONCAT(c.nombre, ' ', c.seccion, IF(c.turno IS NULL OR c.turno = '', '', CONCAT(' · ', c.turno))) AS curso
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
            GROUP BY j.id, j.fecha_inicio, j.fecha_fin, j.tipo_justificacion, j.descripcion, j.estado,
                     j.observaciones_director, j.materia, j.documento_url, u.nombre, u.apellido, u.cedula, c.nombre, c.seccion, c.turno
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
            SELECT DISTINCT u.id, u.nombre, u.apellido, c.nombre AS curso_nombre, c.seccion, c.turno
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
    const { estudiante_id, fecha_inicio, fecha_fin, descripcion } = req.body || {};
    const tipo = (req.body && (req.body.tipo || req.body.tipo_justificacion)) || '';
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
                   c.nombre AS curso_nombre, c.seccion, c.turno
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
        const [nd] = await db.query('SELECT DAY(fecha) AS dia, materia, motivo FROM clases_no_dadas WHERE curso_id = ? AND MONTH(fecha) = ? AND YEAR(fecha) = ?', [cursoId, mes, anio]);
        const noDadas = nd.filter(x => mismaMateria(x.materia, materia)).map(x => ({ dia: x.dia, motivo: x.motivo }));

        res.json({
            estado: 'exitoso',
            materia,
            estudiantes,
            asistencias,
            dias_clase: diasClase,
            no_dadas: noDadas,
            porcentaje_minimo: config.porcentaje_asistencia_minimo
        });

    } catch (err) {
        console.error('Error al generar matriz de reporte:', err);
        res.status(500).json({ estado: 'error', mensaje: 'Error al generar el reporte' });
    }
});

module.exports = router;