// Borra los datos de prueba viejos y crea cuentas nuevas para probar el sistema.
//
//   node reiniciar_bd.js              -> solo MUESTRA lo que borraría (no cambia nada)
//   node reiniciar_bd.js --confirmar  -> guarda respaldo en respaldos_bd/ y lo hace
//
// Se BORRA: usuarios, asistencia, justificaciones, horarios, asignaciones,
//           inscripciones de estudiantes, eventos del calendario y notificaciones.
// Se CONSERVA: secciones (cursos), configuración y lista de groserías.
//
// Se CREA (todo marcado como "Prueba" para reconocerlo y borrarlo después):
//   Director (super administrador, único): admin@elenadebueno.local   cédula 10000000
//   Profesor   : profesor@prueba.local   cédula 20000001  (Matemática en 1er Grado A)
//   Estudiante : estudiante1@prueba.local cédula 30000001 (1er Grado A)
//   Estudiante : estudiante2@prueba.local cédula 30000002 (1er Grado A)
//   Un bloque de horario de prueba: Matemática, lunes 08:00-09:30, aula "PRUEBA"
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { prepararBaseDeDatos, respaldarJSON } = require('./lib/migraciones');

const CUENTAS = [
    { rol: 'director', cedula: '10000000', nombre: 'Super', apellido: 'Administrador', email: 'admin@elenadebueno.local', clave: 'Admin-KDuvr286' },
    { rol: 'profesor', cedula: '20000001', nombre: 'Profesor', apellido: 'Prueba', email: 'profesor@prueba.local', clave: 'Prof-GCnsv636' },
    { rol: 'estudiante', cedula: '30000001', nombre: 'Estudiante', apellido: 'Uno', email: 'estudiante1@prueba.local', clave: 'Est1-WHjwm842' },
    { rol: 'estudiante', cedula: '30000002', nombre: 'Estudiante', apellido: 'Dos', email: 'estudiante2@prueba.local', clave: 'Est2-HEmdt498' }
];
const SECCION = { nombre: '1er Grado', seccion: 'A' };
const MATERIA = 'Matemática';

// Orden seguro por las llaves foráneas
const TABLAS_A_VACIAR = ['notificaciones', 'asistencia', 'justificaciones', 'horarios_clase', 'profesor_curso',
    'estudiante_curso', 'calendario_academico', 'usuarios'];

(async () => {
    const confirmar = process.argv.includes('--confirmar');

    // Por si el servidor nuevo aún no se ha arrancado: deja la base en la versión nueva
    await prepararBaseDeDatos(db, { avisos: false });

    console.log(confirmar ? '\n== Reiniciando datos ==' : '\n== Vista previa (agregue --confirmar para hacerlo) ==');
    for (const t of TABLAS_A_VACIAR) {
        const [[c]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
        console.log(`  · ${t}: ${c.n} fila(s) ${confirmar ? 'a borrar' : 'se borrarían'}`);
    }
    const [sec] = await db.query('SELECT id FROM cursos WHERE nombre = ? AND seccion = ? ORDER BY id LIMIT 1', [SECCION.nombre, SECCION.seccion]);
    if (sec.length === 0) {
        console.log(`  ! No existe la sección ${SECCION.nombre} ${SECCION.seccion}. Créela primero o cambie SECCION en este archivo.`);
        process.exit(1);
    }
    const cursoId = sec[0].id;

    if (!confirmar) {
        console.log('\nNo se cambió nada.');
        process.exit(0);
    }

    const archivo = await respaldarJSON(db, 'Antes de reiniciar_bd.js');
    console.log(`  · Respaldo guardado en ${archivo}`);

    const con = await db.getConnection();
    try {
        await con.beginTransaction();
        for (const t of TABLAS_A_VACIAR) await con.query(`DELETE FROM \`${t}\``);

        const ids = {};
        for (const c of CUENTAS) {
            const [r] = await con.query(
                'INSERT INTO usuarios (cedula, nombre, apellido, email, telefono, rol, password, activo, verificado) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)',
                [c.cedula, c.nombre, c.apellido, c.email, '', c.rol, await bcrypt.hash(c.clave, 10)]
            );
            ids[c.email] = r.insertId;
        }
        const anio = new Date().getFullYear();
        await con.query('INSERT INTO estudiante_curso (estudiante_id, curso_id, anio_academico, activo) VALUES (?, ?, ?, 1), (?, ?, ?, 1)',
            [ids['estudiante1@prueba.local'], cursoId, anio, ids['estudiante2@prueba.local'], cursoId, anio]);
        await con.query('INSERT INTO profesor_curso (profesor_id, curso_id, materia, anio_academico, activo) VALUES (?, ?, ?, ?, 1)',
            [ids['profesor@prueba.local'], cursoId, MATERIA, anio]);
        await con.query(
            "INSERT INTO horarios_clase (profesor_id, curso_id, dia_semana, hora_inicio, hora_fin, aula, materia, activo) VALUES (?, ?, 'Lunes', '08:00:00', '09:30:00', 'PRUEBA', ?, 1)",
            [ids['profesor@prueba.local'], cursoId, MATERIA]
        );
        await con.commit();
    } catch (err) {
        await con.rollback();
        console.error('Error: no se cambió nada.', err.message);
        process.exit(1);
    } finally {
        con.release();
    }

    console.log('\nListo. Cuentas de prueba (puede entrar con el correo o con la cédula):');
    CUENTAS.forEach(c => console.log(`  ${c.rol.padEnd(10)} ${c.email.padEnd(26)} cédula ${c.cedula}   clave ${c.clave}`));
    console.log('\nCambie estas claves cuando el sistema pase a uso real.');
    process.exit(0);
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
