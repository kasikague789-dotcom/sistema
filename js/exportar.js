/* Exportar sin librerías: ZIP, Excel (.xlsx) y PDF sencillo con tablas.
 * Funciona en el navegador (window.Exportar) y en el servidor (require('../js/exportar')),
 * así el acta del paso de año se arma con el mismo código.
 */
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else raiz.Exportar = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const utf8 = (t) => new TextEncoder().encode(String(t));

    // ---------------- ZIP (sin compresión: Excel y Windows lo abren igual) ----------------
    const TABLA_CRC = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function zip(archivos) { // [{nombre, datos: Uint8Array|string}]
        const partes = [], central = [];
        let offset = 0;
        const d = new Date();
        const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
        const fecha = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        for (const a of archivos) {
            const nombre = utf8(a.nombre);
            const datos = typeof a.datos === 'string' ? utf8(a.datos) : a.datos;
            const crc = crc32(datos);
            const loc = new DataView(new ArrayBuffer(30));
            loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
            loc.setUint16(8, 0, true); loc.setUint16(10, hora, true); loc.setUint16(12, fecha, true);
            loc.setUint32(14, crc, true); loc.setUint32(18, datos.length, true); loc.setUint32(22, datos.length, true);
            loc.setUint16(26, nombre.length, true); loc.setUint16(28, 0, true);
            partes.push(new Uint8Array(loc.buffer), nombre, datos);
            const cen = new DataView(new ArrayBuffer(46));
            cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
            cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true); cen.setUint16(12, hora, true);
            cen.setUint16(14, fecha, true); cen.setUint32(16, crc, true); cen.setUint32(20, datos.length, true);
            cen.setUint32(24, datos.length, true); cen.setUint16(28, nombre.length, true);
            cen.setUint32(42, offset, true);
            central.push(new Uint8Array(cen.buffer), nombre);
            offset += 30 + nombre.length + datos.length;
        }
        const tamCentral = central.reduce((s, p) => s + p.length, 0);
        const fin = new DataView(new ArrayBuffer(22));
        fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
        fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
        return unir([...partes, ...central, new Uint8Array(fin.buffer)]);
    }
    function unir(partes) {
        const total = partes.reduce((s, p) => s + p.length, 0);
        const out = new Uint8Array(total);
        let i = 0;
        for (const p of partes) { out.set(p, i); i += p.length; }
        return out;
    }

    // ---------------- EXCEL (.xlsx) ----------------
    const xml = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
        // caracteres de control que Excel no acepta
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    function columna(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

    // hojas: [{nombre, titulo?: [líneas], columnas: [{titulo, ancho}], filas: [[...]]}]
    function excel(hojas) {
        const archivos = [];
        const nombres = hojas.map((h, i) => (String(h.nombre || `Hoja ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)) || `Hoja ${i + 1}`);
        archivos.push({ nombre: '[Content_Types].xml', datos:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
            hojas.map((h, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
            '</Types>' });
        archivos.push({ nombre: '_rels/.rels', datos:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
        archivos.push({ nombre: 'xl/workbook.xml', datos:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
            nombres.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' });
        archivos.push({ nombre: 'xl/_rels/workbook.xml.rels', datos:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            hojas.map((h, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
            `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
        // Estilos: 0 normal, 1 encabezado (negrita, fondo gris, borde), 2 celda con borde, 3 título grande en negrita
        archivos.push({ nombre: 'xl/styles.xml', datos:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
            '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5EAF3"/><bgColor indexed="64"/></patternFill></fill></fills>' +
            '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB0B8C8"/></left><right style="thin"><color rgb="FFB0B8C8"/></right><top style="thin"><color rgb="FFB0B8C8"/></top><bottom style="thin"><color rgb="FFB0B8C8"/></bottom><diagonal/></border></borders>' +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf>' +
            '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' });
        hojas.forEach((h, i) => {
            const filasXml = [];
            let r = 1;
            const celda = (c, v, estilo) => {
                const ref = `${columna(c)}${r}`;
                if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${estilo}"><v>${v}</v></c>`;
                return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
            };
            (h.titulo || []).forEach((linea, k) => { filasXml.push(`<row r="${r}">${celda(0, linea, k === 0 ? 3 : 0)}</row>`); r++; });
            if ((h.titulo || []).length) r++;
            const filaEnc = r;
            filasXml.push(`<row r="${r}">${h.columnas.map((c, k) => celda(k, c.titulo, 1)).join('')}</row>`); r++;
            h.filas.forEach(f => { filasXml.push(`<row r="${r}">${f.map((v, k) => celda(k, v, 2)).join('')}</row>`); r++; });
            const cols = h.columnas.map((c, k) => `<col min="${k + 1}" max="${k + 1}" width="${c.ancho || 14}" customWidth="1"/>`).join('');
            const ultima = `${columna(h.columnas.length - 1)}${Math.max(filaEnc, r - 1)}`;
            archivos.push({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos:
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
                `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${filaEnc}" topLeftCell="A${filaEnc + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
                `<cols>${cols}</cols><sheetData>${filasXml.join('')}</sheetData>` +
                `<autoFilter ref="A${filaEnc}:${ultima}"/></worksheet>` });
        });
        return zip(archivos);
    }

    // ---------------- PDF ----------------
    // Anchos de Helvetica / Helvetica-Bold (1/1000 de punto), caracteres 32..126
    const ANCHO_N = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
    const ANCHO_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
    // Letras con acento: mismo ancho que la letra base
    const BASE = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n', 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ü': 'U', 'Ñ': 'N', 'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u', 'ç': 'c', 'Ç': 'C' };
    const WIN = { '–': 0x96, '—': 0x97, '•': 0x95, '…': 0x85, '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92, '€': 0x80 };
    // Signos que Helvetica no trae: se cambian por uno parecido
    const SUST = { '→': '»', '←': '«', '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x' };
    function anchoCar(ch, negrita) {
        const tabla = negrita ? ANCHO_B : ANCHO_N;
        ch = SUST[ch] || ch;
        const b = BASE[ch] || ch;
        const c = b.charCodeAt(0);
        if (c >= 32 && c <= 126) return tabla[c - 32];
        if (ch === '·') return 278; if (ch === '•') return 350; if (ch === '–') return 556; if (ch === '—') return 1000;
        if (ch === '»' || ch === '«') return 556;
        if (ch === '¿') return 611; if (ch === '¡') return 333; if (ch === '°' || ch === 'º' || ch === 'ª') return 400;
        return 556;
    }
    const medir = (t, tam, negrita) => [...String(t)].reduce((s, ch) => s + anchoCar(ch, negrita), 0) * tam / 1000;
    // Texto a bytes WinAnsi escritos con escapes octales (el PDF queda en ASCII)
    function pdfTexto(t) {
        let s = '';
        for (let ch of String(t)) {
            ch = SUST[ch] || ch;
            let c = WIN[ch] || ch.charCodeAt(0);
            if (c > 255) c = 63; // '?'
            if (c === 40 || c === 41 || c === 92) s += '\\' + ch;
            else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
            else s += String.fromCharCode(c);
        }
        return s;
    }
    function recortar(t, ancho, tam, negrita) {
        t = String(t == null ? '' : t);
        if (medir(t, tam, negrita) <= ancho) return t;
        while (t.length > 1 && medir(t + '…', tam, negrita) > ancho) t = t.slice(0, -1);
        return t + '…';
    }
    function partirLineas(t, ancho, tam, negrita) {
        const palabras = String(t == null ? '' : t).split(/\s+/).filter(Boolean);
        const lineas = [];
        let actual = '';
        for (const p of palabras) {
            const prueba = actual ? actual + ' ' + p : p;
            if (medir(prueba, tam, negrita) <= ancho || !actual) actual = prueba;
            else { lineas.push(actual); actual = p; }
        }
        if (actual) lineas.push(actual);
        return lineas.length ? lineas.map(l => recortar(l, ancho, tam, negrita)) : [''];
    }
    const num = (n) => (Math.round(n * 100) / 100).toString();
    const color = (c) => c.map(v => num(v / 255)).join(' ');

    function tamanoJPEG(b) { // ancho, alto y canales leyendo el marcador SOF
        let i = 2;
        while (i < b.length) {
            if (b[i] !== 0xFF) { i++; continue; }
            const m = b[i + 1];
            const largo = (b[i + 2] << 8) | b[i + 3];
            if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) {
                return { alto: (b[i + 5] << 8) | b[i + 6], ancho: (b[i + 7] << 8) | b[i + 8], canales: b[i + 9] };
            }
            i += 2 + largo;
        }
        return null;
    }

    class Pdf {
        constructor({ horizontal = false, margen = 40 } = {}) {
            this.ancho = horizontal ? 792 : 612; // carta
            this.alto = horizontal ? 612 : 792;
            this.margen = margen;
            this.paginas = [];
            this.imagenes = [];
            this.pie = null;
            this.nuevaPagina();
        }
        nuevaPagina() { this.ops = []; this.paginas.push(this.ops); this.y = this.margen; if (this.alNuevaPagina) this.alNuevaPagina(this); return this; }
        espacio(alto) { if (this.y + alto > this.alto - this.margen - 18) this.nuevaPagina(); }
        medir(t, tam = 10, negrita = false) { return medir(t, tam, negrita); }
        texto(t, x, y, { tam = 10, negrita = false, color: c = [20, 24, 32], alinear = 'izq', anchoMax = 0 } = {}) {
            let s = String(t == null ? '' : t);
            if (anchoMax) s = recortar(s, anchoMax, tam, negrita);
            let px = x;
            const w = medir(s, tam, negrita);
            if (alinear === 'centro') px = x - w / 2;
            if (alinear === 'der') px = x - w;
            this.ops.push(`BT /${negrita ? 'F2' : 'F1'} ${num(tam)} Tf ${color(c)} rg ${num(px)} ${num(this.alto - y - tam * 0.8)} Td (${pdfTexto(s)}) Tj ET`);
            return w;
        }
        // Párrafo con saltos de línea automáticos; avanza this.y
        parrafo(t, { tam = 10, negrita = false, color: c, interlineado = 1.35, x = this.margen, ancho = this.ancho - this.margen * 2 } = {}) {
            for (const l of partirLineas(t, ancho, tam, negrita)) {
                this.espacio(tam * interlineado);
                this.texto(l, x, this.y, { tam, negrita, color: c });
                this.y += tam * interlineado;
            }
        }
        linea(x1, y1, x2, y2, { grosor = 0.6, color: c = [176, 184, 200] } = {}) {
            this.ops.push(`${num(grosor)} w ${color(c)} RG ${num(x1)} ${num(this.alto - y1)} m ${num(x2)} ${num(this.alto - y2)} l S`);
        }
        rect(x, y, w, h, { relleno = null, borde = null, grosor = 0.6 } = {}) {
            const r = `${num(x)} ${num(this.alto - y - h)} ${num(w)} ${num(h)} re`;
            if (relleno && borde) this.ops.push(`${color(relleno)} rg ${color(borde)} RG ${num(grosor)} w ${r} B`);
            else if (relleno) this.ops.push(`${color(relleno)} rg ${r} f`);
            else if (borde) this.ops.push(`${color(borde)} RG ${num(grosor)} w ${r} S`);
        }
        imagenJPEG(bytes, x, y, w, h) {
            const info = tamanoJPEG(bytes);
            if (!info) return;
            let idx = this.imagenes.findIndex(im => im.bytes === bytes);
            if (idx < 0) { this.imagenes.push({ bytes, ...info }); idx = this.imagenes.length - 1; }
            this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.alto - y - h)} cm /Im${idx} Do Q`);
        }
        // columnas: [{titulo, ancho, alinear}]; filas: [[...]]; colores por fila opcionales: filaColor(i, fila)
        tabla({ columnas, filas, tam = 9, alto = 16, x = this.margen, filaColor = null }) {
            const total = columnas.reduce((s, c) => s + c.ancho, 0);
            const encabezado = () => {
                this.rect(x, this.y, total, alto, { relleno: [229, 234, 243], borde: [176, 184, 200] });
                let cx = x;
                columnas.forEach(c => {
                    const tx = c.alinear === 'der' ? cx + c.ancho - 4 : c.alinear === 'centro' ? cx + c.ancho / 2 : cx + 4;
                    this.texto(c.titulo, tx, this.y + (alto - tam) / 2, { tam, negrita: true, alinear: c.alinear || 'izq', anchoMax: c.ancho - 8 });
                    cx += c.ancho;
                });
                this.y += alto;
            };
            this.espacio(alto * 2);
            encabezado();
            filas.forEach((f, i) => {
                if (this.y + alto > this.alto - this.margen - 18) { this.nuevaPagina(); encabezado(); }
                const fondo = filaColor ? filaColor(i, f) : (i % 2 ? [247, 249, 252] : null);
                this.rect(x, this.y, total, alto, { relleno: fondo, borde: [210, 216, 228] });
                let cx = x;
                columnas.forEach((c, k) => {
                    const tx = c.alinear === 'der' ? cx + c.ancho - 4 : c.alinear === 'centro' ? cx + c.ancho / 2 : cx + 4;
                    this.texto(f[k], tx, this.y + (alto - tam) / 2, { tam, alinear: c.alinear || 'izq', anchoMax: c.ancho - 8 });
                    cx += c.ancho;
                });
                this.y += alto;
            });
        }
        terminar() {
            const objs = [];
            const add = (s) => { objs.push(s); return objs.length; };
            const catalogo = add(null), paginasObj = add(null);
            const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
            const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
            const imgs = this.imagenes.map(im => add({ im }));
            const total = this.paginas.length;
            const kids = [];
            this.paginas.forEach((ops, i) => {
                const lista = [...ops];
                if (this.pie !== false) {
                    const t = typeof this.pie === 'string' ? this.pie : '';
                    const yPie = this.alto - 22;
                    if (t) lista.push(`BT /F1 8 Tf ${color([90, 98, 112])} rg ${num(this.margen)} ${num(22)} Td (${pdfTexto(recortar(t, this.ancho - this.margen * 2 - 80, 8, false))}) Tj ET`);
                    const pag = `Página ${i + 1} de ${total}`;
                    lista.push(`BT /F1 8 Tf ${color([90, 98, 112])} rg ${num(this.ancho - this.margen - medir(pag, 8, false))} ${num(22)} Td (${pdfTexto(pag)}) Tj ET`);
                    void yPie;
                }
                const contenido = lista.join('\n');
                const cont = add({ stream: contenido });
                const recursosImg = imgs.length ? `/XObject << ${imgs.map((n, k) => `/Im${k} ${n} 0 R`).join(' ')} >>` : '';
                kids.push(add(`<< /Type /Page /Parent ${paginasObj} 0 R /MediaBox [0 0 ${this.ancho} ${this.alto}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> ${recursosImg} >> /Contents ${cont} 0 R >>`));
            });
            objs[catalogo - 1] = `<< /Type /Catalog /Pages ${paginasObj} 0 R >>`;
            objs[paginasObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

            const partes = [];
            let largo = 0;
            const offsets = [];
            const push = (u8) => { partes.push(u8); largo += u8.length; };
            push(utf8('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
            objs.forEach((o, i) => {
                offsets.push(largo);
                if (o && o.stream !== undefined) {
                    const datos = utf8(o.stream);
                    push(utf8(`${i + 1} 0 obj\n<< /Length ${datos.length} >>\nstream\n`)); push(datos); push(utf8('\nendstream\nendobj\n'));
                } else if (o && o.im) {
                    const im = o.im;
                    const cs = im.canales === 1 ? '/DeviceGray' : im.canales === 4 ? '/DeviceCMYK' : '/DeviceRGB';
                    push(utf8(`${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.ancho} /Height ${im.alto} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`));
                    push(im.bytes); push(utf8('\nendstream\nendobj\n'));
                } else {
                    push(utf8(`${i + 1} 0 obj\n${o}\nendobj\n`));
                }
            });
            const xref = largo;
            push(utf8(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`));
            push(utf8(`trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
            return unir(partes);
        }
    }

    // ---------------- Descargar en el navegador ----------------
    function descargar(bytes, nombre, tipo) {
        const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: tipo || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = nombre;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    const nombreArchivo = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

    // Encabezado institucional común (escudo + nombre + título + subtítulos)
    function encabezado(doc, { escudo, titulo, lineas = [] }) {
        const m = doc.margen;
        if (escudo) doc.imagenJPEG(escudo, m, doc.y, 46, 46);
        const x = escudo ? m + 56 : m;
        doc.texto('U.E. INSTITUTO ELENA DE BUENO', x, doc.y + 2, { tam: 9, negrita: true, color: [20, 48, 107] });
        doc.texto(titulo, x, doc.y + 15, { tam: 15, negrita: true, color: [20, 24, 32], anchoMax: doc.ancho - x - m });
        lineas.forEach((l, i) => doc.texto(l, x, doc.y + 34 + i * 12, { tam: 9, color: [74, 82, 99], anchoMax: doc.ancho - x - m }));
        doc.y += Math.max(54, 38 + lineas.length * 12) + 6;
        doc.linea(m, doc.y, doc.ancho - m, doc.y, { grosor: 1.2, color: [20, 48, 107] });
        doc.y += 12;
    }

    return { zip, excel, Pdf, descargar, nombreArchivo, encabezado, crc32 };
});
