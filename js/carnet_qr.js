// Dibujar el QR del carnet (usa js/vendor/qrcode.js) y manejar la foto del estudiante.
(function () {
    if (window.qrcode && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
        qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']; // acentos y ñ en el texto del QR
    }

    // Dibuja el QR en un <canvas> de "px" de lado, con margen blanco (4 módulos, lo pide la norma)
    function dibujarQR(canvas, texto, px = 240) {
        const qr = qrcode(0, 'M');
        qr.addData(texto, 'Byte');
        qr.make();
        const n = qr.getModuleCount();
        const total = n + 8;
        const tam = Math.max(1, Math.floor(px / total));
        canvas.width = canvas.height = tam * total;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000000';
        for (let f = 0; f < n; f++) {
            for (let c = 0; c < n; c++) {
                if (qr.isDark(f, c)) ctx.fillRect((c + 4) * tam, (f + 4) * tam, tam, tam);
            }
        }
        return canvas;
    }

    function qrPNG(texto, px = 600) {
        const canvas = dibujarQR(document.createElement('canvas'), texto, px);
        return new Promise(ok => canvas.toBlob(b => ok(b), 'image/png'));
    }

    // Achica la foto en el navegador (máximo 480 px, JPG) antes de subirla
    function prepararFoto(archivo, max = 480) {
        return new Promise((ok, mal) => {
            if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) return mal(new Error('La foto debe ser JPG, PNG o WEBP.'));
            if (archivo.size > 15 * 1024 * 1024) return mal(new Error('La foto pesa demasiado (más de 15 MB).'));
            const url = URL.createObjectURL(archivo);
            const img = new Image();
            img.onload = () => {
                const escala = Math.min(1, max / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * escala);
                c.height = Math.round(img.height * escala);
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                ok(c.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la imagen.')); };
            img.src = url;
        });
    }

    async function cargarFoto(idEstudiante, imgEl) {
        const r = await fetch(`/api/carnets/foto/${idEstudiante}`);
        if (!r.ok) return false;
        imgEl.src = URL.createObjectURL(await r.blob());
        return true;
    }

    window.CarnetQR = { dibujarQR, qrPNG, prepararFoto, cargarFoto };
})();
