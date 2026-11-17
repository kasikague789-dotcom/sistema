# Cambios del 04/11/2026

## Cómo ponerlo a funcionar

1. Arrancar el servidor como siempre: `node server.js`.
   La primera vez el servidor **solo**:
   - guarda un respaldo de la base en la carpeta `respaldos_bd/` (archivo .json),
   - aplica `migracion_2026_11.sql` (asistencia por clase, datos limpios, tabla de notificaciones),
   - completa las asignaciones de profesores que ya tenían horario,
   - muestra en la consola los choques de horario y las secciones sin horario.
2. Crear (o actualizar) el **super administrador**, que es el único director del sistema:
   ```
   node crear_admin.js
   ```
   Entra con `admin@elenadebueno.local` o la cédula `10000000`, clave `Admin-KDuvr286`.
   Si ya había un director, se actualiza esa misma cuenta (no se pierde su historial).
   Otros datos: `node crear_admin.js --correo=director@colegio.com --cedula=12345678 --clave=OtraClave`.
   Si hay más de un director, el script se detiene; `node crear_admin.js --forzar` deja uno solo.

### Empezar de cero con cuentas de prueba (opcional)
```
node reiniciar_bd.js              (solo muestra qué borraría)
node reiniciar_bd.js --confirmar  (guarda respaldo en respaldos_bd/ y lo hace)
```
Borra usuarios, asistencia, justificaciones, horarios, asignaciones, inscripciones, calendario y notificaciones.
Conserva las secciones, la configuración y las groserías. Crea el super administrador (director único), un profesor (Matemática en 1er Grado A),
dos estudiantes (1er Grado A) y un bloque de horario de prueba (lunes 08:00-09:30, aula "PRUEBA").
Las claves aparecen al terminar. Cámbielas antes del uso real.

Los estudiantes y profesores que tenían la clave de relleno quedan "sin cuenta": crean su cuenta en **Regístrese aquí** con su cédula.
Los archivos originales están en `respaldo_antes_de_cambios_2026-11-04/`.

## Login y registro
- Se entra con **correo o cédula** (la cédula se puede escribir con V- o puntos).
- **Mantener sesión iniciada** funciona: marcado dura 30 días; sin marcar, la sesión se borra al cerrar el navegador (12 h máximo).
- **¿Olvidó su contraseña?** explica el camino real: el director le pone una clave temporal en Usuarios > Editar > *Restablecer contraseña*, y la persona la cambia en *Mi Perfil* (ahora también los estudiantes pueden cambiarla).
- Errores en la misma pantalla (sin ventanitas). Si la cédula existe pero no tiene cuenta, lo manda a registrarse.
- Si ya hay sesión abierta, el login lleva directo al panel. Si la sesión vence, vuelve al login con aviso.
- Se quitaron cosas falsas: botón de Gmail (no estaba conectado), logo de emoji, correo de ejemplo inventado, enlace de "Términos" que no llevaba a nada. Se usa el escudo y el nombre real de la institución.

## Logo y nombre de la institución
- Login y registro: el panel azul ahora muestra el sello redondo de la institución, su lema real (Eucaristía · Hogar · Cultura)
  y explica para qué sirve el sistema a cada quien (profesores, estudiantes, dirección). En el registro explica los 3 pasos para crear la cuenta.
- El menú lateral de todas las pantallas muestra el escudo y "U.E.P. Instituto Elena de Bueno" (antes decía "Sistema" con un ícono de edificio).
- En celular, la barra de arriba también lleva el escudo.
- El logo de 1,5 MB se cambió por copias livianas (`css/escudo_elena.png` y `css/logo_elena_192.png`): las pantallas cargan más rápido.

## Director único (super administrador)
- Solo puede existir **un** director. No se puede crear otro, ni pre-registrar a alguien como director, ni subir a un profesor o estudiante a director.
- El director no puede cambiar su propio rol ni desactivarse ni borrarse.
- En Usuarios > Nuevo solo aparecen los roles Profesor y Estudiante. Al editar al director, el rol queda fijo.
- Al arrancar, la consola avisa si hay más de un director o ninguno.

## Filtro de groserías en todo el sistema
- Revisa **todo dato** que se guarda: nombres y apellidos, **correos (Gmail u otro)**, **contraseñas nuevas**, **fechas**,
  descripciones de justificaciones, nombre del archivo adjunto, observaciones de asistencia, calendario, materias, aulas,
  secciones y respuestas del director. También `node crear_admin.js`.
- Detecta mayúsculas, acentos, plural y masculino/femenino (idiota, IDIOTAS, estúpida...). Separa por números y signos:
  "idiota123" o "juan.tonto@gmail.com" se bloquean.
- En correos y contraseñas también busca groserías largas pegadas a otras letras ("soyidiota99@gmail.com", "MiClaveEstupida1").
  Las palabras cortas no, para no bloquear correos reales como "vergara", "antontorres" o "computacion".
- En contraseñas el aviso no repite la palabra: "La contraseña tiene una palabra no permitida. Escriba otra contraseña."
- No revisa la contraseña **actual** ni el inicio de sesión: una cuenta vieja siempre puede entrar y cambiar su clave.
  Tampoco el contenido del archivo adjunto.
- Las palabras se agregan o quitan en Configuración > Filtro de groserías y aplican al instante. El interruptor de esa misma pantalla lo apaga en todo el sistema.

