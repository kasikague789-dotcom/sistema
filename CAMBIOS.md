# Cambios del 11/11/2026 y 12/11/2026: carnet QR, turno, exportar, cierre de periodo, suplentes y teléfono

## Para subirlo (GitHub + Clever Cloud)

Paso a paso corto: **`PASOS_PARA_SUBIR.txt`**.

1. Copiar estos archivos encima del proyecto y subirlos a GitHub como siempre.
   **No subir el archivo `.env`** (tiene las claves del correo y de la base).
2. Clever Cloud vuelve a publicar solo. Al arrancar, el servidor **actualiza la base solo**
   (versiones `2026-12` y `2026-13`): agrega las columnas y tablas nuevas sin borrar nada.
   En los registros de Clever Cloud debe salir: `Versión 2026-12 aplicada (... cambios nuevos)` y
   `Versión 2026-13 aplicada: clase no dada y suplencias.`
3. En Clever Cloud > Environment variables, poner **`SESSION_SECRET`** con un texto largo al azar.
   Sin eso, cada vez que se publica de nuevo se cierran todas las sesiones.
4. El disco de Clever Cloud se borra en cada publicación. Por eso las **fotos** de los carnets
   y las **actas** del cierre se guardan dentro de la base de datos, no en carpetas.
   Ojo: los archivos adjuntos de las justificaciones (carpeta `uploads/`) sí se guardan en disco
   y se pierden al publicar de nuevo. Para conservarlos, conectar un *FS Bucket* de Clever Cloud a esa carpeta.
5. La cámara **en vivo** del celular solo funciona con **https** (Clever Cloud ya lo da). En `http://`
   el profesor usa **Tomar foto del carnet** (abre la cámara del teléfono y lee el QR de la foto),
   un lector USB, o escribe el código.

**Seguridad:** si la base de Clever Cloud se cargó con `base_de_datos/sistema_asistencia.sql`,
ahí están las cuentas de prueba y sus claves salen escritas en LEEME.txt y en este archivo.
Cambie ya la clave del director (Mi perfil) y borre o desactive las cuentas de prueba.

## Pruebas hechas (12/11/2026)

Tres rondas, cada prueba con la base limpia. **0 errores.**
1. **Lógica y servidor** (750 revisiones): permisos de cada rol, flujos, carnet QR, turnos, clase no dada y suplentes,
   horarios (horas, choques, turno), recuperar clave, limpiar base, deshacer cierre (4 casos + dos cierres seguidos).
2. **Pantallas** (PC y teléfono): escanear con cámara en vivo y con foto, pasar lista, cierre de periodo, horarios,
   recorrido de las 30 pantallas de los 3 roles sin errores, teléfono de 360 y 412 px sin nada fuera de lugar.
3. **Como en Clever Cloud**: MySQL 8 en modo estricto y hora UTC, base nueva desde `base_de_datos/sistema_asistencia.sql`
   (las actualizaciones 2026-12 y 2026-13 se aplican solas al arrancar). El https local no se activa en la nube.

## Primeros pasos del director

1. **Configuración > Clave de seguridad**: crear una clave aparte (mínimo 8, distinta a la contraseña).
   Solo el director la sabe. Se pide para pasar de año.
2. **Configuración > Minutos de tolerancia** (por defecto 10): después de eso, el escaneo marca *Tarde*.
3. **Gestionar Secciones**: poner el **turno** (Mañana / Tarde) a cada sección.
   Puede haber "1er Año A" en la mañana y otro en la tarde.

## Turnos: cada sección pasa lista en su turno

- En **Configuración > Cambio de turno (mañana a tarde)** se pone la hora que separa los turnos (por defecto 12:30).
- Una sección de la **mañana** solo pasa lista (o escanea carnets) **antes** de esa hora; una de la **tarde**, **desde** esa hora.
  Fuera de su turno, Pasar lista muestra "Fuera de turno" y los botones quedan apagados.
- Las secciones **sin turno** no tienen límite. El **director** puede guardar o corregir a cualquier hora.
- En **Horarios** no se puede crear una clase fuera del turno de su sección, y la revisión de arriba avisa
  si ya hay clases fuera de turno (por ejemplo, al cambiar el turno de una sección).

