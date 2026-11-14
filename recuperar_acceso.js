// Recuperar el acceso del director cuando el correo no llega (o no está configurado).
//
// Uso (en la carpeta del sistema):
//   node recuperar_acceso.js                           menú: contraseña nueva del director o quitar la clave de seguridad
//   node recuperar_acceso.js --clave=NuevaClave        pone esa contraseña al director (mínimo 6)
//   node recuperar_acceso.js --quitar-clave-seguridad  borra la clave de seguridad (el director crea otra en Configuración)
//
// Quien puede correr esto ya maneja el servidor y la base de datos; por eso no pide la clave anterior.
// Lo que muestra queda también en respaldos_bd/herramientas.log (sin las claves).
require('dotenv').config({ quiet: true });
process.env.TZ = process.env.TZ || 'America/Caracas';
const bcrypt = require('bcryptjs');
const db = require('./db');
const { revisarDatos } = require('./lib/filtro_groserias');
const { crearRegistro } = require('./lib/registro');
const { lectorConsola } = require('./lib/consola');

const log = crearRegistro('recuperar_acceso');

async function director() {
    const [filas] = await db.query("SELECT id, cedula, nombre, apellido, email FROM usuarios WHERE rol = 'director' ORDER BY id");
    if (filas.length === 0) { log('No hay ningún director. Use: node crear_admin.js'); return null; }
    if (filas.length > 1) log(`Ojo: hay ${filas.length} directores; se usa el primero. Para dejar uno solo: node crear_admin.js --forzar`);
    return filas[0];
}

async function ponerClave(dir, clave) {
    if (String(clave).length < 6) { log('La contraseña debe tener al menos 6 caracteres. No se cambió nada.'); return false; }
    const malo = await revisarDatos(db, { password: clave });
    if (malo) { log(malo.mensaje + ' No se cambió nada.'); return false; }
    await db.query('UPDATE usuarios SET password = ?, verificado = 1, activo = 1 WHERE id = ?', [await bcrypt.hash(String(clave), 10), dir.id]);
    log(`Listo: contraseña nueva para ${dir.nombre} ${dir.apellido} (cédula ${dir.cedula}). Entre con su cédula o su correo.`);
    return true;
}

async function quitarClaveSeguridad() {
    const [r] = await db.query("DELETE FROM configuracion_sistema WHERE clave = 'clave_seguridad_director'");
    log(r.affectedRows
        ? 'Listo: se quitó la clave de seguridad. Entre como director a Configuración > Clave de seguridad y cree una nueva.'
        : 'No había clave de seguridad guardada. Créela en Configuración > Clave de seguridad.');
    return true;
}

async function principal() {
    const dir = await director();
    if (!dir) return false;
    const arg = process.argv.find(a => a.startsWith('--clave='));
    if (arg) return ponerClave(dir, arg.slice('--clave='.length));
    if (process.argv.includes('--quitar-clave-seguridad')) return quitarClaveSeguridad();

    const consola = lectorConsola();
    try {
        log('');
        log(`Director: ${dir.nombre} ${dir.apellido} · cédula ${dir.cedula}${dir.email ? ' · ' + dir.email : ''}`);
        log('  1) Poner una contraseña nueva al director (la de iniciar sesión)');
        log('  2) Quitar la clave de seguridad (la de pasar de año); después se crea otra en Configuración');
        log('  3) Salir sin cambiar nada');
        const op = String(await consola.preguntar('Escriba 1, 2 o 3 y presione Enter: ')).trim();
        log.solo('Opción: ' + op);
        if (op === '1') {
            const a = String(await consola.preguntar('Contraseña nueva (mínimo 6): '));
            const b = String(await consola.preguntar('Repita la contraseña nueva: '));
            if (a !== b) { log('Las dos contraseñas no coinciden. No se cambió nada.'); return false; }
            return ponerClave(dir, a);
        }
        if (op === '2') {
            const s = String(await consola.preguntar('Para quitarla escriba QUITAR y presione Enter: ')).trim().toUpperCase();
            if (s !== 'QUITAR') { log('No se cambió nada.'); return false; }
            return quitarClaveSeguridad();
        }
        log('No se cambió nada.');
        return false;
    } finally {
        consola.close();
    }
}

if (require.main === module) {
    principal()
        .then((ok) => { process.exitCode = ok ? 0 : 1; })
        .catch((err) => { log('Error: ' + (err.message || err)); process.exitCode = 1; })
        .finally(() => db.end().catch(() => {}));
}