## Ventanas de aviso propias (sin "localhost:3000 dice")
- Todas las ventanitas del navegador (alert, confirm y prompt) se cambiaron por ventanas con el diseño del sistema:
  ícono de color según el caso (listo, error, aviso, borrar), título claro, explicación y botones con el nombre de la acción
  ("Cerrar sesión", "Eliminar usuario", "Quitar asignación"...). Funcionan en modo claro y oscuro.
- En acciones que borran, el botón es rojo y el foco empieza en "Cancelar". Esc o tocar fuera cancela.
- "Corregir asistencia" del director ya no pide escribir el estado: se elige Presente, Ausente, Tarde o Justificada con botones.
- En celular la ventana sale desde abajo, con botones grandes a todo lo ancho.
- Las fechas de las ventanas de justificación van una debajo de otra en celular (antes se salían del borde).
- El código está en `js/dialogo.js` y los estilos al final de `css/responsive.css`.

## Notificaciones (campana en todos los paneles)
- Estudiante: cuando lo marcan **ausente** o **tarde**, cuando el director responde su justificación, cuando le corrigen la asistencia o le restablecen la clave.
- Director: cuando llega una justificación nueva (de un estudiante o de un profesor).
- Se apagan en Configuración > Notificaciones (deja de crear avisos y se oculta la campana).

## Celular y tableta
- En pantallas de menos de 768px el menú lateral se esconde y se abre con el botón de tres rayas (se cierra tocando fuera o con Esc).
- Tablas anchas (usuarios, reportes, horarios) se deslizan dentro de su caja; la página no se sale de lado.
- Pasar lista en celular: cada estudiante es una tarjeta con su estado y observación a lo ancho.
- Botones y campos de al menos 44px de alto para tocar con el dedo; letra mínima de 12px.
- Probado en 375px (celular), 768px (tableta) y 1280px (escritorio): ninguna pantalla se desborda.
- Los íconos (Boxicons) ahora están dentro del proyecto (`css/vendor/boxicons`), así funcionan sin internet. Se quitaron todos los emojis.

## Hora límite de entrada
- Se muestra al profesor al pasar lista ("quien llegue después: Tarde").

## Sesión y permisos
- Al iniciar sesión el servidor entrega un token. Todas las pantallas cargan `js/sesion.js`, que lo envía en cada llamada a la API.
- Cada profesor y estudiante ve **sus propios datos** (antes los JS tenían ids fijos).
- La API revisa el rol: un estudiante no puede ver usuarios, cambiarse el rol ni editar perfiles ajenos.
- Ya no se sirve toda la carpeta: el `.sql`, el código del servidor y las constancias no se abren por URL.
- Registro solo para cédulas sin clave; la clave de relleno ya no permite quedarse con cuentas.

## Asistencia por clase
- Cada registro guarda **sección y materia**; dos profesores el mismo día no se borran entre sí.
- Pasar lista arranca **sin marcar**, bloquea feriados/asuetos/vacaciones y fechas futuras, y solo acepta estudiantes de esa sección y materias del profesor.
- Control de Asistencia del director: fecha de hoy, materia y estudiantes **sin marcar**.
- Fechas en hora de Venezuela.

## Números
- Reportes: % = (presente + tarde + justificado) / clases registradas (antes se dividía entre los 30 días del mes).
- Un solo nombre para cada estado (`justificada`). El % mínimo marca en rojo en reportes y paneles.

## Justificaciones
- Valida fechas y el plazo de la configuración. Siempre a nombre de quien la pide. Constancia PDF/JPG/PNG (máx. 5 MB), visible solo para el dueño, sus profesores y el director.
- Aprobar justifica **solo las faltas**; guarda quién aprobó y cuántas faltas. "Anular aprobación" las devuelve.

## Horarios
- Cada estudiante ve el horario de **su** sección; cada profesor ve **sus** clases.
- Horario y "Asignar Profesores" dicen lo mismo: cargar un horario asigna la materia; quitar la asignación quita su horario.
- **No se inventan horas.** Los choques que ya existían (mismo profesor en dos salones a la vez) se muestran en Director > Horarios y en la consola para corregirlos con la hora real. Mientras tanto, el profesor y el estudiante ven las dos clases marcadas en rojo.
- `node arreglar_horarios.js` muestra el estado de los horarios (con `--aplicar` completa asignaciones y desactiva bloques imposibles; ya no mueve clases).
  Si antes corrió la versión vieja con `--aplicar`, tres clases quedaron a las 13:00-14:30; revíselas en Horarios.

## Pantallas del director
- "Nuevo usuario" y "Editar" guardan de verdad; Editar/Eliminar funcionan (Eliminar con historial solo desactiva).
- Tabla de usuarios: una fila por persona y faltas reales. Configuración conectada. Groserías desde la base.

## Validaciones
- Horarios sin choques y con fin después de inicio; no se asigna un estudiante como profesor (ni al revés); sin secciones repetidas; un estudiante en una sola sección; no se borra una sección con estudiantes o asistencia.

## Falta (necesita datos reales de la institución)
- Secciones con estudiantes pero **sin horario**: aparecen en Director > Horarios. Hay que cargar su horario real.
- Choques de horario existentes: corregir la hora real en Director > Horarios.
