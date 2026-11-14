const PROFESOR_ACTUAL_ID = window.USUARIO.id; 

document.addEventListener('DOMContentLoaded', async () => {
    actualizarReloj();
    setInterval(actualizarReloj, 60000);

    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
    }

    const ahora = new Date();
    const selectMes = document.getElementById('filtro-mes');
    const selectAnio = document.getElementById('filtro-anio');

    if(selectMes) selectMes.value = ahora.getMonth() + 1;
    if(selectAnio) selectAnio.value = ahora.getFullYear();

    await cargarSeccionesDropdown();
    await cargarSubmenuSecciones();
    
    // Validamos si hay una sección seleccionada para cargar el reporte inicial
    const selectSeccion = document.getElementById('filtro-seccion');
    if(selectSeccion && selectSeccion.value) {
        await generarReporte();
    }

    // CONEXIÓN DEL BOTÓN DE EXCEL
    const btnExcel = document.getElementById('btnExportarExcel');
    if (btnExcel) {
        btnExcel.addEventListener('click', exportarAExcel);
    }
});

function actualizarReloj() {
    const ahora = new Date();
    const elClock = document.getElementById('live-clock');
    if (elClock) elClock.innerText = ahora.toLocaleString('es-ES', { 
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' 
    });
}

async function cargarSubmenuSecciones() {
    try {
        const response = await fetch(`/api/profesores/mis-secciones/${PROFESOR_ACTUAL_ID}`);
        const result = await response.json();
        const ul = document.getElementById('submenu-secciones');
        if(!ul) return;
        ul.innerHTML = '';
        
        // Forzar apertura del menú
        ul.classList.add('open');
        
        (result.datos || []).forEach(s => {
            ul.innerHTML += `<li><a href="secciones.html#${window.anclaClase(s.curso_id, s.materia)}">${escapeHTML(s.materia)} - ${escapeHTML(s.curso_nombre)} ${escapeHTML(s.seccion + (s.turno ? ' · ' + s.turno : ''))}</a></li>`;
        });
    } catch (e) { console.error("Error submenu:", e); }
}

async function cargarSeccionesDropdown() {
    try {
        const response = await fetch(`/api/profesores/mis-secciones/${PROFESOR_ACTUAL_ID}`);
        const result = await response.json();
        const secciones = result.datos || [];
        
        const selectSeccion = document.getElementById('filtro-seccion');
        if(!selectSeccion) return;
        
        selectSeccion.innerHTML = '';
        
        secciones.forEach(s => {
            selectSeccion.innerHTML += `<option value="${s.curso_id}" data-materia="${escapeHTML(s.materia)}">${escapeHTML(s.materia)} - ${escapeHTML(s.curso_nombre)} ${escapeHTML(s.seccion + (s.turno ? ' · ' + s.turno : ''))}</option>`;
        });
        // Si se llegó con ?curso_id=..&materia=.., se preselecciona esa clase
        const params = new URLSearchParams(window.location.search);
        const op = Array.from(selectSeccion.options).find(o => o.value === params.get('curso_id') && (!params.get('materia') || o.dataset.materia === params.get('materia')));
        if (op) selectSeccion.value = op.value, op.selected = true;

        selectSeccion.addEventListener('change', generarReporte);
        document.getElementById('filtro-mes').addEventListener('change', generarReporte);
        document.getElementById('filtro-anio').addEventListener('change', generarReporte);
    } catch (e) { console.error("Error dropdown:", e); }
}

async function generarReporte() {
    const selectSeccion = document.getElementById('filtro-seccion');
    const cursoId = selectSeccion.value;
    const opcion = selectSeccion.options[selectSeccion.selectedIndex];
    const materia = opcion ? (opcion.dataset.materia || '') : '';
    const mes = document.getElementById('filtro-mes').value;
    const anio = document.getElementById('filtro-anio').value;

    if(!cursoId) return;

    // Mostramos mensaje de carga
    const tbody = document.getElementById('cuerpo-tabla-reporte');
    if(tbody) tbody.innerHTML = `<tr><td colspan="37" style="text-align:center; padding:30px;">Cargando datos...</td></tr>`;

    try {
        const response = await fetch(`/api/profesores/reporte/${cursoId}?mes=${mes}&anio=${anio}&materia=${encodeURIComponent(materia)}`);
        const result = await response.json();
        
        if (result.estado === 'exitoso') {
            renderizarTablaReporte(result.estudiantes || [], result.asistencias || [], parseInt(mes), parseInt(anio), result.dias_clase || [], result.porcentaje_minimo || 85, result.no_dadas || []);
        } else {
            console.error("Error del servidor:", result.mensaje);
        }
    } catch (err) {
        console.error("Error al generar reporte:", err);
    }
}

