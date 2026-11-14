// Exportar la lista diaria a PDF o Excel (lo usan Pasar lista del profesor y Asistencia del director).
// Necesita js/exportar.js.
(function () {
    const ESTADO_TXT = { presente: 'Presente', tarde: 'Tarde', ausente: 'Ausente', justificada: 'Justificada', sin_marcar: 'Sin marcar' };
    const COLOR_FILA = { ausente: [253, 236, 236], tarde: [255, 244, 229], sin_marcar: [242, 243, 245] };
    let escudoCache = null;

    async function escudo() {
        if (escudoCache) return escudoCache;
        try {
            const r = await fetch('/css/escudo_pdf.jpg');
            escudoCache = new Uint8Array(await r.arrayBuffer());
        } catch { escudoCache = null; }
        return escudoCache;
    }

    function fechaBonita(f) {
        const [a, m, d] = f.split('-').map(Number);
        const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        return `${dias[new Date(a, m - 1, d).getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
    }
    const nombreSeccion = (c) => `${c.nombre} ${c.seccion}${c.turno ? ' · ' + c.turno : ''}`;

    async function pedir(params) {
        const q = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
        const r = await fetch('/api/asistencia/lista-diaria?' + q.toString());
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.mensaje || 'No se pudo armar la lista.');
        return d;
    }

    async function pdf(datos) {
        const E = window.Exportar;
        const doc = new E.Pdf();
        const img = await escudo();
        const unaSeccion = datos.secciones.length === 1 ? nombreSeccion(datos.secciones[0].curso) : 'Todas las secciones';
        doc.pie = `Lista diaria · ${unaSeccion} · ${fechaBonita(datos.fecha)} · Generado el ${new Date().toLocaleString('es-VE')}`;
        E.encabezado(doc, { escudo: img, titulo: 'Lista diaria de asistencia', lineas: [`Fecha: ${fechaBonita(datos.fecha)}`, unaSeccion] });

        let hayClases = false;
        datos.secciones.forEach((s, si) => {
            if (si > 0 && s.clases.length) { doc.nuevaPagina(); }
            s.clases.forEach(cl => {
                hayClases = true;
                doc.espacio(80);
                const titulo = `${nombreSeccion(s.curso)} — ${cl.materia || 'Sin materia'}`;
                doc.texto(titulo, doc.margen, doc.y, { tam: 11, negrita: true, color: [20, 48, 107], anchoMax: doc.ancho - doc.margen * 2 });
                doc.y += 15;
                if (cl.no_dada) {
                    // Clase no dada: no hay lista y nadie tiene falta
                    doc.texto([cl.inicio ? `Horario ${cl.inicio}–${cl.fin}` : '', cl.profesor ? `Prof. ${cl.profesor}` : ''].filter(Boolean).join('   ·   '), doc.margen, doc.y, { tam: 8.5, color: [74, 82, 99] });
                    doc.y += 16;
                    doc.rect(doc.margen, doc.y, doc.ancho - doc.margen * 2, 26, { relleno: [255, 244, 229], borde: [255, 200, 120] });
                    doc.texto(`CLASE NO DADA — ${cl.no_dada}. Los ${cl.resumen.total} estudiantes no tienen falta.`, doc.margen + 10, doc.y + 8, { tam: 10, negrita: true, color: [138, 75, 0], anchoMax: doc.ancho - doc.margen * 2 - 20 });
                    doc.y += 42;
                    return;
                }
                const det = [cl.inicio ? `Horario ${cl.inicio}–${cl.fin}` : '', cl.profesor ? `Prof. ${cl.profesor}` : '', cl.suplente ? `Suplente: ${cl.suplente}` : '',
                    `Presentes ${cl.resumen.presentes} · Tarde ${cl.resumen.tarde} · Ausentes ${cl.resumen.ausentes} · Justificadas ${cl.resumen.justificadas}` +
                    (cl.resumen.sin_marcar ? ` · Sin marcar ${cl.resumen.sin_marcar}` : '')].filter(Boolean).join('   ·   ');
                doc.texto(det, doc.margen, doc.y, { tam: 8.5, color: [74, 82, 99], anchoMax: doc.ancho - doc.margen * 2 });
                doc.y += 14;
                doc.tabla({
                    columnas: [
                        { titulo: 'N°', ancho: 24, alinear: 'centro' }, { titulo: 'Cédula', ancho: 62 },
                        { titulo: 'Estudiante', ancho: 170 }, { titulo: 'Estado', ancho: 64 },
                        { titulo: 'Hora', ancho: 38, alinear: 'centro' }, { titulo: 'Marcó', ancho: 44 },
                        { titulo: 'Observación', ancho: doc.ancho - doc.margen * 2 - 402 }
                    ],
                    filas: cl.filas.map(f => [f.n, f.cedula, f.estudiante, ESTADO_TXT[f.estado] || f.estado, f.hora, f.metodo, f.observaciones]),
                    filaColor: (i) => COLOR_FILA[cl.filas[i].estado] || null
                });
                doc.y += 18;
            });
        });
        if (!hayClases) doc.parrafo('No hay clases ni asistencias registradas para este día.', { tam: 11 });
        return doc.terminar();
    }

    function excel(datos) {
        const filas = [];
        datos.secciones.forEach(s => s.clases.forEach(cl => {
            const base = [`${s.curso.nombre} ${s.curso.seccion}`, s.curso.turno || '', cl.materia, cl.suplente ? `${cl.profesor || ''} (suplente: ${cl.suplente})` : (cl.profesor || ''), cl.inicio ? `${cl.inicio}-${cl.fin}` : ''];
            if (cl.no_dada) { filas.push([...base, '', '', '', 'Clase no dada', '', '', `${cl.no_dada}. Nadie tiene falta.`]); return; }
            cl.filas.forEach(f => filas.push([...base, f.n, f.cedula, f.estudiante, ESTADO_TXT[f.estado] || f.estado, f.hora, f.metodo, f.observaciones]));
        }));
        return window.Exportar.excel([{
            nombre: `Lista ${datos.fecha}`,
            titulo: ['U.E. Instituto Elena de Bueno — Lista diaria de asistencia', `Fecha: ${fechaBonita(datos.fecha)}`],
            columnas: [
                { titulo: 'Sección', ancho: 16 }, { titulo: 'Turno', ancho: 9 }, { titulo: 'Materia', ancho: 20 }, { titulo: 'Profesor', ancho: 22 },
                { titulo: 'Horario', ancho: 12 }, { titulo: 'N°', ancho: 5 }, { titulo: 'Cédula', ancho: 12 }, { titulo: 'Estudiante', ancho: 32 },
                { titulo: 'Estado', ancho: 12 }, { titulo: 'Hora', ancho: 8 }, { titulo: 'Marcó', ancho: 9 }, { titulo: 'Observación', ancho: 36 }
            ],
            filas
        }]);
    }

    // formato: 'pdf' | 'excel'
    window.exportarListaDiaria = async function ({ fecha, curso_id, materia, formato }) {
        try {
            const datos = await pedir({ fecha, curso_id, materia });
            const base = window.Exportar.nombreArchivo(`Lista_${datos.secciones.length === 1 ? `${datos.secciones[0].curso.nombre}_${datos.secciones[0].curso.seccion}${datos.secciones[0].curso.turno ? '_' + datos.secciones[0].curso.turno : ''}` : 'todas'}${materia ? '_' + materia : ''}_${datos.fecha}`);
            if (formato === 'excel') {
                window.Exportar.descargar(excel(datos), base + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            } else {
                window.Exportar.descargar(await pdf(datos), base + '.pdf', 'application/pdf');
            }
        } catch (err) {
            console.error(err);
            (window.avisar || alert)(err.message || 'No se pudo exportar.', { tipo: 'error', titulo: 'No se pudo exportar' });
        }
    };
})();
