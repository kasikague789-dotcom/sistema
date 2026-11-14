// Para las herramientas de consola: lo que se muestra en pantalla también queda escrito en
// respaldos_bd/herramientas.log, por si después hay que revisar qué pasó.
const fs = require('fs');
const path = require('path');

const ARCHIVO = path.join(__dirname, '..', 'respaldos_bd', 'herramientas.log');

function crearRegistro(nombre) {
    const escribir = (texto) => {
        try {
            fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
            const sello = new Date().toLocaleString('es-VE');
            fs.appendFileSync(ARCHIVO, String(texto).split('\n').map(l => `[${sello}] ${nombre}: ${l}`).join('\n') + '\n');
        } catch { /* sin disco: solo en pantalla */ }
    };
    const log = (...partes) => { const t = partes.join(' '); console.log(t); escribir(t); };
    log.solo = escribir; // solo al archivo (por ejemplo, lo que la persona escribió)
    return log;
}

module.exports = { crearRegistro };