## Carnet con código QR

- Cada estudiante tiene **un código único** por periodo, por ejemplo `IEB-7KQM-2XWP-9HDR`.
  Es al azar: no se puede adivinar con la cédula.
- El QR lleva: institución, periodo, nombre, cédula, sección y turno, y el código.
  La **materia** la pone la clase que el profesor tiene abierta al escanear.
- **Usuarios > Editar** (estudiante): sale el carnet con foto (opcional), QR, código y datos.
  Botones: *Cambiar foto*, *Quitar foto*, *Descargar QR (PNG)*, *Imprimir*, *Generar QR nuevo*
  (para carnet perdido: el viejo deja de servir al instante).
- **Carnets QR** (menú nuevo): elegir sección y
  - *Imprimir hoja* con todos los carnets,
  - *QR de la sección (.zip)*: un PNG por estudiante,
  - *Datos para el diseño (Excel)*: nombre, cédula, sección, turno, código, nombre del PNG y texto del QR.
  El diseño del carnet físico lo hacen otras personas con esos archivos.
- La foto la cambia solo el director. La ve el director, el propio estudiante y los profesores de su sección.

## Escanear al pasar lista (profesor)

- En **Pasar lista** sale el botón **Escanear carnets**. Solo escanea en la lista de **hoy** y dentro del turno;
  en otro día o lista cerrada el botón se ve apagado y, al tocarlo, explica por qué.
- En **Inicio** del profesor, la clase que está en su hora tiene el botón **Escanear QR**:
  abre Pasar lista de esa clase con el lector ya abierto.
- Usa la cámara (atrás en el celular) o un **lector USB** (escribe el código y Enter).
- **Sin https** (por ejemplo el teléfono por Wi-Fi a la PC) el navegador no deja la cámara en vivo.
  Entonces sale el botón grande **Tomar foto del carnet**: abre la cámara del teléfono, se toma la foto
  y el sistema lee el QR de la foto y marca igual. Si la foto no tiene QR claro, pide otra.
- Lee también QR hechos con otros programas (texto que no es UTF-8).
- **Prueba en la red local (PC + teléfonos/tabletas en el mismo Wi-Fi):** `PROBAR_EN_MI_PC.bat` abre también
  un puerto **https** (3443) con un certificado propio de la PC (`lib/https_local.js`, se crea solo en la carpeta
  `certificado_local/`, que no se sube a GitHub). Por esa dirección la **cámara en vivo** funciona en el teléfono.
  La primera vez el navegador avisa "La conexión no es privada": se toca *Configuración avanzada > Acceder*.
  Si un teléfono entra por http (con la IP de la PC), **pasa solo a https**. La PC misma (localhost) sigue por http.
  Si alguna lista quedó abierta por http, Pasar lista muestra **Usar cámara en vivo**, que la abre por https.
- **Lectura en vivo, como el lector del teléfono:** apuntar al carnet basta; lee, suena, marca y sigue con el próximo.
  Enfoque automático continuo, más resolución, y busca el QR en el cuadro entero y en el centro (carnet lejos o chico).
  Botón **Prender linterna** si el teléfono la tiene. En el teléfono ya no se abre el teclado encima de la cámara.
- **Foto del carnet** (respaldo): ahora también busca en recortes del centro de la foto; lee carnets chicos,
  girados, borrosos o fotografiados de una pantalla.
  Solo arranca si existe la variable `HTTPS_PUERTO`; en Clever Cloud no se usa (allá ya hay https).
- Cada lectura muestra foto y nombre, suena, y marca la fila: **Presente**, o **Tarde** si pasó la tolerancia
  desde el inicio de la clase. La fila dice "QR 08:05".
- Avisos: carnet repetido, carnet anulado o de otro periodo, estudiante de otra sección, código falso.
- Si el mismo carnet se marca en dos clases que ocurren **a la misma hora**, avisa al profesor y al director
  (posible carnet copiado). Clases seguidas no cuentan.
- *Faltantes como ausentes* marca al resto. Luego **Guardar lista** como siempre.
- Todo escaneo queda registrado (tabla `escaneos`).

## Exportar la lista diaria (PDF y Excel)

