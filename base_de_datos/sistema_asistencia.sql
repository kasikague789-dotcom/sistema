-- MariaDB dump 10.19  Distrib 10.11.14-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: sistema_asistencia
-- ------------------------------------------------------
-- Server version	10.11.14-MariaDB-0ubuntu0.24.04.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `sistema_asistencia`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `sistema_asistencia` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci */;

USE `sistema_asistencia`;

--
-- Table structure for table `asistencia`
--

DROP TABLE IF EXISTS `asistencia`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `asistencia` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) NOT NULL,
  `curso_id` int(11) NOT NULL DEFAULT 0,
  `materia` varchar(100) NOT NULL DEFAULT '',
  `profesor_id` int(11) DEFAULT NULL,
  `fecha` date NOT NULL,
  `hora_entrada` time NOT NULL,
  `hora_salida` time DEFAULT NULL,
  `estado` varchar(20) DEFAULT 'presente',
  `latitud` decimal(10,8) DEFAULT NULL,
  `longitud` decimal(11,8) DEFAULT NULL,
  `dispositivo` varchar(50) DEFAULT NULL,
  `observaciones` text DEFAULT NULL,
  `justificacion_id` int(11) DEFAULT NULL,
  `estado_previo` varchar(20) DEFAULT NULL,
  `modificado_por` int(11) DEFAULT NULL,
  `fecha_modificacion` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `fecha_registro` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_asistencia_clase` (`usuario_id`,`fecha`,`curso_id`,`materia`),
  KEY `fk_asistencia_usuario` (`usuario_id`),
  KEY `fk_asistencia_modificador` (`modificado_por`),
  KEY `idx_asistencia_clase` (`curso_id`,`materia`,`fecha`),
  KEY `idx_asistencia_justificacion` (`justificacion_id`),
  CONSTRAINT `fk_asistencia_modificador` FOREIGN KEY (`modificado_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_asistencia_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `asistencia`
--

