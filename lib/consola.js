// Preguntas en la consola para las herramientas (deshacer_cierre.js, limpiar_bd.js, recuperar_acceso.js).
// Lee las respuestas una por una, también si vienen todas juntas.
const readline = require('readline');

function lectorConsola() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    const cola = [], esperando = [];
    let cerrado = false;
    rl.on('line', (l) => { const w = esperando.shift(); if (w) w(l); else cola.push(l); });
    rl.on('close', () => { cerrado = true; while (esperando.length) esperando.shift()(''); });
    return {
        preguntar(texto) {
            process.stdout.write(texto);
            if (cola.length) return Promise.resolve(cola.shift());
            if (cerrado) return Promise.resolve('');
            return new Promise((r) => esperando.push(r));
        },
        close() { rl.close(); }
    };
}

module.exports = { lectorConsola };