- **Director > Asistencia**: botones PDF y Excel. Sale la lista del día por sección y materia
  (estado, hora, si fue por QR o manual, observación).
- **Profesor > Pasar lista**: PDF y Excel de su clase.

## Cierre de periodo (pasar de año)

- Menú **Cierre de periodo**. Muestra cada sección y a dónde pasa (misma letra y turno):
  1er Grado → … → 6to Grado → **1er Año** → … → 5to Año → 6to Año (técnico) → egresa.
- En **5to Año** el director elige por estudiante: *Pasa a 6to Año* o *Egresa en 5to Año*.
- En cualquier sección puede marcar quién **repite** (se queda en la misma sección).
- Si la sección destino no existe, se crea sola. También puede elegir otra sección destino.
- Para hacerlo pide: **contraseña del director + clave de seguridad + escribir PROMOVER**.
  5 intentos fallidos = 15 minutos de espera.
- Al confirmar (todo o nada):
  - cambia la sección y el año de cada estudiante (se ve en su perfil),
  - los que egresan quedan inactivos (su historial se conserva),
  - **todos los QR anteriores dejan de servir** (se generan nuevos para el periodo nuevo),
  - si se deja marcado, archiva horarios y asignaciones: el director carga los del periodo nuevo,
  - guarda un **acta en PDF** (quién pasó, repitió o egresó, en 5to o 6to) que se descarga y queda en *Actas anteriores*,
  - avisa a cada estudiante.
- El año escolar actual queda guardado en la configuración (`anio_escolar_actual`).
  Las listas de "Año académico" ya siguen ese año, no el año del calendario.
- **Deshacer el último cierre** (si se hizo por error o en una prueba): en **Cierre de periodo** aparece el bloque
  **Deshacer el último cierre**. Pide contraseña + clave de seguridad + escribir **DESHACER**. Cada estudiante vuelve a su
  sección de antes (los que egresaron vuelven a estar activos), el periodo vuelve al anterior, los carnets de antes vuelven a
  servir (los del periodo nuevo se anulan), los horarios archivados vuelven y las secciones que creó el cierre se borran si
  siguen vacías. El acta queda como PDF en `respaldos_bd/` y sale del historial. No toca asistencia, justificaciones ni calendario.
  Si hubo varios cierres seguidos, el bloque muestra el anterior y se puede deshacer también. Antes de cambiar nada guarda un respaldo.
  Desde ahora el cierre guarda lo necesario para deshacerlo exacto; para cierres viejos usa el respaldo automático
  "Antes del cierre de periodo" de `respaldos_bd/`. También se puede desde la consola: `node deshacer_cierre.js`.

## Si se pierde la contraseña del director o la clave de seguridad

- **Contraseña del director:** en el login, **¿Olvidó su contraseña?** → escribir la cédula o el correo del director →
  le llega un **código de 6 números** al correo → código + contraseña nueva (dos veces). El código vence en 15 minutos,
  sirve una sola vez, 5 intentos fallidos lo anulan y se pueden pedir 3 códigos cada 15 minutos.
  Profesores y estudiantes siguen igual: la dirección les pone una clave temporal (Usuarios > Editar).
- **Clave de seguridad** (la de pasar de año): **Configuración > ¿Olvidó la clave de seguridad?** → su contraseña de entrada →
  código al correo → clave nueva (mínimo 8, distinta a la contraseña). La anterior deja de servir.
- **Si el correo no llega** (o no está configurado, como en la prueba local): quien maneja el servidor corre
  `node recuperar_acceso.js` y elige 1) contraseña nueva para el director, o 2) quitar la clave de seguridad
  (después se crea otra en Configuración). También: `node recuperar_acceso.js --clave=NuevaClave` o `--quitar-clave-seguridad`.
  Para la web se corre con el `.env` que apunta a la base de Clever Cloud.

## Limpiar la base (empezar con datos reales)

`node limpiar_bd.js` deja solo las **cuentas de usuario**, las **secciones**, la **configuración** y la lista de groserías.
Muestra qué va a borrar y pide escribir **LIMPIAR**. Antes guarda un respaldo, deshace los cierres de periodo que pueda y luego
borra: inscripciones de estudiantes, asignaciones y horarios de profesores, asistencia, justificaciones (y sus archivos),
calendario, avisos, carnets y fotos, lecturas de carnets, cierres, clases no dadas y suplencias. El periodo queda en el de hoy
(2026-2027). Después se asignan otra vez estudiantes, profesores y horarios.
Las herramientas de consola anotan lo que hacen en `respaldos_bd/herramientas.log`.