function renderizarTablaReporte(estudiantes, asistencias, mes, anio, diasClase, minimo, noDadas) {
    // Días en que la clase no se dio (profesor ausente, etc.): salen como ND y no cuentan como falta
    const motivoNoDada = {};
    (noDadas || []).forEach(n => { motivoNoDada[n.dia] = n.motivo; });
    const tbody = document.getElementById('cuerpo-tabla-reporte');
    const theadTr = document.getElementById('cabecera-dias-reporte');
    if(!tbody || !theadTr) return;

    const diasEnMes = new Date(anio, mes, 0).getDate();

    let diasHTML = '<th>Estudiante</th><th>Cédula</th>';
    for (let d = 1; d <= 31; d++) {
        diasHTML += `<th style="${d > diasEnMes ? 'opacity:0.3;' : ''}">${d}</th>`;
    }
    diasHTML += '<th>P</th><th>A</th><th>T</th><th>J</th><th>%</th>';
    theadTr.innerHTML = diasHTML;

    // Mapear asistencias para búsqueda rápida: mapa[usuario_id][dia] = estado
    const mapaAsistencias = {};
    asistencias.forEach(a => {
        if(!mapaAsistencias[a.usuario_id]) mapaAsistencias[a.usuario_id] = {};
        mapaAsistencias[a.usuario_id][a.dia] = a.estado;
    });

    tbody.innerHTML = '';
    let totalPresentesGlobal = 0;
    let totalAusentesGlobal = 0;
    let totalAsistidosGlobal = 0;
    let totalRegistrosGlobal = 0;

    if(estudiantes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="37" style="text-align:center; padding:30px;">No hay estudiantes inscritos en esta sección.</td></tr>`;
        actualizarKPIs(0, 0, 0, 0);
        return;
    }

    estudiantes.forEach(est => {
        let presentes = 0, ausentes = 0, tardanzas = 0, justificados = 0;
        let celdasDias = '';

        for (let d = 1; d <= 31; d++) {
            if (d > diasEnMes) {
                celdasDias += `<td style="background:var(--bg-table-hover, #f7fafc); opacity:0.3;">-</td>`;
                continue;
            }

            const estado = mapaAsistencias[est.id] ? mapaAsistencias[est.id][d] : null;
            let icono = '-';
            let color = 'var(--text-secondary)';

            if (estado === 'presente') { icono = 'P'; presentes++; totalPresentesGlobal++; color = '#34C759'; }
            else if (estado === 'ausente') { icono = 'A'; ausentes++; totalAusentesGlobal++; color = '#FF3B30'; }
            else if (estado === 'tarde') { icono = 'T'; tardanzas++; color = '#FF9500'; }
            else if (estado === 'justificado' || estado === 'justificada') { icono = 'J'; justificados++; color = '#007AFF'; }

            if (!estado && motivoNoDada[d]) {
                celdasDias += `<td title="Día ${d}: clase no dada (${escapeHTML(motivoNoDada[d])}). No cuenta como falta." style="color:#8E8E93; font-weight:600; font-size:11px;">ND</td>`;
                continue;
            }
            const style = estado ? `color:${color}; font-weight:600;` : '';
            celdasDias += `<td title="Día ${d}: ${estado || 'Sin marcar'}" style="${style}">${icono}</td>`;
        }

        // % = (presente + tarde + justificado) / clases registradas del estudiante.
        const registrados = presentes + ausentes + tardanzas + justificados;
        const valorEst = registrados > 0 ? ((presentes + tardanzas + justificados) / registrados) * 100 : null;
        totalAsistidosGlobal += presentes + tardanzas + justificados;
        totalRegistrosGlobal += registrados;
        const porcentajeEst = valorEst === null ? '—' : valorEst.toFixed(0) + '%';
        const colorPct = valorEst !== null && valorEst < minimo ? 'color:#FF3B30;' : '';

        tbody.innerHTML += `
            <tr>
                <td><strong>${escapeHTML(est.nombre + ' ' + est.apellido)}</strong></td>
                <td>${escapeHTML(est.cedula)}</td>
                ${celdasDias}
                <td><strong style="color:#34C759;">${presentes}</strong></td>
                <td><strong style="color:#FF3B30;">${ausentes}</strong></td>
                <td><strong style="color:#FF9500;">${tardanzas}</strong></td>
                <td><strong style="color:#007AFF;">${justificados}</strong></td>
                <td><strong style="${colorPct}" title="Mínimo: ${minimo}%">${porcentajeEst}</strong></td>
            </tr>
        `;
    });

    actualizarKPIs(estudiantes.length, totalPresentesGlobal, totalAusentesGlobal, totalAsistidosGlobal, totalRegistrosGlobal);
}

function actualizarKPIs(totalEst, totalPres, totalAus, totalAsistidos, totalRegistros) {
    const elEst = document.getElementById('kpi-estudiantes');
    const elProm = document.getElementById('kpi-promedio');
    const elPres = document.getElementById('kpi-presentes');
    const elAus = document.getElementById('kpi-ausentes');

    if(elEst) elEst.innerText = totalEst;
    if(elPres) elPres.innerText = totalPres;
    if(elAus) elAus.innerText = totalAus;

    const promedio = totalRegistros > 0 ? ((totalAsistidos / totalRegistros) * 100).toFixed(1) + '%' : '—';
    if(elProm) elProm.innerText = promedio;
}

function escapeHTML(str) { return str ? str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)) : ''; }

function toggleSubmenu(el) { 
    const submenu = el.nextElementSibling; 
    if (submenu) submenu.classList.toggle('open'); 
}

// ==========================================
// FUNCIÓN PARA EXPORTAR A EXCEL BONITO (CON LOGO)
// ==========================================
async function exportarAExcel() {
    if (typeof ExcelJS === 'undefined') {
        alert("No se pudo cargar la librería de Excel. Por favor, recargue la página.");
        return;
    }

    const selectSeccion = document.getElementById('filtro-seccion');
    if (!selectSeccion.value) return;

    const nombreSeccion = selectSeccion.options[selectSeccion.selectedIndex].text;
    const mesTexto = document.getElementById('filtro-mes').options[document.getElementById('filtro-mes').selectedIndex].text;
    const anio = document.getElementById('filtro-anio').value;

    const tabla = document.querySelector('.tabla-reporte-mensual');
    const ths = tabla.querySelectorAll('thead th');
    const trs = document.querySelectorAll('#cuerpo-tabla-reporte tr');

    if (trs.length === 0 || trs[0].innerText.includes('No hay estudiantes') || trs[0].innerText.includes('Cargando')) {
        alert("No hay datos para exportar en este momento.");
        return;
    }

    // Crear libro y hoja de Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reporte');

    // --- CARGAR E INSERTAR EL LOGO ---
    try {
        const response = await fetch('../../css/elena.png');
        const arrayBuffer = await response.arrayBuffer();
        
        const imageId = workbook.addImage({
            buffer: arrayBuffer,
            extension: 'png',
        });

        // Lo posicionamos en la esquina superior izquierda
        worksheet.addImage(imageId, {
            tl: { col: 0, row: 0 }, 
            ext: { width: 65, height: 65 }
        });
    } catch (error) {
        console.warn("No se pudo cargar el logo en el Excel", error);
    }

    // Calcular letra de la última columna (dinámico)
    const numCols = ths.length;
    let ultimaLetra = '';
    if (numCols <= 26) {
        ultimaLetra = String.fromCharCode(64 + numCols);
    } else {
        ultimaLetra = 'A' + String.fromCharCode(64 + (numCols - 26));
    }

    // 1. Título Principal (Movido a la columna B para dejar espacio al logo)
    worksheet.mergeCells(`B1:${ultimaLetra}1`);
    const titleCell = worksheet.getCell('B1');
    titleCell.value = 'REPORTE DE ASISTENCIA';
    titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }; // Azul institucional
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Hacemos la primera fila más alta para que quepa el logo
    worksheet.getRow(1).height = 50; 

    // 2. Subtítulo
    worksheet.mergeCells(`B2:${ultimaLetra}2`);
    const subTitleCell = worksheet.getCell('B2');
    subTitleCell.value = `Sección: ${nombreSeccion} | Mes: ${mesTexto} | Año: ${anio}`;
    subTitleCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF4A5568' } };
    subTitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(2).height = 25;

    // 3. Cabeceras
    const headerRow = worksheet.addRow([]);
    ths.forEach((th, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = th.innerText.trim();
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B6CB0' } }; // Azul más claro
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    worksheet.getRow(3).height = 25;

    // 4. Ajustar ancho de columnas
    worksheet.getColumn(1).width = 30; // Estudiante
    worksheet.getColumn(2).width = 15; // Cédula
    for (let i = 3; i <= numCols; i++) {
        worksheet.getColumn(i).width = 4; // Días
    }

    // 5. Llenar los datos
    trs.forEach((tr) => {
        const tds = tr.querySelectorAll('td');
        const dataRow = worksheet.addRow([]);
        
        tds.forEach((td, i) => {
            const cell = dataRow.getCell(i + 1);
            const valor = td.innerText.trim();
            cell.value = valor;
            cell.font = { name: 'Arial', size: 10 };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

            // Pintar celdas según el estado
            if (i > 1) { 
                if (valor === 'P') {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6F6D5' } }; // Verde suave
                    cell.font = { color: { argb: 'FF22543D' }, bold: true };
                } else if (valor === 'A') {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFED7D7' } }; // Rojo suave
                    cell.font = { color: { argb: 'FF742A2A' }, bold: true };
                } else if (valor === 'T') {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEEBC8' } }; // Naranja suave
                    cell.font = { color: { argb: 'FF7B341E' }, bold: true };
                } else if (valor === 'J') {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBEE3F8' } }; // Azul suave
                    cell.font = { color: { argb: 'FF2A4365' }, bold: true };
                } else if (valor === 'ND') {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E5EA' } }; // Gris: clase no dada
                    cell.font = { color: { argb: 'FF48484A' }, bold: true };
                }
            }
            
            if (i === 0) cell.alignment = { vertical: 'middle', horizontal: 'left' };
        });
    });

    // 6. Generar descarga
    try {
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Reporte_Asistencia_${mesTexto}_${anio}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);
    } catch (error) {
        alert("Error al generar el Excel: " + error.message);
        console.error(error);
    }
}
