// Uso (en la carpeta del sistema):
//   node cambiar_clave.js <correo> <clave nueva>
// Sirve para poner o recuperar la clave de cualquier usuario, por ejemplo
// la del director, que no puede crearse desde "Regístrese aquí".
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { revisarDatos } = require('./lib/filtro_groserias');

(async () => {
    const [email, clave] = process.argv.slice(2);
    if (!email || !clave) {
        console.log('Uso: node cambiar_clave.js <correo> <clave nueva>');
        process.exit(1);
    }
    if (clave.length < 6) {
        console.log('La clave debe tener al menos 6 caracteres.');
        process.exit(1);
    }
    try {
        const malo = await revisarDatos(db, { password: clave });
        if (malo) { console.log(malo.mensaje); process.exit(1); }
        const [r] = await db.query('UPDATE usuarios SET password = ?, verificado = 1 WHERE email = ?', [await bcrypt.hash(clave, 10), email]);
        console.log(r.affectedRows ? `Listo: clave cambiada para ${email}` : `No existe ningún usuario con el correo ${email}`);
    } catch (err) {
        console.error('Error:', err.message);
    }
    process.exit(0);
})();
