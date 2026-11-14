// Prepara la base de datos al arrancar el servidor (no hace falta usar phpMyAdmin).
//  1. Si la base es la versión vieja, guarda un respaldo JSON en /respaldos_bd y
//     aplica migracion_2026_11.sql (una sola vez).
//  2. Crea la tabla de notificaciones si no existe.
//  3. Ordena horarios con datos reales (ver lib/horarios_orden.js).
//  4. Avisa si ningún director puede entrar.
//  5. Versión 2026-12: turno, carnet QR, fotos, escaneos, paso de año (una sola vez).
const fs = require('fs');
const path = require('path');
const { ordenarHorarios } = require('./horarios_orden');

const VERSION = '2026-11';
const VERSION_QR = '2026-12';
const VERSION_CLASES = '2026-13';

// Versión 2026-13: clases que no se dieron (profesor ausente) y suplencias
const PASOS_2026_13 = [
    `CREATE TABLE IF NOT EXISTS clases_no_dadas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        curso_id INT NOT NULL,
        materia VARCHAR(100) NOT NULL,
        fecha DATE NOT NULL,
        profesor_id INT NULL,
        motivo VARCHAR(255) NOT NULL,
        registrado_por INT NULL,
        fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_no_dada (curso_id, materia, fecha),
        KEY idx_no_dada_fecha (fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    `CREATE TABLE IF NOT EXISTS suplencias (
        id INT AUTO_INCREMENT PRIMARY KEY,
        curso_id INT NOT NULL,
        materia VARCHAR(100) NOT NULL,
        fecha DATE NOT NULL,
        profesor_titular_id INT NULL,
        profesor_suplente_id INT NOT NULL,
        registrado_por INT NULL,
        fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_suplencia (curso_id, materia, fecha),
        KEY idx_suplencia_prof (profesor_suplente_id, fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`
];

// Cambios de la versión 2026-12. Cada paso se puede repetir sin daño: si la columna o la
// tabla ya existe (por ejemplo, porque se agregó a mano en la nube), se salta.
const PASOS_2026_12 = [
    // Columnas que ya usa la verificación por correo (si faltan, se crean; los usuarios viejos quedan verificados)
    "ALTER TABLE usuarios ADD COLUMN verificado TINYINT(1) NOT NULL DEFAULT 1",
    "ALTER TABLE usuarios ADD COLUMN codigo_verificacion VARCHAR(10) NULL",
    "ALTER TABLE usuarios ADD COLUMN codigo_expiracion DATETIME NULL",
    "ALTER TABLE usuarios ADD COLUMN email_pendiente VARCHAR(100) NULL",
    // Justificar una sola materia y eventos con hora y sección (ya usados por el sistema)
    "ALTER TABLE justificaciones ADD COLUMN materia VARCHAR(100) NULL",
    "ALTER TABLE calendario_academico ADD COLUMN hora_inicio TIME NULL",
    "ALTER TABLE calendario_academico ADD COLUMN hora_fin TIME NULL",
    "ALTER TABLE calendario_academico ADD COLUMN materia VARCHAR(100) NULL",
    "ALTER TABLE calendario_academico ADD COLUMN curso_id INT NULL",
    // Turno de cada sección (Mañana / Tarde)
    "ALTER TABLE cursos ADD COLUMN turno VARCHAR(10) NULL",
    // Cómo se marcó cada asistencia: 'qr' (carnet escaneado) o 'manual'
    "ALTER TABLE asistencia ADD COLUMN metodo VARCHAR(10) NULL",
    `CREATE TABLE IF NOT EXISTS carnets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        estudiante_id INT NOT NULL,
        codigo VARCHAR(20) NOT NULL,
        anio_academico YEAR NOT NULL,
        activo TINYINT(1) NOT NULL DEFAULT 1,
        creado_por INT NULL,
        fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        fecha_anulado DATETIME NULL,
        motivo_anulado VARCHAR(100) NULL,
        UNIQUE KEY uq_carnet_codigo (codigo),
        KEY idx_carnet_estudiante (estudiante_id, activo),
        CONSTRAINT fk_carnet_estudiante FOREIGN KEY (estudiante_id) REFERENCES usuarios (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    `CREATE TABLE IF NOT EXISTS fotos_usuario (
        usuario_id INT PRIMARY KEY,
        tipo VARCHAR(30) NOT NULL,
        datos MEDIUMBLOB NOT NULL,
        actualizado_por INT NULL,
        fecha_actualizado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_foto_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    `CREATE TABLE IF NOT EXISTS escaneos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        carnet_id INT NULL,
        estudiante_id INT NULL,
        profesor_id INT NOT NULL,
        curso_id INT NOT NULL,
        materia VARCHAR(100) NOT NULL DEFAULT '',
        fecha DATE NOT NULL,
        hora TIME NOT NULL,
        resultado VARCHAR(20) NOT NULL,
        detalle VARCHAR(255) NULL,
        KEY idx_escaneo_estudiante (estudiante_id, fecha),
        KEY idx_escaneo_clase (curso_id, materia, fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    `CREATE TABLE IF NOT EXISTS promociones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        anio_origen YEAR NOT NULL,
        anio_destino YEAR NOT NULL,
        director_id INT NULL,
        fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resumen LONGTEXT NOT NULL,
        pdf MEDIUMBLOB NULL,
        pdf_nombre VARCHAR(120) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    "INSERT IGNORE INTO configuracion_sistema (clave, valor, descripcion) VALUES ('minutos_tolerancia', '10', 'Minutos después del inicio de la clase para marcar Tarde al escanear el carnet')",
    "INSERT IGNORE INTO configuracion_sistema (clave, valor, descripcion) VALUES ('clave_seguridad_director', '', 'Clave de seguridad del director (cifrada). Se pide para pasar de año.')"
];
const SALTAR = ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_TABLE_EXISTS_ERROR', 'ER_DUP_ENTRY'];

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

async function prepararBaseDeDatos(db, { avisos = true } = {}) {
    console.log('Revisando la base de datos...');

    // 1. Migración de asistencia por clase (una vez; se marca en configuracion_sistema)
    const [ver] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'version_bd'");
    if (!ver[0] || ver[0].valor < VERSION) {
        const archivo = await respaldarJSON(db, 'Antes de migracion_2026_11.sql');
        console.log(`  · Respaldo guardado en ${archivo}`);
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

    // 1b. Versión 2026-12 (turno, carnet QR, fotos, escaneos, paso de año)
    const [ver2] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'version_bd'");
    if (!ver2[0] || ver2[0].valor < VERSION_QR) {
        try {
            const archivo = await respaldarJSON(db, 'Antes de la versión 2026-12');
            console.log(`  · Respaldo guardado en ${archivo}`);
        } catch (e) {
            console.log(`  ! No se pudo guardar el respaldo en disco (${e.message}). Se sigue: todos los pasos solo agregan.`);
        }
        let hechos = 0;
        for (const sql of PASOS_2026_12) {
            try {
                await db.query(sql);
                hechos++;
            } catch (err) {
                if (SALTAR.includes(err.code)) continue;
                throw new Error(`Falló un paso de la versión 2026-12: ${err.message}\nSQL: ${sql.slice(0, 200)}`);
            }
        }
        await db.query(
            "INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES ('version_bd', ?, 'Versión de la base de datos (no editar)') ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
            [VERSION_QR]
        );
        console.log(`  · Versión 2026-12 aplicada (${hechos} cambios nuevos): turno, carnet QR, fotos y paso de año.`);
    }

    // 1c. Versión 2026-13 (clase no dada y suplencias): solo crea tablas nuevas
    const [ver3] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'version_bd'");
    if (!ver3[0] || ver3[0].valor < VERSION_CLASES) {
        for (const sql of PASOS_2026_13) await db.query(sql);
        await db.query(
            "INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES ('version_bd', ?, 'Versión de la base de datos (no editar)') ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
            [VERSION_CLASES]
        );
        console.log('  · Versión 2026-13 aplicada: clase no dada y suplencias.');
    }

    // 2. Notificaciones
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

    // 3. Horarios
    await ordenarHorarios(db, { aplicar: true, log: avisos ? console.log : () => {} });

    // 4. Director único con clave
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