## Clases del día: clase no dada y suplente

Para cuando el profesor no va a clase. **Asistencia > Clases del día** (arriba de la tabla) muestra
cada clase del día con su estado: *Por empezar*, *En curso*, *Sin lista* (ya terminó y nadie pasó lista),
*Lista pasada*, *No dada* o *Programada* (día que viene). Se puede elegir otro **Día** en ese panel
(también uno que viene, para dejar el suplente listo).

- **No dada:** el director elige el motivo (Profesor ausente, Reposo médico, Actividad de la institución,
  Falla de servicios u *Otro*, que pide escribirlo). Esa clase **no cuenta como falta** para nadie,
  los estudiantes y el profesor reciben un aviso, el profesor ya no puede pasar lista ni escanear,
  y en el reporte del mes ese día sale **ND** (gris). En el PDF/Excel del día sale "CLASE NO DADA".
  Si al final sí se dio: **Quitar no dada** y el profesor vuelve a poder pasar lista.
  No se puede marcar una clase que ya tiene lista guardada.
- **Suplente:** el director elige otro profesor. Solo salen los profesores **libres a esa hora**
  (sin clase propia ni otra suplencia). El suplente recibe un aviso con el enlace, en su **Inicio**
  le sale el bloque **Suplencias** con el botón **Pasar lista**, y en la lista dice "Usted es suplente de ...".
  Lo que marca queda en la clase del titular (sale en el reporte del titular). Se puede **Cambiar** o
  **Quitar** el suplente (al anterior le llega "Suplencia cancelada"). Solo para hoy o días que vienen.
- **Aviso de listas pendientes:** en el **Dashboard** del director, la tarjeta **Clases de hoy** dice cuántas
  van con lista y cuáles están en curso o ya terminaron **sin lista** (se actualiza cada 5 minutos).

Archivos: `routes/clases.js`, `lib/clases.js` (nuevos); `lib/migraciones.js`, `server.js`,
`routes/profesores.js`, `routes/asistencia.js`, `js/asistencia_director.js`, `js/pasar_lista.js`,
`js/profesor_dashboard.js`, `js/profesor_reportes.js`, `js/lista_export.js`, `js/dialogo.js`,
`css/responsive.css`, `interfaces/director/asistencia.html`, `interfaces/director/index.html`,
`interfaces/profesor/index.html`, `interfaces/profesor/pasar_lista.html`, `interfaces/profesor/reportes.html`.

## Revisión general (prueba de todas las pantallas)

Se probaron las 29 pantallas (director, profesor y estudiante) en computadora y celular, los permisos de
las 91 rutas con cada rol y los flujos completos (registro, pasar lista, justificar, aprobar/rechazar,
feriados, días pasados, desactivar, perfil, horarios, calendario, carnets, turnos, cierre de periodo, clase no dada y suplentes).
Se corrigió:

- **Registro:** si el correo con el código no sale, ahora lo dice claro y abre la ventana del código con
  "Reenviar código" (antes decía "Error al registrar" y no dejaba seguir). Igual al cambiar el correo en Mi perfil.
- **Registro:** si la dirección ya cargó el nombre y apellido, el registro no los cambia (son los oficiales).
  El estudiante tampoco puede cambiar su nombre desde Mi perfil (su pantalla no lo permite).
- **Login sin confirmar el correo:** explica qué hacer para recibir otro código.
- **Pasar lista:** muestra la hora de la clase y desde qué hora cuenta como Tarde (inicio + tolerancia),
  igual que el escaneo del carnet. La "Hora límite de entrada" de Configuración queda solo para clases sin horario.
- **Calendario:** el profesor y el estudiante ven los eventos generales y los de sus secciones
  (ya no los de otras secciones). El panel del estudiante también.
- **Usuarios:** la columna Faltas cuenta solo el periodo escolar actual (antes sumaba años anteriores).
- **Panel del estudiante:** su sección se muestra con el turno.
- **Calendario del profesor:** los botones de mes anterior/siguiente tienen nombre para lectores de pantalla.

