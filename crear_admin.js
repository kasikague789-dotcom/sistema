// Crea (o actualiza) el ÚNICO director del sistema: el super administrador.
//
//   node crear_admin.js                 -> usa los datos de abajo
//   node crear_admin.js --clave=OtraClave123 --correo=otro@correo.com --cedula=12345678
//   node crear_admin.js --forzar        -> si hay varios directores, deja solo uno
//
// Si ya existe un director, se actualiza esa misma cuenta (no se pierde su historial).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { prepararBaseDeDatos } = require('./lib/migraciones');
const { normalizarCedula, esEmailValido } = require('./lib/util');
const { revisarDatos } = require('./lib/filtro_groserias');

const arg = (nombre, defecto) => {
    const a = process.argv.find(x => x.startsWith(`--${nombre}=`));
    return a ? a.slice(nombre.length + 3) : defecto;
};

const ADMIN = {
    nombre: arg('nombre', 'Super'),
    apellido: arg('apellido', 'Administrador'),
    email: arg('correo', 'admin@elenadebueno.local'),
    cedula: normalizarCedula(arg('cedula', '10000000')),
    clave: arg('clave', 'Admin-KDuvr286')
};

(async () => {
    if (!ADMIN.cedula) throw new Error('La cédula debe tener solo números (5 a 10 dígitos).');
    if (!esEmailValido(ADMIN.email)) throw new Error('El correo no es válido.');
    if (ADMIN.clave.length < 6) throw new Error('La clave debe tener al menos 6 caracteres.');

    await prepararBaseDeDatos(db, { avisos: false });
    const malo = await revisarDatos(db, { nombre: ADMIN.nombre, apellido: ADMIN.apellido, email: ADMIN.email, password: ADMIN.clave });
    if (malo) throw new Error(malo.mensaje);

    const [directores] = await db.query("SELECT id, nombre, apellido, email, activo FROM usuarios WHERE rol = 'director' ORDER BY activo DESC, id ASC");
    if (directores.length > 1 && !process.argv.includes('--forzar')) {
        console.log('Hay más de un director:');
        directores.forEach(d => console.log(`  #${d.id} ${d.nombre} ${d.apellido} <${d.email || 'sin correo'}>${d.activo ? '' : ' (inactivo)'}`));
        console.log('Ejecute "node crear_admin.js --forzar" para dejar solo el primero como super administrador (los demás quedan desactivados).');
        process.exit(1);
    }

    const idActual = directores[0] ? directores[0].id : 0;
    const [choque] = await db.query('SELECT id, rol FROM usuarios WHERE (email = ? OR cedula = ?) AND id <> ?', [ADMIN.email, ADMIN.cedula, idActual]);
    if (choque.length > 0) {
        throw new Error(`El correo o la cédula ya los usa otra persona (usuario #${choque[0].id}, ${choque[0].rol}). Use --correo= y --cedula= distintos.`);
    }

    const hash = await bcrypt.hash(ADMIN.clave, 10);
    if (idActual) {
        await db.query(
            'UPDATE usuarios SET nombre = ?, apellido = ?, email = ?, cedula = ?, password = ?, activo = 1, verificado = 1 WHERE id = ?',
            [ADMIN.nombre, ADMIN.apellido, ADMIN.email, ADMIN.cedula, hash, idActual]
        );
        if (directores.length > 1) {
            await db.query("UPDATE usuarios SET activo = 0 WHERE rol = 'director' AND id <> ?", [idActual]);
            console.log(`Se desactivaron ${directores.length - 1} director(es) extra.`);
        }
        console.log(`Super administrador actualizado (usuario #${idActual}).`);
    } else {
        const [r] = await db.query(
            "INSERT INTO usuarios (cedula, nombre, apellido, email, telefono, rol, password, activo, verificado) VALUES (?, ?, ?, ?, '', 'director', ?, 1, 1)",
            [ADMIN.cedula, ADMIN.nombre, ADMIN.apellido, ADMIN.email, hash]
        );
        console.log(`Super administrador creado (usuario #${r.insertId}).`);
    }

    console.log('\nEntrar con:');
    console.log(`  correo  ${ADMIN.email}`);
    console.log(`  cédula  ${ADMIN.cedula}`);
    console.log(`  clave   ${ADMIN.clave}`);
    console.log('\nCambie la clave cuando el sistema pase a uso real (Usuarios > Editar > Restablecer contraseña).');
    process.exit(0);
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
