require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: (process.env.MYSQL_ADDON_HOST || process.env.DB_HOST || 'localhost').trim(),
    user: (process.env.MYSQL_ADDON_USER || process.env.DB_USER || 'root').trim(),
    password: process.env.MYSQL_ADDON_PASSWORD !== undefined
        ? process.env.MYSQL_ADDON_PASSWORD
        : (process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : ''),
    database: (process.env.MYSQL_ADDON_DB || process.env.DB_NAME || 'sistema_asistencia').trim(),
    port: Number(process.env.MYSQL_ADDON_PORT || process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

module.exports = pool;