## Arreglos de seguridad (venían de antes)

- Un profesor o estudiante podía cambiar roles (hacerse director) y pre-registrar cuentas: ahora solo el director.
- Cualquiera con sesión podía ver o cambiar el perfil y la clave de otro: ahora solo el dueño.
- El cambio de correo se confirma con el correo guardado en el servidor, no con el que manda el navegador.
- Entrar con la cédula de alguien pre-registrado daba "Error del servidor": ahora dice que cree su cuenta.
- Poner mal la contraseña actual (en Mi perfil) cerraba la sesión: ya no.
- La foto se revisa por dentro (que de verdad sea JPG/PNG/WEBP), máximo 1 MB.
- Consultas arregladas para MySQL 8 estricto (ONLY_FULL_GROUP_BY), que hacían fallar el arranque.
- El calendario del profesor pedía datos solo del director (error 403 en la consola): arreglado.

## Archivos nuevos

- `routes/carnets.js`, `routes/promocion.js`, `routes/clases.js`
- `lib/deshacer_cierre.js`, `lib/codigos.js`, `lib/correo.js`, `lib/registro.js`, `lib/consola.js`, `lib/https_local.js`
- Herramientas de consola: `deshacer_cierre.js`, `recuperar_acceso.js`, `limpiar_bd.js`
- `lib/carnet.js`, `lib/periodo.js`, `lib/intentos.js`, `lib/clases.js`
- `interfaces/director/carnets.html`, `interfaces/director/cierre_periodo.html`
- `js/carnet_qr.js`, `js/carnet_director.js`, `js/carnets_seccion.js`, `js/escaner_qr.js`,
  `js/exportar.js`, `js/lista_export.js`, `js/cierre_periodo.js`
- `js/vendor/qrcode.js` (qrcode-generator, MIT), `js/vendor/jsQR.js` (jsQR, Apache 2.0) y su licencia
- `css/escudo_pdf.jpg` (escudo para los PDF)

No hace falta `npm install`: no se agregó ninguna dependencia.

---

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
- El menú lateral de todas las pantallas muestra el escudo y "U.E. Instituto Elena de Bueno" (antes decía "Sistema" con un ícono de edificio).
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
- Arreglos del 12/11/2026 para teléfono:
  - Las tablas que se vuelven tarjetas muestran el **nombre de cada dato** (Cédula, Sección, Hora...) a la izquierda
    y el valor a la derecha (lo pone `js/sesion.js` solo, también en tablas que se cargan después).
  - **Horarios** del director: cada clase es una tarjeta con Sección, Materia, Día, Hora, Aula y botones.
  - Encabezado: fecha, modo oscuro y campana en una fila sin apretarse.
  - Botones de acciones rápidas en dos columnas; filtros a lo ancho; calendario con Anterior / Hoy / Siguiente en una fila.
  - Reportes del profesor: las tarjetas de números de dos en dos.
  - Login: botón del ojo y enlaces más fáciles de tocar.
  - Panel de escaneo en una columna.
  - Probado en 360px y 412px: ninguna pantalla se sale ni tapa nada.
- Los íconos (Boxicons) ahora están dentro del proyecto (`css/vendor/boxicons`), así funcionan sin internet. Se quitaron todos los emojis.

## Hora límite de entrada
- Se muestra al profesor al pasar lista ("quien llegue después: Tarde").

## Sesión y permisos
- Si una pantalla pide entrar (sesión vencida o dirección nueva), después de entrar **vuelve a esa misma pantalla**
  (solo pantallas del sistema y del rol del usuario).
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
- Si la **hora fin** queda antes de la de inicio, sale un aviso rojo debajo de las horas y, al guardar, una ventana
  que lo explica. Si eligió **12:00 AM** (medianoche) en una clase de la mañana, pregunta "¿Quiso decir 12:00 PM?"
  y lo arregla con un toque.
- Los errores al guardar (choques, turno) salen en una ventana, no arriba de la página donde no se veían.
- Los mensajes de "guardado" en todas las pantallas flotan arriba y se ven aunque la página esté bajada.
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
