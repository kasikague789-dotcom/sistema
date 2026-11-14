// Lector de QR con la cámara (celular o computadora).
// Usa el lector del navegador (BarcodeDetector) si existe; si no, jsQR (js/vendor/jsQR.js, se carga solo cuando hace falta).
// La cámara EN VIVO del navegador solo funciona con https o en localhost.
// Sin https (por ejemplo la prueba en el teléfono por el Wi-Fi) se puede TOMAR UNA FOTO del carnet:
// EscanerQR.leerImagen(archivo) busca el QR dentro de la foto.
(function () {
    let jsQRCargado = null;
    function cargarJsQR() {
        if (window.jsQR) return Promise.resolve();
        if (jsQRCargado) return jsQRCargado;
        jsQRCargado = new Promise((ok, mal) => {
            const s = document.createElement('script');
            s.src = '/js/vendor/jsQR.js';
            s.onload = ok;
            s.onerror = () => mal(new Error('No se pudo cargar el lector de QR.'));
            document.head.appendChild(s);
        });
        return jsQRCargado;
    }

    // Texto del QR. Si el QR no viene en UTF-8 (por ejemplo, un carnet hecho en otro programa),
    // jsQR deja "data" vacío: se lee de los bytes (basta para encontrar el código IEB-...).
    function textoDe(r) {
        if (!r) return null;
        if (r.data) return r.data;
        if (r.binaryData && r.binaryData.length) {
            const bytes = new Uint8Array(r.binaryData);
            try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* no es UTF-8 */ }
            try { return new TextDecoder('iso-8859-1').decode(bytes); } catch { /* sin TextDecoder */ }
            return String.fromCharCode.apply(null, Array.from(bytes));
        }
        return null;
    }

    class EscanerQR {
        // video: <video>; alLeer(texto) se llama con cada QR leído (el mismo texto no se repite antes de 3 s)
        constructor(video, alLeer) {
            this.video = video;
            this.alLeer = alLeer;
            this.stream = null;
            this.activo = false;
            this.ultimo = { texto: '', hora: 0 };
            this.canvas = document.createElement('canvas');
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
            this.camaras = [];
            this.indiceCamara = -1;
        }

        // Lee el QR de una foto (input type=file con capture). Devuelve el texto o null.
        // Las fotos del teléfono son grandes (4000 px) y el carnet puede salir chico, girado o borroso:
        // se prueba la foto entera en varios tamaños y también recortes del centro (donde se apunta).
        static async leerImagen(archivo) {
            let imagen;
            try {
                imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
            } catch {
                imagen = await new Promise((ok, mal) => {
                    const img = new Image();
                    img.onload = () => ok(img);
                    img.onerror = () => mal(new Error('No se pudo abrir la foto. Tómela de nuevo con la cámara.'));
                    img.src = URL.createObjectURL(archivo);
                });
            }
            const ancho = imagen.width || imagen.naturalWidth, alto = imagen.height || imagen.naturalHeight;
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            // Dibuja un recorte centrado (fraccion 1 = foto entera) con el lado mayor <= maximo
            const dibujar = (fraccion, maximo) => {
                const sw = Math.round(ancho * fraccion), sh = Math.round(alto * fraccion);
                const sx = Math.round((ancho - sw) / 2), sy = Math.round((alto - sh) / 2);
                const k = Math.min(1, maximo / Math.max(sw, sh));
                const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
                canvas.width = w; canvas.height = h;
                ctx.drawImage(imagen, sx, sy, sw, sh, 0, 0, w, h);
                return { w, h };
            };

            if ('BarcodeDetector' in window) {
                try {
                    const d = new window.BarcodeDetector({ formats: ['qr_code'] });
                    let r = await d.detect(imagen);
                    if (r && r[0]) return r[0].rawValue;
                    for (const [fr, max] of [[1, 1600], [0.5, 1600]]) {
                        dibujar(fr, max);
                        r = await d.detect(canvas);
                        if (r && r[0]) return r[0].rawValue;
                    }
                } catch { /* se prueba con jsQR */ }
            }
            await cargarJsQR();
            const intentos = [[1, 1200], [0.5, 1600], [1, 1800], [0.33, 1600], [0.7, 1800], [1, 800], [1, 2600]];
            for (const [fr, max] of intentos) {
                const { w, h } = dibujar(fr, max);
                const t = textoDe(window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' }));
                if (t) return t;
                await new Promise(r => setTimeout(r, 0)); // deja respirar la pantalla
            }
            return null;
        }

        static motivoNoDisponible() {
            if (!window.isSecureContext) return 'Por esta dirección (http) el navegador no deja la cámara en vivo. Use "Tomar foto del carnet": abre la cámara y lee el QR de la foto.';
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'Este navegador no permite usar la cámara. Puede usar un lector USB o escribir el código.';
            return null;
        }

        async iniciar(deviceId) {
            const motivo = EscanerQR.motivoNoDisponible();
            if (motivo) throw new Error(motivo);
            this.detener();
            const video = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } };
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({ video: { ...video, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
            } catch (err) {
                if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw new Error('No se dio permiso para usar la cámara. Actívelo en el candado de la barra de direcciones.');
                if (err && err.name === 'NotFoundError') throw new Error('No se encontró ninguna cámara en este equipo.');
                throw new Error('No se pudo abrir la cámara.');
            }
            // Enfoque automático continuo (como la cámara del teléfono) y linterna si la hay
            this.pista = this.stream.getVideoTracks()[0];
            this.tieneLinterna = false;
            this.linterna = false;
            try {
                const cap = this.pista.getCapabilities ? this.pista.getCapabilities() : {};
                if (cap.focusMode && cap.focusMode.includes('continuous')) await this.pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
                this.tieneLinterna = !!cap.torch;
            } catch { /* la cámara no lo permite */ }
            this.video.srcObject = this.stream;
            this.video.setAttribute('playsinline', '');
            this.video.muted = true;
            await this.video.play().catch(() => {});
            try {
                this.camaras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
                const actual = this.stream.getVideoTracks()[0].getSettings().deviceId;
                this.indiceCamara = this.camaras.findIndex(c => c.deviceId === actual);
            } catch { /* sin lista de cámaras */ }

            this.detector = null;
            if ('BarcodeDetector' in window) {
                try {
                    const formatos = await window.BarcodeDetector.getSupportedFormats();
                    if (formatos.includes('qr_code')) this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
                } catch { this.detector = null; }
            }
            if (!this.detector) await cargarJsQR();
            this.activo = true;
            this.bucle();
        }

        // Prende o apaga la linterna del teléfono (si tiene). Devuelve el estado nuevo.
        async cambiarLinterna() {
            if (!this.pista || !this.tieneLinterna) return false;
            const nuevo = !this.linterna;
            try { await this.pista.applyConstraints({ advanced: [{ torch: nuevo }] }); this.linterna = nuevo; } catch { /* no se pudo */ }
            return this.linterna;
        }

        async cambiarCamara() {
            if (this.camaras.length < 2) return false;
            const sig = this.camaras[(this.indiceCamara + 1) % this.camaras.length];
            await this.iniciar(sig.deviceId);
            return true;
        }

        detener() {
            this.activo = false;
            if (this.timer) clearTimeout(this.timer);
            if (this.stream) this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
            if (this.video) this.video.srcObject = null;
        }

        async leerCuadro() {
            const v = this.video;
            if (!v.videoWidth) return null;
            if (this.detector) {
                const r = await this.detector.detect(v);
                return r && r[0] ? r[0].rawValue : null;
            }
            // Sin lector del navegador: un cuadro entero y luego el centro (donde está el marco) más grande
            this.vuelta = (this.vuelta || 0) + 1;
            const vw = v.videoWidth, vh = v.videoHeight;
            let sx = 0, sy = 0, sw = vw, sh = vh;
            if (this.vuelta % 2 === 0) {
                const lado = Math.round(Math.min(vw, vh) * 0.75);
                sx = Math.round((vw - lado) / 2); sy = Math.round((vh - lado) / 2); sw = sh = lado;
            }
            const escala = Math.min(1, 800 / Math.max(sw, sh));
            const w = Math.round(sw * escala), h = Math.round(sh * escala);
            this.canvas.width = w; this.canvas.height = h;
            this.ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
            const img = this.ctx.getImageData(0, 0, w, h);
            return textoDe(window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' }));
        }

        bucle() {
            if (!this.activo) return;
            this.leerCuadro().then(texto => {
                if (texto) {
                    const ahora = Date.now();
                    if (texto !== this.ultimo.texto || ahora - this.ultimo.hora > 3000) {
                        this.ultimo = { texto, hora: ahora };
                        this.alLeer(texto);
                    }
                }
            }).catch(() => {}).finally(() => {
                if (this.activo) this.timer = setTimeout(() => this.bucle(), this.detector ? 100 : 120);
            });
        }
    }

    // Sonido corto: agudo = bien, grave = problema
    let audio = null;
    function pitido(bien) {
        try {
            audio = audio || new (window.AudioContext || window.webkitAudioContext)();
            const o = audio.createOscillator(), g = audio.createGain();
            o.frequency.value = bien ? 1046 : 220;
            g.gain.setValueAtTime(0.15, audio.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + (bien ? 0.15 : 0.35));
            o.connect(g); g.connect(audio.destination);
            o.start(); o.stop(audio.currentTime + (bien ? 0.15 : 0.35));
        } catch { /* sin sonido */ }
        if (navigator.vibrate) navigator.vibrate(bien ? 60 : [80, 60, 80]);
    }

    window.EscanerQR = EscanerQR;
    window.pitidoEscaner = pitido;
})();
