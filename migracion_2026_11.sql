-- =====================================================================
-- Migración: asistencia por clase + limpieza de datos + notificaciones
-- NO hace falta ejecutarla a mano: el servidor (node server.js) la aplica
-- sola la primera vez y antes guarda un respaldo en la carpeta respaldos_bd.
-- (Si prefiere, también puede ejecutarla en phpMyAdmin, pestaña SQL.)
-- =====================================================================

-- 1) Asistencia por clase: ahora cada registro dice de qué sección y materia es.
--    Antes había un solo estado por estudiante por día, y el segundo profesor
--    que pasaba lista borraba lo que marcó el primero.
ALTER TABLE `asistencia`
  ADD COLUMN `curso_id` INT NOT NULL DEFAULT 0 AFTER `usuario_id`,
  ADD COLUMN `materia` VARCHAR(100) NOT NULL DEFAULT '' AFTER `curso_id`,
  ADD COLUMN `profesor_id` INT NULL AFTER `materia`,
  ADD COLUMN `justificacion_id` INT NULL AFTER `observaciones`,
  ADD COLUMN `estado_previo` VARCHAR(20) NULL AFTER `justificacion_id`;

-- 2) Un solo nombre para cada estado (antes había "Justificada" y "justificada")
UPDATE `asistencia` SET `estado` = LOWER(TRIM(`estado`));
UPDATE `asistencia` SET `estado` = 'justificada' WHERE `estado` = 'justificado';

-- 3) Cada estudiante en UNA sola sección activa (se deja la más reciente).
--    Había estudiantes activos en 2 o 3 secciones a la vez.
UPDATE `estudiante_curso` ec
  JOIN (SELECT `estudiante_id`, MAX(`id`) AS max_id
          FROM `estudiante_curso` WHERE `activo` = 1 GROUP BY `estudiante_id`) m
    ON ec.`estudiante_id` = m.`estudiante_id`
   SET ec.`activo` = 0
 WHERE ec.`activo` = 1 AND ec.`id` <> m.max_id;

-- 4) Los registros viejos quedan como "registro general del día" en la
--    sección actual del estudiante.
UPDATE `asistencia` a
  JOIN `estudiante_curso` ec ON ec.`estudiante_id` = a.`usuario_id` AND ec.`activo` = 1
   SET a.`curso_id` = ec.`curso_id`
 WHERE a.`curso_id` = 0;

-- 5) Quitar registros repetidos (mismo estudiante, día y clase) y prohibirlos
DELETE a1 FROM `asistencia` a1
  JOIN `asistencia` a2
    ON a1.`usuario_id` = a2.`usuario_id` AND a1.`fecha` = a2.`fecha`
   AND a1.`curso_id` = a2.`curso_id` AND a1.`materia` = a2.`materia`
   AND a1.`id` < a2.`id`;

ALTER TABLE `asistencia`
  ADD UNIQUE KEY `uq_asistencia_clase` (`usuario_id`, `fecha`, `curso_id`, `materia`),
  ADD KEY `idx_asistencia_clase` (`curso_id`, `materia`, `fecha`),
  ADD KEY `idx_asistencia_justificacion` (`justificacion_id`);

-- 6) La "clave de relleno" se trataba como cuenta sin crear y permitía que
--    cualquiera con la cédula se quedara con la cuenta (incluida la del director).
--    Estudiantes y profesores: quedan sin clave y crean su cuenta en "Regístrese aquí".
--    Directores: su clave se pone con:  node cambiar_clave.js <correo> <clave nueva>
UPDATE `usuarios` SET `password` = NULL
 WHERE `password` = '$2a$10$wT0.4.3wB3yG9hX7m7O7Oe5V4Z3y2x1w0v9u8t7s6r5q4p3o2n1m'
   AND `rol` <> 'director';

-- 7) Justificaciones con estado vacío pasan a pendiente
UPDATE `justificaciones` SET `estado` = 'pendiente' WHERE `estado` = '' OR `estado` IS NULL;

-- 8) Los eventos que no son feriado/asueto/vacaciones ya no suspenden clases
UPDATE `calendario_academico` SET `afecta_asistencia` = 0
 WHERE `tipo_evento` NOT IN ('feriado', 'asueto', 'vacaciones');

-- 9) Notificaciones dentro del sistema (campana en cada panel)
CREATE TABLE IF NOT EXISTS `notificaciones` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `usuario_id` INT NOT NULL,
  `titulo` VARCHAR(150) NOT NULL,
  `mensaje` VARCHAR(500) DEFAULT NULL,
  `enlace` VARCHAR(255) DEFAULT NULL,
  `leida` TINYINT(1) NOT NULL DEFAULT 0,
  `fecha` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_notif_usuario` (`usuario_id`, `leida`),
  CONSTRAINT `fk_notif_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 9b) Horarios imposibles (terminan antes de empezar) se desactivan
UPDATE `horarios_clase` SET `activo` = 0 WHERE `hora_fin` <= `hora_inicio`;

-- 10) Texto de ayuda de la configuración (ahora se usa como plazo)
UPDATE `configuracion_sistema`
   SET `descripcion` = 'Plazo en días para enviar una justificación después de la falta'
 WHERE `clave` = 'dias_maximos_justificar';
INSERT IGNORE INTO `configuracion_sistema` (`clave`, `valor`) VALUES
  ('notificaciones_activas', 'true'),
  ('permitir_edicion_asistencia', 'true'),
  ('filtro_groserias_activo', 'true');
