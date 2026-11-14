// Bloque "Carnet y código QR" en Usuarios > Editar (solo estudiantes)
(function () {
    let actual = null; // datos del carnet mostrado

    const $ = (id) => document.getElementById(id);
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

    function pintar(d) {
        actual = d;
        $('bloque-carnet').style.display = 'block';
        window.CarnetQR.dibujarQR($('carnet-qr'), d.qr_texto, 220);
        $('carnet-codigo').textContent = d.codigo;
        const sec = d.curso ? `${d.curso.nombre} ${d.curso.seccion}` : 'Sin sección asignada';
        $('carnet-datos').innerHTML = `
            <dt>Nombre</dt><dd>${esc(d.estudiante.nombre)} ${esc(d.estudiante.apellido)}</dd>
            <dt>Cédula</dt><dd>${esc(d.estudiante.cedula)}</dd>
            <dt>Sección</dt><dd>${esc(sec)}</dd>
            <dt>Turno</dt><dd>${esc(d.curso && d.curso.turno ? d.curso.turno : 'Sin definir')}</dd>
            <dt>Periodo</dt><dd>${esc(d.periodo)}</dd>`;
        const foto = $('carnet-foto');
        foto.innerHTML = "<i class='bx bx-user' aria-hidden='true'></i>";
        $('btn-quitar-foto').style.display = 'none';
        if (d.tiene_foto) {
            const img = document.createElement('img');
            img.alt = `Foto de ${d.estudiante.nombre} ${d.estudiante.apellido}`;
            window.CarnetQR.cargarFoto(d.estudiante.id, img).then(ok => {
                if (ok) { foto.innerHTML = ''; foto.appendChild(img); $('btn-quitar-foto').style.display = ''; }
            });
        }
    }

    async function mostrarCarnet(id) {
        try {
            const r = await fetch(`/api/carnets/estudiante/${id}`);
            const d = await r.json();
            if (!r.ok) throw new Error(d.mensaje);
            pintar(d.datos);
        } catch (err) {
            $('bloque-carnet').style.display = 'block';
            $('carnet-codigo').textContent = 'No se pudo cargar el carnet.';
        }
    }

    function nombreBase() {
        const d = actual;
        return window.Exportar ? window.Exportar.nombreArchivo(`QR_${d.estudiante.apellido}_${d.estudiante.nombre}_${d.estudiante.cedula}`)
            : `QR_${d.estudiante.cedula}`;
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!$('bloque-carnet')) return;

        $('input-foto').addEventListener('change', async (e) => {
            const archivo = e.target.files[0];
            e.target.value = '';
            if (!archivo || !actual) return;
            try {
                const dataUrl = await window.CarnetQR.prepararFoto(archivo);
                const r = await fetch(`/api/carnets/foto/${actual.estudiante.id}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tipo: 'image/jpeg', base64: dataUrl.split(',')[1] })
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(d.mensaje || 'No se pudo guardar la foto.');
                actual.tiene_foto = true;
                pintar(actual);
            } catch (err) {
                avisar(err.message, { tipo: 'error', titulo: 'No se pudo cambiar la foto' });
            }
        });

        $('btn-quitar-foto').addEventListener('click', async () => {
            if (!actual) return;
            if (!(await confirmar('El carnet quedará sin foto. Puede subir otra cuando quiera.', { titulo: '¿Quitar la foto?', aceptar: 'Quitar foto', peligro: true }))) return;
            const r = await fetch(`/api/carnets/foto/${actual.estudiante.id}`, { method: 'DELETE' });
            if (r.ok) { actual.tiene_foto = false; pintar(actual); }
            else avisar('Intente de nuevo en un momento.', { tipo: 'error', titulo: 'No se pudo quitar la foto' });
        });

        $('btn-qr-png').addEventListener('click', async () => {
            if (!actual) return;
            const blob = await window.CarnetQR.qrPNG(actual.qr_texto, 720);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = nombreBase() + '.png';
            document.body.appendChild(a); a.click(); a.remove();
        });

        $('btn-qr-imprimir').addEventListener('click', () => {
            if (!actual) return;
            const d = actual;
            const qr = window.CarnetQR.dibujarQR(document.createElement('canvas'), d.qr_texto, 360).toDataURL('image/png');
            const foto = $('carnet-foto').querySelector('img');
            const v = window.open('', '_blank');
            if (!v) { avisar('Permita las ventanas emergentes para imprimir.', { tipo: 'aviso', titulo: 'No se pudo abrir la impresión' }); return; }
            v.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Carnet ${esc(d.estudiante.cedula)}</title>
                <style>body{font-family:Arial,sans-serif;margin:24px;color:#111}.c{display:flex;gap:18px;align-items:center;border:1px solid #999;border-radius:10px;padding:16px;width:max-content}
                img.f{width:110px;height:138px;object-fit:cover;border-radius:6px;border:1px solid #ccc}img.q{width:170px;height:170px}
                h1{font-size:14px;margin:0 0 6px;color:#14306b}p{margin:2px 0;font-size:13px}code{font-size:13px;font-weight:bold}</style></head><body>
                <div class="c">${foto ? `<img class="f" src="${foto.src}" alt="">` : ''}<div><h1>U.E. INSTITUTO ELENA DE BUENO</h1>
                <p><strong>${esc(d.estudiante.nombre)} ${esc(d.estudiante.apellido)}</strong></p><p>C.I. ${esc(d.estudiante.cedula)}</p>
                <p>${esc(d.curso ? `${d.curso.nombre} ${d.curso.seccion}${d.curso.turno ? ' · ' + d.curso.turno : ''}` : 'Sin sección')}</p>
                <p>Periodo ${esc(d.periodo)}</p><code>${esc(d.codigo)}</code></div><img class="q" src="${qr}" alt="QR"></div>
                <script>window.onload=()=>{window.print();}<\/script></body></html>`);
            v.document.close();
        });

        $('btn-qr-nuevo').addEventListener('click', async () => {
            if (!actual) return;
            const ok = await confirmar('El código actual deja de servir para pasar lista. Úselo solo si el carnet se perdió o se dañó, y entregue el carnet nuevo al estudiante.',
                { titulo: '¿Generar un código QR nuevo?', aceptar: 'Generar código nuevo', peligro: true, icono: 'bx-refresh' });
            if (!ok) return;
            const r = await fetch(`/api/carnets/estudiante/${actual.estudiante.id}/regenerar`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: 'Carnet perdido o dañado' })
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { avisar(d.mensaje || 'Intente de nuevo.', { tipo: 'error', titulo: 'No se pudo generar el código' }); return; }
            pintar(d.datos);
            avisar(d.mensaje, { tipo: 'ok', titulo: 'Código nuevo listo' });
        });
    });

    window.mostrarCarnet = mostrarCarnet;
})();