LOCK TABLES `asistencia` WRITE;
/*!40000 ALTER TABLE `asistencia` DISABLE KEYS */;
/*!40000 ALTER TABLE `asistencia` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `calendario_academico`
--

DROP TABLE IF EXISTS `calendario_academico`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendario_academico` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `titulo` varchar(200) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `tipo_evento` varchar(20) NOT NULL,
  `afecta_asistencia` tinyint(1) DEFAULT 1,
  `color_evento` varchar(7) DEFAULT '#FF0000',
  `creado_por` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_calendario_creador` (`creado_por`),
  CONSTRAINT `fk_calendario_creador` FOREIGN KEY (`creado_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calendario_academico`
--

LOCK TABLES `calendario_academico` WRITE;
/*!40000 ALTER TABLE `calendario_academico` DISABLE KEYS */;
/*!40000 ALTER TABLE `calendario_academico` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `configuracion_sistema`
--

DROP TABLE IF EXISTS `configuracion_sistema`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `configuracion_sistema` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `clave` varchar(50) NOT NULL,
  `valor` text DEFAULT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `clave` (`clave`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `configuracion_sistema`
--

LOCK TABLES `configuracion_sistema` WRITE;
/*!40000 ALTER TABLE `configuracion_sistema` DISABLE KEYS */;
INSERT INTO `configuracion_sistema` VALUES
(1,'hora_entrada','08:00','Hora límite de entrada'),
(2,'porcentaje_asistencia_minimo','85','Porcentaje mínimo de asistencia'),
(3,'dias_maximos_justificar','3','Plazo en días para enviar una justificación después de la falta'),
(4,'palabra','ZORRA',NULL),
(5,'nivel','muy_grave',NULL),
(6,'reemplazo','*****',NULL),
(7,'agregar_groseria','',NULL),
(8,'notificaciones_activas','true',NULL),
(9,'permitir_edicion_asistencia','true',NULL),
(10,'filtro_groserias_activo','true',NULL),
(14,'version_bd','2026-11','Versión de la base de datos (no editar)');
/*!40000 ALTER TABLE `configuracion_sistema` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `cursos`
--

DROP TABLE IF EXISTS `cursos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cursos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(50) NOT NULL,
  `nivel` varchar(20) DEFAULT NULL,
  `seccion` varchar(10) DEFAULT NULL,
  `anio_escolar` year(4) DEFAULT NULL,
  `activo` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cursos`
--

LOCK TABLES `cursos` WRITE;
/*!40000 ALTER TABLE `cursos` DISABLE KEYS */;
INSERT INTO `cursos` VALUES
(1,'1er Grado','Primaria','A',2026,1),
(2,'1er Grado','Primaria','B',2026,1),
(3,'2do Grado','Primaria','A',2026,1),
(4,'2do Grado','Primaria','B',2026,1),
(5,'3er Grado','Primaria','A',2026,1),
(6,'3er Grado','Primaria','B',2026,1),
(7,'4to Grado','Primaria','A',2026,1),
(8,'4to Grado','Primaria','B',2026,1),
(9,'5to Grado','Primaria','A',2026,1),
(10,'5to Grado','Primaria','B',2026,1),
(11,'6to Grado','Primaria','A',2026,1),
(12,'6to Grado','Primaria','B',2026,1),
(13,'1er Año','Media','A',2026,1),
(14,'1er Año','Media','B',2026,1),
(15,'2do Año','Media','A',2026,1),
(16,'2do Año','Media','B',2026,1),
(17,'3er Año','Media','A',2026,1),
(18,'3er Año','Media','B',2026,1),
(19,'4to Año','Media','A',2026,1),
(20,'4to Año','Media','B',2026,1),
(21,'5to Año','Media','A',2026,1),
(22,'5to Año','Media','B',2026,1),
(23,'6to Año','Téc. Medio','A',2026,1),
(24,'6to Año','Téc. Medio','B',2026,1);
/*!40000 ALTER TABLE `cursos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `estudiante_curso`
--

DROP TABLE IF EXISTS `estudiante_curso`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estudiante_curso` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estudiante_id` int(11) NOT NULL,
  `curso_id` int(11) NOT NULL,
  `anio_academico` year(4) NOT NULL,
  `activo` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `fk_ec_estudiante` (`estudiante_id`),
  KEY `fk_ec_curso` (`curso_id`),
  CONSTRAINT `fk_ec_curso` FOREIGN KEY (`curso_id`) REFERENCES `cursos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ec_estudiante` FOREIGN KEY (`estudiante_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `estudiante_curso`
--

LOCK TABLES `estudiante_curso` WRITE;
/*!40000 ALTER TABLE `estudiante_curso` DISABLE KEYS */;
INSERT INTO `estudiante_curso` VALUES
(18,20,1,2026,1),
(19,21,1,2026,1);
/*!40000 ALTER TABLE `estudiante_curso` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `filtro_groserias`
--

DROP TABLE IF EXISTS `filtro_groserias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `filtro_groserias` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `palabra` varchar(50) NOT NULL,
  `nivel` varchar(20) DEFAULT 'moderado',
  `reemplazo` varchar(50) DEFAULT '***',
  `activo` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `palabra` (`palabra`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `filtro_groserias`
--

LOCK TABLES `filtro_groserias` WRITE;
/*!40000 ALTER TABLE `filtro_groserias` DISABLE KEYS */;
INSERT INTO `filtro_groserias` VALUES
(1,'mierda','grave','*****',1),
(2,'verga','grave','*****',1),
(3,'coño','grave','****',1),
(4,'carajo','grave','******',1),
(5,'puta','grave','****',1),
(6,'idiota','moderado','******',1),
(7,'estupido','moderado','********',1),
(8,'tonto','leve','*****',1),
(9,'bobo','leve','****',1),
(10,'pendejo','moderado','*******',1),
(11,'maldito','moderado','***',1);
/*!40000 ALTER TABLE `filtro_groserias` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `horarios_clase`
--

DROP TABLE IF EXISTS `horarios_clase`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `horarios_clase` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `profesor_id` int(11) NOT NULL,
  `curso_id` int(11) NOT NULL,
  `dia_semana` enum('Lunes','Martes','Miércoles','Jueves','Viernes','Sábado') NOT NULL,
  `hora_inicio` time NOT NULL,
  `hora_fin` time NOT NULL,
  `aula` varchar(20) DEFAULT NULL,
  `materia` varchar(100) DEFAULT NULL,
  `activo` tinyint(1) DEFAULT 1,
  `fecha_creacion` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_profesor` (`profesor_id`),
  KEY `idx_curso` (`curso_id`),
  KEY `idx_dia` (`dia_semana`),
  CONSTRAINT `fk_horario_curso` FOREIGN KEY (`curso_id`) REFERENCES `cursos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_horario_profesor` FOREIGN KEY (`profesor_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=63 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `horarios_clase`
--

LOCK TABLES `horarios_clase` WRITE;
/*!40000 ALTER TABLE `horarios_clase` DISABLE KEYS */;
INSERT INTO `horarios_clase` VALUES
(62,19,1,'Lunes','08:00:00','09:30:00','PRUEBA','Matemática',1,'2026-11-04 15:46:23');
/*!40000 ALTER TABLE `horarios_clase` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `justificaciones`
--

DROP TABLE IF EXISTS `justificaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `justificaciones` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) NOT NULL,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `tipo_justificacion` enum('medica','personal','familiar','deportiva','academica','otra') NOT NULL,
  `descripcion` text DEFAULT NULL,
  `documento_url` varchar(255) DEFAULT NULL,
  `archivo_nombre` varchar(255) DEFAULT NULL,
  `archivo_tipo` varchar(100) DEFAULT NULL,
  `archivo_tamano` int(11) DEFAULT NULL,
  `estado` enum('pendiente','aprobada','rechazada','revision') DEFAULT 'pendiente',
  `aprobado_por` int(11) DEFAULT NULL,
  `fecha_aprobacion` datetime DEFAULT NULL,
  `observaciones_director` text DEFAULT NULL,
  `dias_justificados` int(11) DEFAULT NULL,
  `fecha_registro` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_usuario` (`usuario_id`),
  KEY `idx_estado` (`estado`),
  KEY `idx_fechas` (`fecha_inicio`,`fecha_fin`),
  KEY `fk_justificacion_aprobador` (`aprobado_por`),
  CONSTRAINT `fk_justificacion_aprobador` FOREIGN KEY (`aprobado_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_justificacion_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `justificaciones`
--

LOCK TABLES `justificaciones` WRITE;
/*!40000 ALTER TABLE `justificaciones` DISABLE KEYS */;
/*!40000 ALTER TABLE `justificaciones` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notificaciones`
--

DROP TABLE IF EXISTS `notificaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notificaciones` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) NOT NULL,
  `titulo` varchar(150) NOT NULL,
  `mensaje` varchar(500) DEFAULT NULL,
  `enlace` varchar(255) DEFAULT NULL,
  `leida` tinyint(1) NOT NULL DEFAULT 0,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notif_usuario` (`usuario_id`,`leida`),
  CONSTRAINT `fk_notif_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notificaciones`
--

LOCK TABLES `notificaciones` WRITE;
/*!40000 ALTER TABLE `notificaciones` DISABLE KEYS */;
/*!40000 ALTER TABLE `notificaciones` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `profesor_curso`
--

DROP TABLE IF EXISTS `profesor_curso`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `profesor_curso` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `profesor_id` int(11) NOT NULL,
  `curso_id` int(11) NOT NULL,
  `materia` varchar(100) DEFAULT NULL,
  `anio_academico` year(4) NOT NULL,
  `activo` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `fk_pc_profesor` (`profesor_id`),
  KEY `fk_pc_curso` (`curso_id`),
  CONSTRAINT `fk_pc_curso` FOREIGN KEY (`curso_id`) REFERENCES `cursos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_pc_profesor` FOREIGN KEY (`profesor_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `profesor_curso`
--

LOCK TABLES `profesor_curso` WRITE;
/*!40000 ALTER TABLE `profesor_curso` DISABLE KEYS */;
INSERT INTO `profesor_curso` VALUES
(19,19,1,'Matemática',2026,1);
/*!40000 ALTER TABLE `profesor_curso` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `usuarios`
--

DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cedula` varchar(20) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `apellido` varchar(100) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `telefono` varchar(15) DEFAULT NULL,
  `rol` varchar(20) NOT NULL,
  `password` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) DEFAULT 1,
  `theme_preference` varchar(10) DEFAULT 'light',
  `fecha_registro` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `cedula` (`cedula`)
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `usuarios`
--

LOCK TABLES `usuarios` WRITE;
/*!40000 ALTER TABLE `usuarios` DISABLE KEYS */;
INSERT INTO `usuarios` VALUES
(18,'10000000','Super','Administrador','admin@elenadebueno.local','','director','$2b$10$riPTp1paFTklTyVDRvJ2MuISBa5uymug0Xy1gZXx3tuJ4Fo.RWEfO',1,'light','2026-11-04 15:46:23'),
(19,'20000001','Profesor','Prueba','profesor@prueba.local','','profesor','$2b$10$P4h9InY0bv11CrxwFjnl0.ep5FtT3TB.32eWxdqZjOTrM60/vTEay',1,'light','2026-11-04 15:46:23'),
(20,'30000001','Estudiante','Uno','estudiante1@prueba.local','','estudiante','$2b$10$DWoyN5odJHbxxLsD31SF9usUQgN3aX1k90uH4zdSBqDxavNq9MoCm',1,'light','2026-11-04 15:46:23'),
(21,'30000002','Estudiante','Dos','estudiante2@prueba.local','','estudiante','$2b$10$FrUpTR54LT39iampEE7Wvuxs.nisNzhiUt1Rj7ajIviVfUNcVX5Fm',1,'light','2026-11-04 15:46:23');
/*!40000 ALTER TABLE `usuarios` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-04 11:46:35
