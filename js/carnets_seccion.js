// Director > Carnets QR: carnets de una sección para imprimir o pasar a quienes diseñan el carnet
(function () {
    let datosSeccion = null;
    const $ = (id) => document.getElementById(id);
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

    async function cargarSecciones() {
        const sel = $('sel-seccion');
        try {
            const r = await fetch('/api/secciones');
            const d = await r.json();
            const activas = (d.datos || []).filter(s => s.activo == 1);
            sel.innerHTML = '<option value="">Elija una sección…</option>' + activas.map(s =>
                `<option value="${s.id}">${esc(s.nombre)} ${esc(s.seccion)}${s.turno ? ' · ' + esc(s.turno) : ''}</option>`).join('');
            const pedida = new URLSearchParams(location.search).get('seccion');
            if (pedida && activas.some(s => String(s.id) === pedida)) { sel.value = pedida; cargarSeccion(pedida); }
        } catch {
            sel.innerHTML = '<option value="">No se pudieron cargar las secciones</option>';
        }
    }

    async function cargarSeccion(id) {
        const grid = $('grid-carnets');
        ['btn-imprimir', 'btn-zip', 'btn-excel'].forEach(b => { $(b).disabled = true; });
        if (!id) { grid.innerHTML = '<p class="vacio-carnets">Elija una sección para ver sus carnets.</p>'; return; }
        grid.innerHTML = '<p class="vacio-carnets">Cargando carnets…</p>';
        try {
            const r = await fetch(`/api/carnets/seccion/${id}`);
            const d = await r.json();
            if (!r.ok) throw new Error(d.mensaje);
            datosSeccion = d;
            if (!d.datos.length) { grid.innerHTML = '<p class="vacio-carnets">Esta sección no tiene estudiantes activos. Asígnelos en "Asignar Estudiante".</p>'; return; }
            grid.innerHTML = d.datos.map((c, i) => `
                <article class="tarjeta-carnet">
                    <div class="foto" id="foto-${c.estudiante.id}"><i class='bx bx-user' aria-hidden="true"></i></div>
                    <div style="min-width:0;">
                        <h3>${esc(c.estudiante.apellido)}, ${esc(c.estudiante.nombre)}</h3>
                        <p>C.I. ${esc(c.estudiante.cedula)}</p>
                        <p>${esc(d.curso.nombre)} ${esc(d.curso.seccion)}${d.curso.turno ? ' · ' + esc(d.curso.turno) : ''} · ${esc(c.periodo)}</p>
                        <code>${esc(c.codigo)}</code><br>
                        <a href="usuario_form.html?id=${c.estudiante.id}">Editar foto o carnet</a>
                    </div>
                    <canvas id="qr-${i}" role="img" aria-label="Código QR de ${esc(c.estudiante.nombre)} ${esc(c.estudiante.apellido)}"></canvas>
                </article>`).join('');
            d.datos.forEach((c, i) => {
                window.CarnetQR.dibujarQR($(`qr-${i}`), c.qr_texto, 256);
                if (c.tiene_foto) {
                    const img = document.createElement('img');
                    img.alt = '';
                    window.CarnetQR.cargarFoto(c.estudiante.id, img).then(ok => { if (ok) { const f = $(`foto-${c.estudiante.id}`); f.innerHTML = ''; f.appendChild(img); } });
                }
            });
            ['btn-imprimir', 'btn-zip', 'btn-excel'].forEach(b => { $(b).disabled = false; });
        } catch (err) {
            grid.innerHTML = `<p class="vacio-carnets">${esc(err.message || 'No se pudieron cargar los carnets.')}</p>`;
        }
    }

    const baseNombre = () => window.Exportar.nombreArchivo(`Carnets_${datosSeccion.curso.nombre}_${datosSeccion.curso.seccion}${datosSeccion.curso.turno ? '_' + datosSeccion.curso.turno : ''}_${datosSeccion.periodo}`);

    async function descargarZip() {
        const archivos = [];
        for (const c of datosSeccion.datos) {
            const blob = await window.CarnetQR.qrPNG(c.qr_texto, 720);
            archivos.push({
                nombre: window.Exportar.nombreArchivo(`${c.estudiante.apellido}_${c.estudiante.nombre}_${c.estudiante.cedula}`) + '.png',
                datos: new Uint8Array(await blob.arrayBuffer())
            });
        }
        window.Exportar.descargar(window.Exportar.zip(archivos), baseNombre() + '_QR.zip', 'application/zip');
    }

    function descargarExcel() {
        const d = datosSeccion;
        window.Exportar.descargar(window.Exportar.excel([{
            nombre: 'Carnets',
            titulo: ['U.E. Instituto Elena de Bueno — Datos para carnets', `${d.curso.nombre} ${d.curso.seccion}${d.curso.turno ? ' · ' + d.curso.turno : ''} · Periodo ${d.periodo}`],
            columnas: [
                { titulo: 'N°', ancho: 5 }, { titulo: 'Apellidos', ancho: 22 }, { titulo: 'Nombres', ancho: 22 }, { titulo: 'Cédula', ancho: 12 },
                { titulo: 'Sección', ancho: 14 }, { titulo: 'Turno', ancho: 9 }, { titulo: 'Periodo', ancho: 11 }, { titulo: 'Código', ancho: 22 },
                { titulo: 'Archivo QR (.zip)', ancho: 36 }, { titulo: 'Texto del QR', ancho: 60 }
            ],
            filas: d.datos.map((c, i) => [i + 1, c.estudiante.apellido, c.estudiante.nombre, c.estudiante.cedula, `${d.curso.nombre} ${d.curso.seccion}`,
                d.curso.turno || '', c.periodo, c.codigo,
                window.Exportar.nombreArchivo(`${c.estudiante.apellido}_${c.estudiante.nombre}_${c.estudiante.cedula}`) + '.png', c.qr_texto])
        }]), baseNombre() + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }

    document.addEventListener('DOMContentLoaded', () => {
        cargarSecciones();
        $('sel-seccion').addEventListener('change', (e) => cargarSeccion(e.target.value));
        $('btn-imprimir').addEventListener('click', () => window.print());
        $('btn-zip').addEventListener('click', async (e) => {
            const b = e.currentTarget; b.disabled = true;
            try { await descargarZip(); } finally { b.disabled = false; }
        });
        $('btn-excel').addEventListener('click', descargarExcel);
    });
})();
