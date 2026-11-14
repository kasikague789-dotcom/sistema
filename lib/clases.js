// Clases de un día según el horario, con su estado:
//   con_lista  · ya se pasó lista
//   no_dada    · la dirección la marcó como no dada (profesor ausente, etc.): no cuenta como falta
//   por_empezar / en_curso / sin_lista (ya terminó y nadie pasó lista) / programada (día futuro)
//   feriado    · ese día no hay clases
// También dice si tiene suplente asignado.
const { nombreDia, hoyLocal, horaLocal, sinAcentos, eventoQueSuspende } = require('./util');

const mismaMateria = (a, b) => sinAcentos(a).trim() === sinAcentos(b).trim();
const aMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + (b || 0); };

// ¿Esa clase de ese día está marcada como no dada?
async function noDadaDe(db, cursoId, materia, fecha) {
    const [rows] = await db.query('SELECT id, materia, motivo FROM clases_no_dadas WHERE curso_id = ? AND fecha = ?', [cursoId, fecha]);
    return rows.find(r => mismaMateria(r.materia, materia || '')) || null;
}

// ¿Este profesor es suplente de esa clase ese día? (si no se dice la materia y tiene una sola, esa)
async function suplenciaDe(db, profesorId, cursoId, materia, fecha) {
    const [rows] = await db.query(`
        SELECT s.id, s.materia, s.profesor_titular_id, CONCAT(t.nombre, ' ', t.apellido) AS titular
        FROM suplencias s LEFT JOIN usuarios t ON t.id = s.profesor_titular_id
        WHERE s.profesor_suplente_id = ? AND s.curso_id = ? AND s.fecha = ?`, [profesorId, cursoId, fecha]);
    if (!materia) return rows.length === 1 ? rows[0] : null;
    return rows.find(r => mismaMateria(r.materia, materia)) || null;
}

async function clasesDelDia(db, fecha, { cursoId = null } = {}) {
    const dia = nombreDia(fecha);
    const params = [dia];
    let extra = '';
    if (cursoId) { extra = ' AND h.curso_id = ?'; params.push(cursoId); }
    const [bloques] = await db.query(`
        SELECT h.curso_id, h.materia, h.profesor_id, DATE_FORMAT(h.hora_inicio, '%H:%i') AS inicio, DATE_FORMAT(h.hora_fin, '%H:%i') AS fin, h.aula,
               c.nombre AS curso_nombre, c.seccion, c.turno, CONCAT(u.nombre, ' ', u.apellido) AS profesor
        FROM horarios_clase h
        JOIN cursos c ON c.id = h.curso_id AND c.activo = 1
        JOIN usuarios u ON u.id = h.profesor_id
        WHERE h.activo = 1 AND h.dia_semana = ?${extra}
        ORDER BY h.hora_inicio, c.nombre, c.seccion`, params);

    // Una clase puede tener dos bloques el mismo día: se junta en una
    const clases = [];
    for (const b of bloques) {
        const c = clases.find(x => x.curso_id === b.curso_id && mismaMateria(x.materia, b.materia));
        if (!c) clases.push({ ...b });
        else { if (b.inicio < c.inicio) c.inicio = b.inicio; if (b.fin > c.fin) c.fin = b.fin; }
    }

    const [regs] = await db.query('SELECT curso_id, materia, COUNT(*) AS n FROM asistencia WHERE fecha = ? GROUP BY curso_id, materia', [fecha]);
    const [noDadas] = await db.query('SELECT id, curso_id, materia, motivo FROM clases_no_dadas WHERE fecha = ?', [fecha]);
    const [sups] = await db.query(`
        SELECT s.id, s.curso_id, s.materia, s.profesor_suplente_id, CONCAT(u.nombre, ' ', u.apellido) AS suplente
        FROM suplencias s JOIN usuarios u ON u.id = s.profesor_suplente_id WHERE s.fecha = ?`, [fecha]);
    const [ests] = await db.query(`
        SELECT ec.curso_id, COUNT(DISTINCT ec.estudiante_id) AS n
        FROM estudiante_curso ec JOIN usuarios u ON u.id = ec.estudiante_id AND u.activo = 1 AND u.rol = 'estudiante'
        WHERE ec.activo = 1 GROUP BY ec.curso_id`);
    const feriado = await eventoQueSuspende(db, fecha);
    const hoy = hoyLocal();
    const ahora = aMin(horaLocal());

    return {
        fecha, dia, feriado: feriado ? feriado.titulo : null,
        clases: clases.map(c => {
            const marcados = regs.filter(r => r.curso_id === c.curso_id && mismaMateria(r.materia || '', c.materia)).reduce((s, r) => s + Number(r.n), 0);
            const nd = noDadas.find(r => r.curso_id === c.curso_id && mismaMateria(r.materia, c.materia));
            const sp = sups.find(r => r.curso_id === c.curso_id && mismaMateria(r.materia, c.materia));
            let estado;
            if (feriado) estado = 'feriado';
            else if (nd) estado = 'no_dada';
            else if (marcados > 0) estado = 'con_lista';
            else if (fecha > hoy) estado = 'programada';
            else if (fecha < hoy) estado = 'sin_lista';
            else if (ahora < aMin(c.inicio)) estado = 'por_empezar';
            else if (ahora <= aMin(c.fin)) estado = 'en_curso';
            else estado = 'sin_lista';
            const e = ests.find(x => x.curso_id === c.curso_id);
            return {
                curso_id: c.curso_id, curso: `${c.curso_nombre} ${c.seccion}`, turno: c.turno || '',
                materia: c.materia, profesor_id: c.profesor_id, profesor: c.profesor,
                inicio: c.inicio, fin: c.fin, aula: c.aula || '',
                estudiantes: e ? Number(e.n) : 0, marcados, estado,
                no_dada: nd ? { id: nd.id, motivo: nd.motivo } : null,
                suplente: sp ? { id: sp.id, profesor_id: sp.profesor_suplente_id, nombre: sp.suplente } : null
            };
        })
    };
}

module.exports = { clasesDelDia, noDadaDe, suplenciaDe, mismaMateria };
