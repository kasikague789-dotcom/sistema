// Zona horaria de la institución (puede cambiarse con TZ en .env)
process.env.TZ = process.env.TZ || 'America/Caracas';

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const db = require('./db');
const { requiereSesion, soloRoles } = require('./lib/auth');
const { prepararBaseDeDatos } = require('./lib/migraciones');
const { filtroGroserias } = require('./lib/filtro_groserias');

// Importar Rutas
const calendarioRoutes = require('./routes/calendario');
const asignacionesRoutes = require('./routes/asignaciones');
const profesoresRoutes = require('./routes/profesores');
const seccionesRoutes = require('./routes/secciones');
const estudiantesRoutes = require('./routes/estudiantes');
const estudianteCursoRoutes = require('./routes/estudiante_curso');
const usuariosRoutes = require('./routes/usuarios');
const horariosRoutes = require('./routes/horarios');
const justificacionesRoutes = require('./routes/justificaciones');
const asistenciaRoutes = require('./routes/asistencia');
const dashboardRoutes = require('./routes/dashboard');
const estudianteDashboardRoutes = require('./routes/estudiante');
const configuracionRoutes = require('./routes/configuracion');
const authRoutes = require('./routes/auth');
const notificacionesRoutes = require('./routes/notificaciones');
const carnetsRoutes = require('./routes/carnets');
const promocionRoutes = require('./routes/promocion');
const clasesRoutes = require('./routes/clases');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// 8 MB para permitir adjuntar constancias (PDF o imagen) en las justificaciones
app.use(express.json({ limit: '8mb' }));

// Prueba en la red local (HTTPS_PUERTO lo pone PROBAR_EN_MI_PC.bat): el teléfono pasa solo a https
// para tener cámara en vivo. En Clever Cloud no existe esa variable y esto no se usa.
if (process.env.HTTPS_PUERTO) app.use(require('./lib/https_local').redirigir());

// Servir SOLO las carpetas públicas (antes se servía toda la carpeta,
// incluido el respaldo .sql de la base de datos y el código del servidor)
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/interfaces',
    (req, res, next) => (req.path.endsWith('.php') ? res.sendStatus(404) : next()),
    express.static(path.join(__dirname, 'interfaces')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/index2.html', (req, res) => res.sendFile(path.join(__dirname, 'index2.html')));

// Redirigir la raíz (y el viejo index.html) directamente al Login
app.get(['/', '/index.html'], (req, res) => {
    res.redirect('/login.html');
});

app.get('/api/health', async (req, res) => {
    try {
        const [result] = await db.query('SELECT 1 + 1 AS test');
        res.json({ estado: 'exitoso', mensaje: 'Servidor Node.js y MySQL conectados correctamente', test: result[0].test });
    } catch (error) {
        res.status(500).json({ estado: 'error', mensaje: 'Error de conexión a la base de datos', error: error.message });
    }
});

// Prueba en la red local: puerto https para la cámara en vivo del teléfono (solo si HTTPS_PUERTO existe).
// En Clever Cloud no existe esa variable: responde null y no se abre nada.
app.get('/api/https-local', (req, res) => {
    res.json({ puerto: process.env.HTTPS_PUERTO ? (require('./lib/https_local').puertoActivo() || null) : null });
});

// Todo /api exige sesión (menos login, registro y health)
app.use('/api', requiereSesion(db));

// Filtro de groserías en todo texto que se guarda (incluye el registro público)
app.use('/api', filtroGroserias(db));

// Rutas de la API (los permisos finos están dentro de cada archivo de rutas)
app.use('/api/auth', authRoutes);
app.use('/api/calendario', calendarioRoutes);
app.use('/api/configuracion', configuracionRoutes);
app.use('/api/profesores', profesoresRoutes);
app.use('/api/estudiantes', estudiantesRoutes);
app.use('/api/estudiante', estudianteDashboardRoutes);
app.use('/api/justificaciones', justificacionesRoutes);
app.use('/api/asistencia', asistenciaRoutes);
app.use('/api/notificaciones', notificacionesRoutes);
app.use('/api/carnets', carnetsRoutes);
app.use('/api/clases', clasesRoutes); // permisos dentro (director; mis-suplencias: profesor)

// Rutas solo para el director
app.use('/api/asignaciones', soloRoles('director'), asignacionesRoutes);
app.use('/api/secciones', soloRoles('director'), seccionesRoutes);
app.use('/api/estudiante-curso', soloRoles('director'), estudianteCursoRoutes);
app.use('/api/usuarios', soloRoles('director'), usuariosRoutes);
app.use('/api/horarios', soloRoles('director'), horariosRoutes);
app.use('/api/dashboard', soloRoles('director'), dashboardRoutes);
app.use('/api/promocion', soloRoles('director'), promocionRoutes);

app.use('/api', (req, res) => res.status(404).json({ estado: 'error', mensaje: 'Ruta no encontrada' }));

// Primero se prepara la base de datos; luego se abre el servidor
prepararBaseDeDatos(db)
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Servidor corriendo en http://localhost:${PORT}`);
        });
        if (process.env.HTTPS_PUERTO) require('./lib/https_local').iniciar(app, Number(process.env.HTTPS_PUERTO));
    })
    .catch(err => {
        console.error('ERROR: No se pudo preparar la base de datos:', err.message);
        console.error('   Revise que MySQL esté encendido y los datos de .env. Su respaldo está en la carpeta respaldos_bd.');
        process.exit(1);
    });
