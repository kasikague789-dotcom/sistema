// Revisa los horarios con los datos REALES de la base (no inventa horas).
//   node arreglar_horarios.js            -> muestra lo que encontró (no cambia nada)
//   node arreglar_horarios.js --aplicar  -> además completa asignaciones y desactiva bloques imposibles
// El servidor hace lo mismo solo cada vez que arranca.
// Los choques (mismo profesor o sección a la misma hora) NO se mueven solos:
// la hora correcta solo la sabe el director. Corríjalos en Director > Horarios.
require('dotenv').config();
const db = require('./db');
const { ordenarHorarios } = require('./lib/horarios_orden');

(async () => {
    const aplicar = process.argv.includes('--aplicar');
    console.log(aplicar ? '== Aplicando ==' : '== Vista previa (agregue --aplicar para guardar) ==');
    const r = await ordenarHorarios(db, { aplicar });
    if (r.cambios.length === 0 && r.choques.length === 0 && r.sinHorario.length === 0) console.log('  Todo en orden.');
    process.exit(0);
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
