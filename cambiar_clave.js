// Uso (en la carpeta del sistema):
//   node cambiar_clave.js <correo_o_cedula> <clave nueva>
// Sirve para poner o recuperar la clave de cualquier usuario, por ejemplo
// la del director, que no puede crearse desde "Regístrese aquí".
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { prepararBaseDeDatos } = require('./lib/migraciones');
const { normalizarCedula } = require('./lib/util');
const { revisarDatos } = require('./lib/filtro_groserias');

(async () => {
    const [identificador, clave] = process.argv.slice(2);
    if (!identificador || !clave) {
        console.log('Uso: node cambiar_clave.js <correo o cédula> <clave nueva>');
        process.exit(1);
    }
    if (clave.length < 6) {
        console.log('La clave debe tener al menos 6 caracteres.');
        process.exit(1);
    }
    try {
        await prepararBaseDeDatos(db, { avisos: false });
        const malo = await revisarDatos(db, { password: clave });
        if (malo) { console.log(malo.mensaje); process.exit(1); }
        const cedula = normalizarCedula(identificador);
        const hash = await bcrypt.hash(clave, 10);
        const [r] = await db.query(
            'UPDATE usuarios SET password = ?, verificado = 1, codigo_verificacion = NULL, codigo_expiracion = NULL, datos_pendientes = NULL WHERE LOWER(email) = LOWER(?) OR cedula = ? OR (? IS NOT NULL AND cedula = ?)',
            [hash, identificador.trim(), identificador.trim(), cedula, cedula]
        );
        console.log(r.affectedRows ? `Listo: clave cambiada y cuenta activada para ${identificador}` : `No existe ningún usuario con el correo o cédula ${identificador}`);
    } catch (err) {
        console.error('Error:', err.message);
    }
    process.exit(0);
})();
