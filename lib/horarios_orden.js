// Revisión y orden de horarios con datos REALES (no inventa horas).
//  - Desactiva bloques imposibles (terminan antes de empezar).
//  - Si hay horario de una materia que el profesor no tiene asignada, la asigna
//    (el dato ya está en el horario; solo se completa "Asignar Profesores").
//  - Informa choques y secciones sin horario para que el director los corrija.

async function ordenarHorarios(db, { aplicar = true, log = console.log } = {}) {
    const cambios = [];

    const [malos] = await db.query(`
        SELECT id, materia, dia_semana, DATE_FORMAT(hora_inicio, '%H:%i') AS ini, DATE_FORMAT(hora_fin, '%H:%i') AS fin
        FROM horarios_clase WHERE activo = 1 AND hora_fin <= hora_inicio
    `);
    for (const h of malos) {
        cambios.push(`Desactivado bloque #${h.id} ${h.materia} ${h.dia_semana} ${h.ini}-${h.fin} (termina antes de empezar)`);
        if (aplicar) await db.query('UPDATE horarios_clase SET activo = 0 WHERE id = ?', [h.id]);
    }

    const [faltan] = await db.query(`
        SELECT DISTINCT h.profesor_id, h.curso_id, TRIM(h.materia) AS materia, c.anio_escolar,
               CONCAT(u.nombre, ' ', u.apellido) AS profesor, CONCAT(c.nombre, ' ', c.seccion) AS seccion
        FROM horarios_clase h
        JOIN usuarios u ON u.id = h.profesor_id AND u.rol = 'profesor'
        JOIN cursos c ON c.id = h.curso_id
        WHERE h.activo = 1 AND h.hora_fin > h.hora_inicio AND NOT EXISTS (
            SELECT 1 FROM profesor_curso pc
            WHERE pc.profesor_id = h.profesor_id AND pc.curso_id = h.curso_id AND pc.activo = 1 AND TRIM(pc.materia) = TRIM(h.materia)
        )
    `);
    for (const f of faltan) {
        cambios.push(`Asignado ${f.materia} a ${f.profesor} en ${f.seccion} (tenía horario pero no asignación)`);
        if (aplicar) {
            await db.query('INSERT INTO profesor_curso (profesor_id, curso_id, materia, anio_academico, activo) VALUES (?, ?, ?, ?, 1)',
                [f.profesor_id, f.curso_id, f.materia, f.anio_escolar || new Date().getFullYear()]);
        }
    }

    const [choques] = await db.query(`
        SELECT CONCAT(u.nombre, ' ', u.apellido) AS quien, a.dia_semana,
               CONCAT(a.materia, ' ', ca.nombre, ' ', ca.seccion, ' ', DATE_FORMAT(a.hora_inicio, '%H:%i'), '-', DATE_FORMAT(a.hora_fin, '%H:%i')) AS clase_a,
               CONCAT(b.materia, ' ', cb.nombre, ' ', cb.seccion, ' ', DATE_FORMAT(b.hora_inicio, '%H:%i'), '-', DATE_FORMAT(b.hora_fin, '%H:%i')) AS clase_b
        FROM horarios_clase a
        JOIN horarios_clase b ON (a.profesor_id = b.profesor_id OR a.curso_id = b.curso_id)
             AND a.dia_semana = b.dia_semana AND a.id < b.id
             AND a.hora_inicio < b.hora_fin AND a.hora_fin > b.hora_inicio AND b.activo = 1
        JOIN usuarios u ON u.id = a.profesor_id
        JOIN cursos ca ON ca.id = a.curso_id JOIN cursos cb ON cb.id = b.curso_id
        WHERE a.activo = 1
    `);

    const [sinHorario] = await db.query(`
        SELECT CONCAT(c.nombre, ' ', c.seccion) AS seccion, COUNT(DISTINCT ec.estudiante_id) AS n
        FROM cursos c JOIN estudiante_curso ec ON ec.curso_id = c.id AND ec.activo = 1
        WHERE c.activo = 1 AND NOT EXISTS (SELECT 1 FROM horarios_clase h WHERE h.curso_id = c.id AND h.activo = 1)
        GROUP BY c.id, c.nombre, c.seccion ORDER BY c.nombre, c.seccion
    `);

    cambios.forEach(c => log(`  · ${c}`));
    if (choques.length > 0) {
        log(`  ! ${choques.length} choque(s) de horario. Corríjalos en Director > Horarios con la hora real:`);
        choques.forEach(c => log(`      ${c.dia_semana}: ${c.clase_a}  <>  ${c.clase_b}`));
    }
    if (sinHorario.length > 0) {
        log(`  ! Secciones con estudiantes y sin horario: ${sinHorario.map(s => `${s.seccion} (${s.n})`).join(', ')}`);
    }
    return { cambios, choques, sinHorario };
}

module.exports = { ordenarHorarios };
