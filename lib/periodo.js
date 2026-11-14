// Año escolar (periodo) en curso. El periodo 2026 es "2026-2027".
// Lo fija el paso de año (configuracion_sistema.anio_escolar_actual). Si aún no existe,
// se toma de las secciones y asignaciones activas.
async function anioEscolarActual(db) {
    const [[c]] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'anio_escolar_actual'");
    if (c && /^\d{4}$/.test(String(c.valor).trim())) return Number(c.valor);
    const [[m]] = await db.query('SELECT MAX(anio_academico) AS a FROM estudiante_curso WHERE activo = 1');
    if (m && m.a) return Number(m.a);
    const [[k]] = await db.query('SELECT MAX(anio_escolar) AS a FROM cursos WHERE activo = 1');
    if (k && k.a) return Number(k.a);
    const hoy = new Date();
    return hoy.getMonth() >= 8 ? hoy.getFullYear() : hoy.getFullYear() - 1; // el año escolar empieza en septiembre
}

const textoPeriodo = (anio) => `${anio}-${Number(anio) + 1}`;

module.exports = { anioEscolarActual, textoPeriodo };
