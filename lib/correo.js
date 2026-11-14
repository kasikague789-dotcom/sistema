// Envío de códigos por correo para recuperar claves (usa las mismas variables EMAIL_* del .env).
const nodemailer = require('nodemailer');

let transporte = null;
function correoConfigurado() {
    return !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}
function obtenerTransporte() {
    if (!transporte) {
        transporte = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            secure: false,
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
            connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000
        });
    }
    return transporte;
}

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Muestra el correo a medias: d****o@gmail.com
function ocultarCorreo(email) {
    const [u, d] = String(email || '').split('@');
    if (!d) return '';
    const vis = u.length <= 2 ? u[0] + '*' : u[0] + '*'.repeat(Math.max(1, u.length - 2)) + u[u.length - 1];
    return `${vis}@${d}`;
}

async function enviarCodigoRecuperacion(destinatario, nombre, codigo, para) {
    if (!correoConfigurado()) throw new Error('El correo del sistema no está configurado (EMAIL_HOST, EMAIL_USER, EMAIL_PASS).');
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #1a202c; margin: 0;">U.E. Instituto Elena de Bueno</h2>
                <p style="color: #718096; font-size: 14px; margin: 5px 0;">Recuperar ${esc(para)}</p>
            </div>
            <p style="color: #4a5568; font-size: 15px;">Hola <strong>${esc(nombre)}</strong>,</p>
            <p style="color: #4a5568; font-size: 15px;">Su código para poner una ${esc(para)} nueva es:</p>
            <div style="background: white; border: 2px dashed #3182ce; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <h1 style="color: #3182ce; letter-spacing: 8px; margin: 0; font-size: 36px;">${esc(codigo)}</h1>
            </div>
            <p style="color: #718096; font-size: 13px;">Vence en 15 minutos. Si usted no lo pidió, ignore este correo: su clave no cambia.</p>
        </div>`;
    await obtenerTransporte().sendMail({
        from: `"U.E. Elena de Bueno" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
        to: destinatario,
        subject: `Código para recuperar su ${para} - Sistema de Asistencia`,
        html
    });
}

module.exports = { enviarCodigoRecuperacion, ocultarCorreo, correoConfigurado };
