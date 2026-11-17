// Prepara la base de datos al arrancar el servidor (no hace falta usar phpMyAdmin).
//  1. Si la base es la versión vieja, guarda un respaldo JSON en /respaldos_bd y
//     aplica migracion_2026_11.sql (una sola vez).
//  2. Asegura que todas las columnas y tablas requeridas por el sistema existan
//     (verificación de correo, datos pendientes, materias en justificaciones y calendario).
//  3. Ordena horarios con datos reales (ver lib/horarios_orden.js).
//  4. Avisa si ningún director puede entrar.
const fs = require('fs');
const path = require('path');
const { ordenarHorarios } = require('./horarios_orden');

const VERSION = '2026-11';

const TABLAS_RESPALDO = ['usuarios', 'cursos', 'estudiante_curso', 'profesor_curso', 'horarios_clase',
    'asistencia', 'justificaciones', 'calendario_academico', 'configuracion_sistema', 'filtro_groserias'];

async function respaldarJSON(db, motivo) {
    const carpeta = path.join(__dirname, '..', 'respaldos_bd');
    fs.mkdirSync(carpeta, { recursive: true });
    const d = new Date();
    const dos = (n) => String(n).padStart(2, '0');
    const sello = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}_${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
    const datos = { motivo, fecha: d.toString(), tablas: {} };
    for (const t of TABLAS_RESPALDO) {
        try {
            const [filas] = await db.query(`SELECT * FROM \`${t}\``);
            datos.tablas[t] = filas;
        } catch { /* tabla que no existe: se omite */ }
    }
    // Nunca se sobrescribe un respaldo anterior
    let archivo = path.join(carpeta, `respaldo_${sello}.json`);
    for (let i = 2; fs.existsSync(archivo); i++) archivo = path.join(carpeta, `respaldo_${sello}_${i}.json`);
    fs.writeFileSync(archivo, JSON.stringify(datos, null, 1));
    return archivo;
}

function leerSentencias(archivoSql) {
    const texto = fs.readFileSync(archivoSql, 'utf8')
        .split(/\r?\n/)
        .filter(l => !l.trim().startsWith('--'))
        .join('\n');
    return texto.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
}

async function asegurarColumna(db, tabla, columna, definicion) {
    const [cols] = await db.query(`SHOW COLUMNS FROM \`${tabla}\` LIKE ?`, [columna]);
    if (cols.length === 0) {
        await db.query(`ALTER TABLE \`${tabla}\` ADD COLUMN \`${columna}\` ${definicion}`);
    }
}

async function prepararBaseDeDatos(db, { avisos = true } = {}) {
    console.log('Revisando la base de datos...');

    // 1. Migración de asistencia por clase (una vez; se marca en configuracion_sistema)
    const [ver] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'version_bd'");
    if (!ver[0] || ver[0].valor < VERSION) {
        try {
            const archivo = await respaldarJSON(db, 'Antes de migracion_2026_11.sql');
            console.log(`  · Respaldo guardado en ${archivo}`);
        } catch (e) {
            console.warn('  · Aviso: no se pudo escribir respaldo local:', e.message);
        }
        const sentencias = leerSentencias(path.join(__dirname, '..', 'migracion_2026_11.sql'));
        for (const sql of sentencias) {
            try {
                await db.query(sql);
            } catch (err) {
                // Si ya se había aplicado a mano en phpMyAdmin, estas partes ya existen: se siguen los demás pasos
                if (['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(err.code)) continue;
                throw new Error(`Falló un paso de la migración: ${err.message}\nSQL: ${sql.slice(0, 200)}`);
            }
        }
        await db.query(
            "INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES ('version_bd', ?, 'Versión de la base de datos (no editar)') ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
            [VERSION]
        );
        console.log(`  · Migración aplicada (${sentencias.length} pasos): asistencia por clase y datos limpios.`);
    }

    // 2. Asegurar columnas de verificación estricta de correo y campos de justificaciones/calendario
    await asegurarColumna(db, 'usuarios', 'verificado', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `activo`');
    await asegurarColumna(db, 'usuarios', 'codigo_verificacion', 'VARCHAR(10) DEFAULT NULL AFTER `verificado`');
    await asegurarColumna(db, 'usuarios', 'codigo_expiracion', 'DATETIME DEFAULT NULL AFTER `codigo_verificacion`');
    await asegurarColumna(db, 'usuarios', 'datos_pendientes', 'TEXT DEFAULT NULL AFTER `codigo_expiracion`');

    await asegurarColumna(db, 'justificaciones', 'materia', 'VARCHAR(100) DEFAULT NULL AFTER `descripcion`');

    await asegurarColumna(db, 'calendario_academico', 'hora_inicio', 'TIME DEFAULT NULL AFTER `fecha_fin`');
    await asegurarColumna(db, 'calendario_academico', 'hora_fin', 'TIME DEFAULT NULL AFTER `hora_inicio`');
    await asegurarColumna(db, 'calendario_academico', 'materia', 'VARCHAR(100) DEFAULT NULL AFTER `hora_fin`');
    await asegurarColumna(db, 'calendario_academico', 'curso_id', 'INT(11) DEFAULT NULL AFTER `materia`');

    // Si el valor por defecto de `verificado` en alguna base vieja era 1, lo forzamos a 0
    try {
        await db.query('ALTER TABLE `usuarios` ALTER COLUMN `verificado` SET DEFAULT 0');
    } catch { /* ignorar si el motor no soporta ALTER COLUMN SET DEFAULT */ }

    // Cuentas sin contraseña nunca deben aparecer como verificadas
    await db.query('UPDATE `usuarios` SET `verificado` = 0 WHERE `password` IS NULL AND `verificado` <> 0');

    // Cuentas preexistentes válidas (director o cuentas de prueba sin código pendiente) quedan verificadas
    await db.query(`
        UPDATE \`usuarios\`
        SET \`verificado\` = 1
        WHERE \`password\` IS NOT NULL
          AND \`codigo_verificacion\` IS NULL
          AND \`datos_pendientes\` IS NULL
          AND \`verificado\` = 0
    `);

    // Limpiar registros a medias (donde antes se guardaba password con verificado = 0 sin haber puesto el código)
    await db.query(`
        UPDATE \`usuarios\`
        SET \`password\` = NULL,
            \`codigo_verificacion\` = NULL,
            \`codigo_expiracion\` = NULL,
            \`datos_pendientes\` = NULL
        WHERE \`verificado\` = 0
          AND \`rol\` <> 'director'
          AND \`password\` IS NOT NULL
    `);

    // 3. Notificaciones
    await db.query(`
        CREATE TABLE IF NOT EXISTS notificaciones (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT NOT NULL,
            titulo VARCHAR(150) NOT NULL,
            mensaje VARCHAR(500) DEFAULT NULL,
            enlace VARCHAR(255) DEFAULT NULL,
            leida TINYINT(1) NOT NULL DEFAULT 0,
            fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_notif_usuario (usuario_id, leida),
            CONSTRAINT fk_notif_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 4. Horarios
    await ordenarHorarios(db, { aplicar: true, log: avisos ? console.log : () => {} });

    // 5. Director único con clave
    if (!avisos) { console.log('Base de datos lista.'); return; }
    const [activos] = await db.query("SELECT id, nombre, apellido, email FROM usuarios WHERE rol = 'director' AND activo = 1");
    if (activos.length > 1) {
        console.log(`  ! Hay ${activos.length} directores activos; el sistema usa UN solo director (super administrador):`);
        activos.forEach(d => console.log(`      #${d.id} ${d.nombre} ${d.apellido} <${d.email || 'sin correo'}>`));
        console.log('    Ejecute: node crear_admin.js --forzar   (deja uno solo)');
    } else if (activos.length === 0) {
        console.log('  ! No hay director. Créelo con: node crear_admin.js');
    }
    const [dirs] = await db.query("SELECT email FROM usuarios WHERE rol = 'director' AND activo = 1 AND password IS NOT NULL AND LENGTH(password) = 60");
    if (dirs.length === 0 && activos.length > 0) {
        console.log('  ! El director no tiene una clave válida. Póngala con: node crear_admin.js');
    }
    console.log('Base de datos lista.');
}

module.exports = { prepararBaseDeDatos, respaldarJSON };
