# EP-EMA — Sistema de Gestión Operativa, Catastro y Control de Asistencia

> **Empresa Pública – Empresa Municipal Mercado Mayorista de Ambato (EP-EMA)**  
> Plataforma tecnológica institucional para la administración integral de naves comerciales, catastro de comerciantes, planificación espacial mediante croquis modulares, control diario de asistencias con persistencia selectiva, auditoría operativa en tiempo real, gestión de contingencias de supervisión y persistencia relacional transaccional de alta concurrencia en MySQL 8.0.

---

## 1. Encabezado e Identidad Institucional

El **Sistema de Gestión EP-EMA** es una solución digital integral de grado empresarial diseñada para modernizar, automatizar y transparentar la operación diaria del Mercado Mayorista de Ambato. La plataforma unifica la toma de listas en campo, la supervisión de jornales, la administración del catastro comercial, la delimitación arquitectónica del espacio físico de las naves, la certificación de puestos vacantes y la auditoría operativa continua bajo un esquema de alta concurrencia y máxima tolerancia a fallos.

```text
====================================================================================================
               EMPRESA PÚBLICA MUNICIPAL MERCADO MAYORISTA DE AMBATO (EP-EMA)
                   SISTEMA DE GESTIÓN OPERATIVA, CATASTRO Y ASISTENCIA
====================================================================================================
     [ Listas & Campo ]       [ Naves & Croquis ]       [ Catastro & Rentas ]      [ Auditoría & Logs ]
     - Toma diaria 02:00 AM   - Planos vectoriales      - Reconciliación 4 pasos   - Sesiones inmutables
     - Persistencia selectiva - Cupos y vacantes        - Bodegas / Puestos / ZCF  - Cola async a disco
     - Justificación faltas   - Certificación oficial   - Reglas Nave P / Ambul.   - Rotación 5 MB
====================================================================================================
```

### Estado de Madurez del Proyecto

| Dimensión Operativa | Estado Actual | Madurez | Alcance y Cobertura Técnica |
| :--- | :---: | :---: | :--- |
| **Arquitectura Hexagonal Pura** | **Completado y Auditado** | **100%** | Desacoplamiento estricto de 4 capas: Dominio 100% puro (0 dependencias), Aplicación orquestadora basada en puertos, e Infraestructura con 6 adaptadores relacionales hacia MySQL 8.0 vía Prisma ORM. |
| **Seguridad Perimetral y RBAC Multi-Tenant** | **Completado y Verificado** | **100%** | Proxy server-side (`src/proxy.ts`), autenticación JWT (`jose`) mediante cookies `HttpOnly`, aislamiento multi-tenant por naves para supervisores, protección anti-IDOR y mitigación CSPRNG. |
| **Motor de Conciliación Catastral** | **Completado y Optimizado** | **100%** | Algoritmo determinista en 4 pasos con modo `UNIFICAR` automático para plantillas `REN04_950` (Bodegas), `ren04278` (Puestos) y `GENERICO`, sanitización multilínea, filtro de duplicados 100%, y reglas exclusivas para `NAVE P` y `AMBULANTES`. |
| **Alta Concurrencia y Resiliencia** | **Completado y Certificado** | **100%** | Connection pool optimizado (`connection_limit=15`, `pool_timeout=15`, `connect_timeout=10`), deduplicación de promesas en vuelo (*Singleflight*), caché de sesión reactiva, logging centralizado en disco (`logs/ep-ema-system.log`) y fallback visual de conexión. |
| **Exportación Documental Bimodal** | **Completado y Validado** | **100%** | Generación simétrica de actas e informes: reportes PDF vectoriales de alta precisión (`jsPDF` + `autotable`) y libros de cálculo nativos multi-hoja (`ExcelJS 4.4.0`) con autoajuste multi-fila y preservación de simbología. |

---

## 2. Arquitectura Hexagonal Pura (Ports & Adapters)

El sistema aplica de forma rigurosa los principios de la **Arquitectura Hexagonal**. Esta estructura asegura que la lógica y las entidades del negocio permanezcan completamente aisladas de los motores de persistencia, bibliotecas externas y frameworks de interfaz gráfica.

```text
                            ┌───────────────────────────────────────────────┐
                            │          CAPA DE PRESENTACIÓN (UI)            │
                            │  Next.js App Router (src/app / src/components)│
                            └──────────────────────┬────────────────────────┘
                                                   │ (invoca exclusivamente)
                                                   ▼
                            ┌───────────────────────────────────────────────┐
                            │             CAPA DE APLICACIÓN                │
                            │      Casos de Uso / Servicios de Dominio      │
                            │            (src/application/services)         │
                            └──────────────┬──────────────────┬─────────────┘
                                           │                  │
                (implementa adaptadores)   │                  │ (depende de puertos)
                                           ▼                  ▼
┌───────────────────────────────────────────────┐   ┌───────────────────────────────────────────────┐
│            CAPA DE INFRAESTRUCTURA            │   │               CAPA DE DOMINIO                 │
│ Adaptadores MySQL 8.0 / Prisma ORM            │──▶│   Modelos Puros y Contratos de Puertos        │
│ 27 Route Handlers (/api/v1/*) / Parsers Excel │   │             (src/domain/models & ports)       │
│ Logging en Disco / Proxy Perimetral           │   │            (CERO DEPENDENCIAS EXTERNAS)       │
│             (src/infrastructure)              │   │                                               │
└───────────────────────────────────────────────┘   └───────────────────────────────────────────────┘
```

### Organización de las 4 Capas en `src/`

1. **Capa de Dominio (`src/domain/`):**
   - **Modelos Puros (`src/domain/models/`):** Entidades de negocio libres de librerías (`usuario.model.ts`, `nave.model.ts`, `comerciante.model.ts`, `asistencia.model.ts`, `auditoria.model.ts`). **Poseen cero (0) imports hacia capas externas**.
   - **Puertos del Dominio (`src/domain/ports/`):** Interfaces abstractas que declaran las operaciones requeridas por la aplicación (`IUsuarioRepository`, `INaveRepository`, `IComercianteRepository`, `IAsistenciaRepository`, `IAuditoriaRepository`, `IImportadorRepository`).
2. **Capa de Aplicación (`src/application/services/`):**
   - Casos de uso institucionales que coordinan el flujo de trabajo (`auth.service.ts`, `usuario.service.ts`, `nave.service.ts`, `comerciante.service.ts`, `asistencia.service.ts`, `auditoria.service.ts`, `importador.service.ts`).
   - Delega la persistencia, la reconciliación y el parseo a través de las interfaces de puertos, interactuando con los adaptadores de infraestructura mediante inyección de dependencias.
3. **Capa de Infraestructura (`src/infrastructure/`):**
   - **Adaptadores de Repositorio (`src/infrastructure/repositories/*.repository.impl.ts`):** Implementaciones concretas de los puertos que interactúan con Prisma ORM, MySQL 8.0 y los Route Handlers internos.
   - **Servicios de Base de Datos (`src/infrastructure/database/`):** Módulos transaccionales de bajo nivel (`prisma.ts`, `catastro-reconciliacion.service.ts`, `daily-attendance.service.ts`, `nave-puestos-sync.service.ts`, `calendario-operativo.service.ts`, `sesion-control-helper.ts`).
   - **Seguridad Perimetral (`src/proxy.ts` y `src/infrastructure/auth/`):** Proxy perimetral de Next.js 16 para el control perimetral de `/api/v1/:path*`, gestión de JWT, hashing de credenciales y autorización multi-tenant.
   - **Parsers y Extractores (`src/infrastructure/parsers/`):** Motores especializados de interpretación documental para libros Excel (`catastro-file.parser.ts`) y archivos estructurados multi-nave `.csv` y `.xml` (`catastro-csv-xml.parser.ts`).
   - **Logging Centralizado (`src/infrastructure/logger/`):** Cola asíncrona no bloqueante que vuelca eventos a `logs/ep-ema-system.log`.
4. **Capa de Presentación (`src/app/` y `src/components/`):**
   - Vistas estructuradas bajo Next.js App Router con enfoque integral *Mobile-First*. Prohibida la invocación directa a repositorios o bases de datos; toda interacción transita obligatoriamente por la Capa de Aplicación.

---

### Árbol de Directorios Real del Repositorio

```text
ep-ema-control-catastro/
├── docker-compose.yml                     # Contenedores MySQL 8.0 (3307:3306) y phpMyAdmin (8080)
├── logs/                                  # Almacenamiento local de logs del sistema
│   └── ep-ema-system.log                  # Archivo de registro continuo con rotación a 5 MB
├── prisma/
│   ├── schema.prisma                      # Esquema relacional de 11 modelos con índices de alto rendimiento
│   ├── seed-planos.json                   # Respaldo vectorial de cuadrículas de las 27 naves
│   └── seed.ts                            # Sembrado maestro determinista (SUPERADMIN, 27 naves, planos y catastro)
├── public/                                # Activos institucionales (logos, isotipos, favicon)
├── scripts/                               # Scripts de despliegue y autoarranque en Windows 10 Pro
│   ├── iniciar-produccion.ps1             # Arranque resiliente en segundo plano (puerto 5050)
│   └── registrar-tarea-inicio.ps1         # Registro en Programador de Tareas (Task Scheduler)
├── src/
│   ├── proxy.ts                           # Protección perimetral server-side de rutas API (/api/v1/*)
│   ├── instrumentation.ts                 # Hook institucional de arranque (colación MySQL y auto-asistencia)
│   ├── app/                               # Capa de Presentación y Route Handlers Backend
│   │   ├── (auth)/                        # Módulo de Autenticación
│   │   │   ├── layout.tsx                 # Layout limpio institucional
│   │   │   └── login/page.tsx             # Pantalla de acceso y recuperación de contraseñas
│   │   ├── (panel)/                       # Vistas del Panel Administrativo y Operativo
│   │   │   ├── layout.tsx                 # Shell responsivo con Sidebar y Bottom Navigation
│   │   │   ├── listas/                    # Toma de Listas y Marcación de Asistencia Diaria
│   │   │   │   ├── components/            # Subcomponentes (CroquisAsistenciaView, ModalNovedad, TablaAsistencia)
│   │   │   │   └── page.tsx
│   │   │   ├── reportes/                  # Reportes Operativos Tabulares y Descarga Bimodal
│   │   │   │   ├── components/
│   │   │   │   │   ├── ReportesFiltros.tsx
│   │   │   │   │   ├── ReportesTabla.tsx
│   │   │   │   │   ├── reportes-pdf.utils.ts
│   │   │   │   │   └── reportes-excel.utils.ts
│   │   │   │   └── page.tsx
│   │   │   ├── catastro/                  # Directorio Nominal de Comerciantes y Puestos
│   │   │   │   └── page.tsx
│   │   │   ├── naves/                     # Planificador Espacial, Gestión de Puestos y Vacantes
│   │   │   │   ├── components/
│   │   │   │   │   ├── ModalConfigurarCelda.tsx
│   │   │   │   │   ├── ModalPuestosNave.tsx
│   │   │   │   │   ├── ModalReporteVacantes.tsx
│   │   │   │   │   ├── ModalesCrudNave.tsx
│   │   │   │   │   ├── PlanificadorEspacial.tsx
│   │   │   │   │   ├── plano-nave.utils.ts
│   │   │   │   │   └── reporte-vacantes-pdf.utils.ts
│   │   │   │   └── page.tsx
│   │   │   ├── controlsupervisores/       # Gestión de Jornadas, Días No Laborables y Permisos
│   │   │   │   ├── components/
│   │   │   │   │   ├── ModalDetalleControl.tsx
│   │   │   │   │   ├── ModalDiasNoLaborables.tsx
│   │   │   │   │   ├── ModalPermisosSupervisores.tsx
│   │   │   │   │   ├── ModalReporteSupervisores.tsx
│   │   │   │   │   ├── control-pdf.utils.ts
│   │   │   │   │   └── reporte-supervisores-export.utils.ts
│   │   │   │   └── page.tsx
│   │   │   ├── auditoria/                 # Redirección canónica hacia /controlsupervisores
│   │   │   │   └── page.tsx
│   │   │   ├── ingreso-catastro/          # Importador Heurístico y Reconciliación en 4 Pasos
│   │   │   │   └── page.tsx
│   │   │   └── configuracion/             # Ajustes Generales y Gestión Institucional de Usuarios
│   │   │       ├── usuarios/              # CRUD de Cuentas Institucionales y Asignación de Naves
│   │   │       ├── permisos/              # Vista de roles y capacidades
│   │   │       ├── importacion/           # Parámetros del motor de carga
│   │   │       └── page.tsx
│   │   ├── api/v1/                        # 27 Route Handlers REST Backend
│   │   │   ├── asistencia/                # Asistencia diaria, persistencia, faltas y novedades
│   │   │   │   ├── route.ts               # GET (lectura) y POST (marcación de asistencia)
│   │   │   │   ├── justificar-falta/      # POST justificación retroactiva de ausencias previas
│   │   │   │   ├── observaciones/         # POST y DELETE de novedades, citaciones y notificaciones
│   │   │   │   ├── permisos/              # POST y DELETE de permisos de comerciantes por fechas
│   │   │   │   └── persistencia/          # POST de persistencia selectiva transaccional
│   │   │   ├── auditoria/                 # Monitoreo de jornadas y control operativo
│   │   │   │   ├── dias-no-laborables/    # GET, POST, DELETE de feriados y suspensiones
│   │   │   │   ├── permisos-supervisores/ # GET, POST, DELETE de licencias y coberturas operativas
│   │   │   │   ├── reporte-supervisores/  # GET informe consolidado de jornales de supervisores
│   │   │   │   └── sesiones/              # GET y POST de sesiones de control de toma de listas
│   │   │   ├── auth/                      # Seguridad de credenciales y ciclo de sesión
│   │   │   │   ├── login/                 # POST autenticación y emisión de Cookie JWT HttpOnly
│   │   │   │   ├── logout/                # POST revocación de Cookie de sesión
│   │   │   │   ├── me/                    # GET información de la sesión activa
│   │   │   │   ├── change-password/       # POST cambio de clave con protección anti-IDOR
│   │   │   │   └── forgot-password/       # POST generación CSPRNG y envío de correo Gmail SMTP
│   │   │   ├── catastro/                  # Motor de reconciliación mensual
│   │   │   │   ├── simular/               # POST previsualización analítica en 4 pasos
│   │   │   │   └── importar/              # POST confirmación e inserción por lotes en base de datos
│   │   │   ├── comerciantes/              # Directorio de comerciantes
│   │   │   │   ├── route.ts               # GET listado y POST alta nominal
│   │   │   │   └── [id]/                  # GET detalle, PUT actualización y DELETE baja lógica
│   │   │   ├── naves/                     # Catálogo de infraestructura, planos y puestos
│   │   │   │   ├── route.ts               # GET naves y POST creación de nave
│   │   │   │   ├── reporte-vacantes/      # GET certificación oficial de puestos vacantes y giros
│   │   │   │   └── [id]/                  # GET detalle, PUT actualización y DELETE eliminación
│   │   │   │       ├── plano/             # GET y PUT de matriz vectorial espacial (planoJson)
│   │   │   │       └── puestos/           # GET y PUT renombre atómico individual o masivo
│   │   │   ├── usuarios/                  # Gestión de cuentas institucionales (RBAC)
│   │   │   │   ├── route.ts               # GET catálogo de usuarios y POST alta de colaborador
│   │   │   │   └── [id]/                  # GET detalle, PUT actualización y DELETE baja
│   │   │   │       └── reset-password/    # POST restablecimiento administrativo a clave inicial ${cedula}*
│   │   │   └── system-logs/               # POST receptor silencioso de errores del cliente web
│   │   ├── error.tsx                      # Captura de errores en el ciclo de renderizado React
│   │   ├── global-error.tsx               # Captura perimetral en el layout raíz
│   │   ├── not-found.tsx                  # Vista institucional 404
│   │   ├── globals.css                    # Configuración Tailwind CSS v4 y variables institucionales
│   │   └── layout.tsx                     # Layout base del sistema
│   ├── application/services/              # Casos de Uso / Servicios Orquestadores
│   │   ├── auth.service.ts                # Gestión de sesiones y políticas de contraseñas
│   │   ├── usuario.service.ts             # Administración de usuarios y roles
│   │   ├── nave.service.ts                # Administración de naves, planos y vacantes
│   │   ├── comerciante.service.ts         # Catastro de comerciantes y asignación de puestos
│   │   ├── asistencia.service.ts          # Asistencia diaria, persistencia y novedades
│   │   ├── auditoria.service.ts           # Sesiones de control, feriados y licencias
│   │   └── importador.service.ts          # Orquestador del motor de reconciliación de catastro
│   ├── domain/                            # Capa de Dominio (Modelos Puros y Puertos)
│   │   ├── models/                        # Entidades del negocio (asistencia, usuario, nave, comerciante, auditoria)
│   │   └── ports/                         # Interfaces de repositorios (IAsistenciaRepository, INaveRepository, etc.)
│   ├── infrastructure/                    # Capa de Infraestructura (Adaptadores Concretos)
│   │   ├── auth/                          # Criptografía, tokens JWT, CSPRNG y autorización multi-tenant
│   │   ├── database/                      # 6 Servicios de Base de Datos y Prisma Singleton
│   │   │   ├── prisma.ts                  # Cliente Prisma optimizado con Connection Pool
│   │   │   ├── catastro-reconciliacion.service.ts # Algoritmo de conciliación en 4 pasos y reglas NAVE P / AMBULANTES
│   │   │   ├── daily-attendance.service.ts # Servicio diario de asistencia 02:00 AM y candados en memoria
│   │   │   ├── nave-puestos-sync.service.ts # Sincronización atómica de puestos y colación en español
│   │   │   ├── calendario-operativo.service.ts # Evaluación de feriados y días no laborables
│   │   │   └── sesion-control-helper.ts   # Actualización O(1) de auditoría de supervisores con Single-Flight
│   │   ├── logger/                        # Logging centralizado en disco
│   │   │   └── system-logger.ts           # Cola asíncrona no bloqueante y rotación a 5 MB
│   │   ├── mail/                          # Correo transaccional institucional
│   │   │   └── smtp.service.ts            # Cliente Nodemailer vía Gmail SMTP
│   │   ├── parsers/                       # Interpretación heurística y estructurada de archivos
│   │   │   ├── catastro-file.parser.ts    # Extractor heurístico de plantillas Excel (.xlsx, .xls)
│   │   │   └── catastro-csv-xml.parser.ts # Motor dinámico multi-nave para archivos .csv y .xml
│   │   └── repositories/                  # 6 Implementaciones concretas de repositorios
│   ├── components/ui/                     # Componentes visuales y primitivas de resiliencia
│   │   ├── error-conexion.tsx             # Banner de contingencia por desconexión de MySQL
│   │   ├── error-estado.tsx               # Componente de estado de error visual
│   │   └── ...                            # Primitivas accesibles (button, input, dialog, sonner, etc.)
│   └── lib/                               # Utilidades transversales
│       ├── client-logger.ts               # Captura silenciosa de errores cliente vía POST /api/v1/system-logs
│       ├── error-utils.ts                 # Funciones auxiliares para detección de errores de red y BD
│       └── utils.ts                       # Helpers de clases Tailwind CSS y formateo
├── package.json                           # Manifiesto de dependencias y scripts oficiales (puerto 5050)
├── pnpm-lock.yaml                         # Bloqueo estricto y determinista de versiones
├── tsconfig.json                          # Configuración rigurosa de TypeScript 5
└── README.md                              # Documentación técnica maestra institucional
```

---

## 3. Stack Tecnológico Oficial (100% Código Abierto)

El sistema está construido íntegramente sobre tecnologías abiertas modernas, garantizando independencia tecnológica, máxima compatibilidad y ausencia de costes por licenciamiento propietario:

| Categoría Tecnológica | Herramienta / Librería | Versión Oficial | Propósito y Función en la Plataforma |
| :--- | :--- | :---: | :--- |
| **Framework Full-Stack** | **Next.js (App Router)** | `16.3.2` | Núcleo de la plataforma, renderizado híbrido, compilación Turbopack y Route Handlers backend. |
| **Biblioteca de UI** | **React** | `19.2.8` | Construcción de componentes reactivos y gestión concurrente de estados. |
| **Lenguaje Tipado** | **TypeScript** | `^5` | Tipado estático riguroso en modelos, puertos, servicios y componentes. |
| **Motor de Estilos** | **Tailwind CSS** | `^4` | Sistema de diseño institucional basado en CSS moderno y variables nativas. |
| **Persistencia Relacional** | **MySQL Server** | `8.0` | Base de datos relacional transaccional con soporte nativo para colación `utf8mb4_spanish_ci`. |
| **ORM y Migraciones** | **Prisma ORM** | `6.19.3` | Mapeo objeto-relacional tipado, conexión transaccional y gestión de esquemas. |
| **Generación de Libros Excel** | **ExcelJS** | `4.4.0` | Creación programática de libros `.xlsx` estilizados, bordes finos, paletas y autoajuste multi-fila en `/reportes` y `/controlsupervisores`. |
| **Generación de Documentos PDF**| **jsPDF** + **jspdf-autotable** | `4.2.1` / `5.0.8`| Creación vectorial de croquis espaciales A4, actas de auditoría y reportes tabulares de asistencia. |
| **Parseo de Archivos Tabulares**| **SheetJS (xlsx)** | `0.18.5` | Decodificación rápida de libros de cálculo `.xlsx`, `.xls` y plantillas de catastro. |
| **Seguridad y Tokens JWT** | **jose** | `6.2.12` | Firma criptográfica y verificación perimetral de JSON Web Tokens en cookies `HttpOnly`. |
| **Criptografía de Credenciales**| **bcryptjs** | `3.0.3` | Hashing unidireccional de contraseñas con factor de salado de 10 rondas. |
| **Correo Transaccional** | **Nodemailer** | `10.2.1` | Envío de notificaciones de contraseñas temporales vía SMTP (Google Workspace / Gmail). |
| **Manipulación de Fechas** | **date-fns** | `4.4.0` | Aritmética de fechas, zonificación en Ecuador (`America/Guayaquil`) y nombres en español. |
| **Sistema de Notificaciones** | **Sonner** | `2.0.8` | Alertas flotantes (toasts) no intrusivas en la interfaz de usuario. |
| **Ejecución y Semillas** | **tsx** | `4.23.15` | Ejecutor de TypeScript en Node.js para sembrado maestro y utilidades de mantenimiento. |
| **Gestor de Paquetes** | **pnpm** | `11.20.0` | Manejador de dependencias rápido, eficiente en almacenamiento y determinista. |

---

## 4. Esquema Relacional de 11 Modelos en Prisma ORM

La base de datos relacional evolucionó desde el esquema inicial de 7 modelos hacia una arquitectura integral de **11 modelos normalizados** dentro de `prisma/schema.prisma`, equipados con índices compuestos estratégicos para soportar consultas concurrentes en submilisegundos:

```text
               ┌──────────────┐             ┌─────────────────────────┐
               │   Usuario    │             │ SesionControlSupervisor │
               └──────┬───────┘             └────────────┬────────────┘
                      │ (supervisa)                      │
                      ▼                                  ▼
               ┌──────────────┐     1:1     ┌─────────────────────────┐
               │     Nave     │────────────▶│        PlanoNave        │
               └──────┬───────┘             └─────────────────────────┘
                      │ 1:N
                      ▼
               ┌──────────────┐     1:1     ┌─────────────────────────┐
               │    Puesto    │◀───────────▶│       Comerciante       │
               └──────────────┘             └────────────┬────────────┘
                                                         │ 1:N
                                                         ▼
                                            ┌─────────────────────────┐
                                            │   RegistroAsistencia    │
                                            └─────────────────────────┘
```

### Detalle Técnico de los 11 Modelos e Índices Compuestos

1. **`Usuario` (`usuarios`):**
   - Gestión de cuentas institucionales, credenciales y roles (`SUPERADMIN`, `TIC`, `DIRECTOR`, `JEFE_OPERATIVO`, `SUPERVISOR`).
   - Campos: `id`, `cedula` (único), `nombres`, `apellidos`, `correo` (único), `rol`, `mustChangePassword`, `passwordHash`, `navesAsignadas` (JSON), `estado` (`Habilitado`, `Deshabilitado`), `creadoEn`, `actualizadoEn`.
2. **`Nave` (`naves`):**
   - Catálogo maestro de pabellones del mercado.
   - Campos: `id`, `nombre` (único, colación `utf8mb4_spanish_ci`), `cantidadPuestos`, `limitePuestos`, `supervisores` (JSON), `estadoRegistro` (`Habilitado`, `Deshabilitado`), `creadoEn`, `actualizadoEn`.
3. **`PlanoNave` (`planos_naves`):**
   - Diagramación vectorial de la nave (relación 1:1 con `Nave`).
   - Campos: `id`, `naveId` (único), `filas`, `columnas`, `planoJson` (matriz de celdas), `actualizadoEn`.
4. **`Puesto` (`puestos`):**
   - Infraestructura física de puestos y locales.
   - Campos: `id`, `codigo`, `naveId`, `estado` (`Ocupado`, `Vacante`), `comercianteId` (relación 1:1 con Comerciante), `creadoEn`, `actualizadoEn`.
   - **Índices de Rendimiento:**
     - `@@index([naveId, codigo])`: búsqueda inmediata de puestos por nave y código normalizado.
     - `@@index([comercianteId])`: resolución directa del titular del puesto.
     - `@@index([naveId])`: agregación de puestos por nave.
     - `@@index([naveId, estado])`: cálculo inmediato de cupos ocupados y vacantes.
5. **`Comerciante` (`comerciantes`):**
   - Catastro nominal de contribuyentes comerciales con soporte de borrado lógico (`eliminadoEn`).
   - Campos: `idInterno`, `ciu`, `cedula`, `contribuyente`, `actividad`, `puestoId`, `nave`, `estadoRegistro` (`Habilitado`, `Deshabilitado`), `eliminadoEn`, `creadoPor`, `modificadoPor`, `deshabilitadoPor`, `creadoEn`, `actualizadoEn`.
   - **Índices de Rendimiento:**
     - `@@index([cedula])` y `@@index([ciu])`: localización directa de contribuyentes.
     - `@@index([estadoRegistro])`: filtrado por comerciantes activos.
     - `@@index([nave, estadoRegistro])`: listados por nave y estado.
     - `@@index([eliminadoEn, nave])` y `@@index([eliminadoEn, estadoRegistro])`: optimización de consultas excluyendo borrados lógicos.
     - `@@index([nave, puestoId])`: resolución de duplicados en la misma nave.
6. **`RegistroAsistencia` (`registros_asistencia`):**
   - Bitácora diaria de asistencias por comerciante.
   - Campos: `id`, `comercianteId`, `puestoId`, `fecha` (`YYYY-MM-DD`), `estado` (`Presente`, `Ausente`, `Permiso`, `Vacante`), `observacion`, `observacionTexto`, `permisoInicio`, `permisoFin`, `observaciones` (JSON), `permisos` (JSON), `creadoEn`, `actualizadoEn`.
   - **Restricción de Unicidad e Índices:**
     - `@@unique([comercianteId, fecha])`: garantiza que un comerciante tenga exactamente un registro por día (idempotencia absoluta).
     - `@@index([fecha])` y `@@index([fecha, estado])`: generación de reportes y auditorías por jornada.
     - `@@index([puestoId])` y `@@index([fecha, puestoId])`: búsqueda por puesto físico.
7. **`SesionControlSupervisor` (`sesiones_control_supervisor`):**
   - Registro inmutable de cada jornada de supervisión efectuada en campo.
   - Campos: `id`, `supervisorId`, `supervisorNombre`, `naveId`, `naveNombre`, `fechaJornada`, `timestampInicio`, `timestampUltimaModificacion`, `accion`, `esPersistencia`, `fechaOrigenPersistencia`, `comentarioPersistencia`, `modificadoTrasPersistencia`, `tieneRetraso`, `detalleRetraso`, `etiquetas` (JSON), `resumen` (JSON), `detallesComerciantes` (JSON).
   - **Índices de Rendimiento:**
     - `@@index([supervisorId])`: consulta de jornales por supervisor.
     - `@@index([supervisorId, fechaJornada])`: verificación de duplicidad de sesión de control.
     - `@@index([naveId])`: historial por nave.
     - `@@index([fechaJornada])` y `@@index([naveId, fechaJornada])`: consulta instantánea $O(1)$ de la sesión activa del día.
8. **`PermisoSupervisor` (`permisos_supervisores`):**
   - Administración de ausencias, licencias médicas y vacaciones de supervisores.
   - Campos: `id`, `supervisorId`, `supervisorNombre`, `fechaInicio`, `fechaFin`, `motivo`, `estado` (`ACTIVO`, `FINALIZADO`, `REVOCADO`), `creadoPorId`, `creadoPorNombre`, `creadoEn`, `actualizadoEn`.
   - **Índices de Rendimiento:**
     - `@@index([supervisorId, estado])`: permisos vigentes por supervisor.
     - `@@index([fechaInicio, fechaFin])`: cruces de calendario y solapamientos de ausencia.
9. **`CoberturaNaveSupervisor` (`coberturas_naves_supervisores`):**
   - Mecanismo de contingencia para la atención de naves ante ausencia del supervisor titular.
   - Campos: `id`, `permisoSupervisorId`, `naveId`, `naveNombre`, `tipoCobertura` (`REEMPLAZO_TEMPORAL`, `PERSISTENCIA_AUTOMATICA`), `supervisorReemplazoId`, `supervisorReemplazoNombre`, `fechaInicio`, `fechaFin`, `motivo`, `estado` (`ACTIVO`, `REVOCADO`).
   - **Índices de Rendimiento:**
     - `@@index([naveId, fechaInicio, fechaFin, estado])`: determinación de la cobertura activa de una nave.
     - `@@index([supervisorReemplazoId, fechaInicio, fechaFin, estado])`: naves delegadas temporalmente a un supervisor reemplazante.
10. **`ReglaDiaNoLaborable` (`reglas_dias_no_laborables`):**
    - Configuración de feriados nacionales, festividades cantonales y suspensiones de jornada de mercado.
    - Campos: `id`, `motivo`, `tipoRegla` (`DIA_UNICO`, `RANGO_CONTINUO`, `RECURRENTE_SEMANAL`), `fechaInicio`, `fechaFin`, `diasSemana` (JSON), `aplicaTodasNaves`, `navesIds` (JSON), `navesNombres` (JSON), `fechasExpandidas` (JSON), `creadoPorId`, `creadoPorNombre`, `creadoEn`.
    - **Índices de Rendimiento:**
      - `@@index([fechaInicio, fechaFin])`: evaluación instantánea de si una fecha corresponde a jornada laborable o suspendida.
11. **`AuditoriaRegistro` (`auditoria_registros`):**
    - Bitácora general de operaciones críticas del sistema.
    - Campos: `id`, `modulo`, `accion`, `detalle`, `creadoEn`.
    - **Índices de Rendimiento:**
      - `@@index([creadoEn])`: trazabilidad cronológica.
      - `@@index([modulo, creadoEn])`: auditoría forense por módulo específico.

---

## 5. Reglas del Motor de Importación y Reconciliación (`/ingreso-catastro`)

El motor de conciliación mensual (`catastro-file.parser.ts`, `catastro-csv-xml.parser.ts` y `catastro-reconciliacion.service.ts`) implementa una suite analítica avanzada diseñada para procesar sin pérdidas los archivos emitidos por los sistemas de rentas y catastro:

```text
====================================================================================================
                        FLUJO DE RECONCILIACIÓN MENSUAL DE CATASTRO
====================================================================================================
  [ Archivo Excel / CSV / XML ]
               │
               ▼
  [ Sanitización Multilínea ] ──▶ Elimina saltos repetidos ("TOMATE\nTOMATE" -> "TOMATE")
               │
               ▼
  [ Filtro Duplicados 100% ]  ──▶ Extrae registros idénticos (nombre + actividad + puesto) a panel
               │
               ▼
  [ Motor Heurístico 5 Casos] ──▶ Desglosa multipuestos numéricos y preserva códigos estructurales
               │
               ├──────────────────────────────────────────┬─────────────────────────────────────────┐
               ▼                                          ▼                                         ▼
   [ Regla Especial NAVE P ]                 [ Regla AMBULANTES ("0") ]             [ Modo UNIFICAR Global ]
   Prioriza DESCRIPCION (N-P-XX)             Puestos nulos pasan a "0"              Bodegas y Puestos numéricos
   y actualiza código en sitio.              Coexistencia de puestos "0".           coexisten sin sobreescritura.
               │                                          │                                         │
               └──────────────────────────────────────────┴─────────────────────────────────────────┘
                                                          │
                                                          ▼
                                [ Algoritmo Reconciliador en 4 Pasos ]
                                Paso 1: Mismo Contribuyente (1A: Puesto / 1B: Mudanza)
                                Paso 2: Nuevos / Reemplazos (2A: Reemplazo / 2B: Vacante / 2C: Expansión)
                                Paso 3: Puestos que pasan a Vacante (sin alterar croquis)
                                Paso 4: Capacidad real de la nave sin números artificiales
====================================================================================================
```

### Características Centrales del Motor

1. **Modo `UNIFICAR` Automático entre Bodegas y Puestos:**
   - Detecta de forma inteligente si el archivo corresponde a `BODEGA` (`REN04_950`), a `PUESTOS` (`ren04278`) o a formatos genéricos `CSV`/`XML`.
   - Opera siempre en **Modo `UNIFICAR`** de forma automática, garantizando que las bodegas y los puestos numéricos convivan en la misma nave sin que una carga mensual pase a vacante la sección complementaria ni sobreescriba registros existentes.
2. **Sanitización de Celdas Multilínea (`limpiarTextoCelda`):**
   - Limpia inconsistencias en celdas de Excel donde el texto se repite con saltos de línea (ej. `"TOMATE RIÑON\nTOMATE RIÑON"` se limpia a `"TOMATE RIÑON"`).
   - Preserva `"NULL"` como texto legítimo si forma parte de descripciones o actividades comerciales del contribuyente.
3. **Filtro Automático de Duplicados 100% Exactos (`filtrarDuplicadosExactos100`):**
   - Identifica registros duplicados idénticos en `nombre + actividad + puesto` dentro del mismo lote.
   - Omite automáticamente su duplicación en la base de datos y los presenta ordenadamente en un desplegable de auditoría en la interfaz de vista previa.
4. **Motor Heurístico de 5 Casos para Puestos Múltiples (`expandPuestosHeuristic`):**
   - **Caso 1 (Prefijo estructural con numeración múltiple):** Desglosa códigos como `CUBICULO N-Z-52-53` en dos registros independientes: `CUBICULO N-Z-52` y `CUBICULO N-Z-53`.
   - **Caso 2 (Preservación de códigos estructurales únicos):** Mantiene íntegros sin fragmentar códigos como `BODEGA`, `CUBICULO`, `NUCLEO`, `N-`, `ZCF-` y `S/N`.
   - **Caso 3 (Preservación de subdivisiones):** Conserva subdivisiones alfanuméricas (`003-A`) y sufijos vehiculares (`001-VEHICULO`).
   - **Caso 4 (Desglose de listas numéricas continuas con guion):** Divide rangos numéricos como `001-126` o `049-073` en sus puestos individuales correspondientes.
   - **Caso 5 (Desglose de códigos numéricos de 6 dígitos concatenados):** Separa celdas unidas por error como `068069` en los puestos físicos `068` y `069`.
5. **Distinción Automática del Sufijo `-VEHICULO` por Actividad:**
   - Si la actividad del comerciante incluye la palabra `VEHICULO` o `VEHÍCULO`, el parser añade automáticamente el sufijo `-VEHICULO` al puesto, evitando colisiones con puestos peatonales.
6. **Regla Especial 1: Prioridad de `DESCRIPCION` Exclusiva para `NAVE P`:**
   - En la plantilla de Bodega de `NAVE P`, los puestos suelen venir etiquetados con textos informales (ej. `"NUCLEO N-P-01 PAN"`), mientras que la columna `DESCRIPCION` contiene el código real estandarizado (`N-P-01`).
   - El parser prioriza el código de `DESCRIPCION` y habilita la actualización del puesto en sitio cuando el comerciante es el único registro en el lote.
7. **Regla Especial 2: Asignación de Puesto `"0"` Exclusiva para `AMBULANTES` (`aplicarReglaPuestosAmbulantes`):**
   - Exclusivamente para la nave `AMBULANTES`, cualquier puesto nulo, vacío (`""`, `"-"`, `"NULL"`, `"null"`, `"S/N"`, `"SN"`) o remanente del formato previo (`GeneralXX`) se asigna directamente al código canónico `"0"` (sin secuencias artificiales).
   - El sistema admite la **coexistencia de múltiples comerciantes con puesto `"0"`**, preservando cada uno su propio registro `Puesto` en la base de datos sin colisiones de unicidad.
   - Cuando un supervisor asignado a `AMBULANTES` sube un archivo sin nombre de nave explícito, el sistema despliega un modal interactivo de confirmación automática para aplicar la regla de ambulantes de inmediato.
8. **Motor Especializado e Independiente para CSV y XML (`catastro-csv-xml.parser.ts`):**
   - **Reconocimiento Dinámico de Cabeceras y Etiquetas:** Admite en cualquier orden las columnas en `.csv` y las etiquetas/atributos en `.xml` correspondientes a los campos esenciales: `ciu`, `cedula`, `contribuyente` (o `nombre`/`ocupante`), `articulo` (o `actividad`/`giro`), `puesto`, `nave` y `descripcion`.
   - **Autodetección de Delimitadores y Formatos sin Cabecera:** Detecta automáticamente separadores de columnas (`,`, `;`, `\t`, `|`), maneja campos entrecomillados con caracteres de puntuación internos o comillas escapadas, y realiza inferencia celular inteligente para interpretar archivos que carecen de fila de cabecera basándose en la estructura de los datos.
   - **Descarte Silencioso de Columnas No Pertinentes:** Omite automáticamente columnas secundarias o irrelevantes para la operativa del mercado (tales como `mts`, `mtr`, `m2`, `valor`, `tarifa`, `canon`, `#`, `telefono`, etc.) sin interrumpir ni corromper el procesamiento del lote.
9. **Actualización Inteligente y Preservación de `CIU`:**
   - **Detección de Nuevos CIU:** Al reconciliar cada nave, el motor compara prioritariamente la nave, luego el puesto y la cédula/contribuyente. Si el comerciante registrado previamente en base de datos (por ejemplo, desde una plantilla Excel sin CIU) tenía el campo en `"S/N"` (o un valor distinto) y el archivo entrante provee un CIU válido, el sistema detecta la diferencia, emite una novedad de auditoría de tipo `ACTUALIZACION` (`CIU actualizado: S/N -> <nuevo_ciu>`) y actualiza el registro.
   - **Protección contra Sobreescritura:** Futuras importaciones de archivos Excel que no incluyan la columna CIU o presenten campos vacíos conservan intacto el CIU real previamente consolidado en la base de datos.
10. **Reconciliación e Importación Masiva Multi-Nave en un Solo Archivo:**
    - **Soporte de Archivos Multi-Nave Globales:** Capacidad de procesar en un único archivo `.csv` o `.xml` tanto una nave individual como múltiples naves simultáneas (dos naves o la totalidad de las naves del mercado).
    - **Procesamiento Transaccional Agrupado:** El backend (`/api/v1/catastro/simular` e `/api/v1/catastro/importar`) agrupa automáticamente los registros por nave y ejecuta la reconciliación transaccional en 4 pasos de forma independiente sobre cada nave participante (actualizando datos nominales, ocupando vacantes, registrando mudanzas o reemplazos, pasando puestos libres a vacante y creando nuevas naves si no existían), sin perturbar el estado de las naves no incluidas en el archivo.

---

## 6. Funcionalidades Nuevas en Módulos Operativos

### 6.1. Toma de Listas y Asistencia en Campo (`/listas`)

- **Marcación Rápida con 1 Toque:** Al pulsar sobre el estado de un comerciante, el sistema alterna cíclicamente entre `"Presente"` (`P`), `"Ausente"` (`A`) y `"Permiso"` (`Pm`).
- **Justificación Retroactiva de Faltas de Días Anteriores:**
  - Los supervisores o jefes operativos pueden justificar inasistencias pasadas. La acción actualiza la base de datos y la auditoría, catalogando el registro bajo el estado **`Justificado` (`J`)** con color azul distintivo y número de documento de respaldo en todos los reportes operativos.
- **Bloqueo Automático en Días No Laborables:**
  - Si la fecha seleccionada coincide con una regla activa de día no laborable o feriado para la nave, el sistema bloquea automáticamente los controles de edición y muestra un banner explicativo del motivo de suspensión.
- **Selector Dinámico con Límites Reales (`meta=limites`):**
  - El selector de fechas consume los límites inferior y superior reales de la base de datos (`asistenciaService.obtenerLimitesFechas()`), impidiendo selecciones fuera de rango operativo.
- **Persistencia Selectiva de Jornadas:**
  - Permite trasladar el estado del último día registrado (hasta 30 días hacia atrás) hacia la jornada de hoy. Los puestos marcados manualmente en el día en curso no son sobreescritos y las observaciones no se arrastran para evitar contaminación de novedades.
- **3 Vistas Conmutables:** **Vista Lista** (tabular), **Vista Cuadrícula** (resumen de bloques) y **Vista Croquis** (croquis espacial en vivo con colores de asistencia en tiempo real).

### 6.2. Planificador de Naves y Certificación de Vacantes (`/naves`)

- **Croquis Matricial Interactivo:** Diagramación espacial de naves con 6 herramientas: `PUESTO`, `VACIO` (pasillos), `PARQUEADERO`, `DELIMITACION`, `ANOTACION` y `BANO`. Admite puestos modulares (`rowSpan` × `colSpan`) y reubicación mediante Drag & Drop.
- **Renombre Atómico Triple de Puestos (`ModalPuestosNave.tsx`):**
  - Al modificar el código de un puesto, el sistema ejecuta una transacción atómica triple en MySQL:
    1. Actualiza `puestos.codigo`.
    2. Actualiza `comerciantes.puestoId`.
    3. Reemplaza la coordenada correspondiente en `planos_naves.planoJson`.
- **Modal de Certificación de Espacios Públicos Vacantes (`ModalReporteVacantes.tsx`):**
  - Genera el informe oficial de puestos desocupados del mercado.
  - **Inferencia Automática de Giro Comercial:** Si un puesto vacante no tiene giro definido, el sistema analiza los puestos numéricamente adyacentes y sugiere el giro comercial predominante de la zona.
  - **Separación Interactiva:** Permite clasificar puestos entre *Vacantes Normales* y *En Proceso Judicial*.
  - **Exportación en PDF Institucional con Firmas Configurables:** Genera un documento formal A4 con encabezado institucional, desglose de vacantes por nave, conteos cuantitativos y casillas de firma configurables (*Elaborado por* y *Revisado por*).

### 6.3. Control de Supervisores y Contingencias (`/controlsupervisores`)

- **Monitoreo en Tiempo Real:** Supervisión consolidada de las tomas de lista ejecutadas por los supervisores en cada nave, con cálculo de puntualidad, atraso o marcación con persistencia.
- **Gestión de Días No Laborables (`ModalDiasNoLaborables.tsx`):**
  - Permite a la dirección registrar feriados cantonales, paros o días de mantenimiento con alcance global o por naves específicas, bajo tres modalidades: `DIA_UNICO`, `RANGO_CONTINUO` o `RECURRENTE_SEMANAL`.
- **Gestión de Permisos de Supervisores (`ModalPermisosSupervisores.tsx`):**
  - Administra ausencias justificadas y licencias del personal de supervisión, con dos modalidades operativas de contingencia:
    1. **Reemplazo Temporal:** Asigna temporalmente la nave a otro supervisor habilitado en el sistema durante el período de ausencia.
    2. **Persistencia Automática:** Configura la persistencia automática de la nave para que el sistema cierre la jornada operativamente con base en el último jornal registrado al cierre del día.
- **Reporte Consolidado y Detallado de Supervisores (`ModalReporteSupervisores.tsx`):**
  - Exportación en dos modalidades operativas: **Resumen** (totales consolidados por supervisor) y **Detalle** (radiografía nominal de jornales), exportable tanto a PDF vectorial (`control-pdf.utils.ts`) como a Excel nativo `.xlsx` (`reporte-supervisores-export.utils.ts`).

### 6.4. Reportes Operativos Bimodales (`/reportes`)

- **Los 5 Estados Oficiales de Asistencia:**
  - `P`: Presente (Verde)
  - `A`: Ausente (Rojo)
  - `Pm`: Permiso (Morado)
  - `J`: Justificado (Azul)
  - `V`: Vacante (Ámbar)
  - `—`: Día No Laborable / Feriado (Gris con fondo crema)
- **Doble Exportación Simétrica:**
  - **PDF Vectorial (`reportes-pdf.utils.ts`):** Encabezado institucional milimétricamente alineado a los bordes de la tabla (`tableMarginX = 10mm`), cuadro izquierdo de metadatos, cuadro derecho de simbología y paginación formal.
  - **Excel Nativo Multi-Hoja (`reportes-excel.utils.ts`):** Generado mediante `ExcelJS 4.4.0` con una hoja independiente por cada nave comercial, cuadro de descripción estructurado en 4 sub-columnas que evita truncamiento de palabras, fusión horizontal de celdas de observaciones con crecimiento multi-fila (`wrapText`), paleta de colores institucional y configuración de página A4 horizontal.

---

## 7. Ingeniería de Rendimiento, Concurrencia y Resiliencia

El sistema está optimizado para garantizar tiempos de respuesta en submilisegundos ante picos de concurrencia de más de 14 supervisores y directivos trabajando en simultáneo:

### Connection Pool de Prisma y Ajustes MySQL

En `src/infrastructure/database/prisma.ts`, la conexión se instancia con parámetros optimizados para evitar la saturación de conexiones y mitigar bloqueos en MySQL:

- `connection_limit=15`: Asigna un tamaño equilibrado de conexiones concurrentes en el pool.
- `pool_timeout=15`: Limita el tiempo de espera por una conexión libre a 15 segundos antes de abortar de forma segura.
- `connect_timeout=10`: Establece un límite de 10 segundos para el handshake inicial con el socket de MySQL.
- `maxWait: 10000` y `timeout: 30000`: Parámetros de tolerancia en transacciones complejas de importación masiva.

### Deduplicación de Peticiones en Vuelo (*Singleflight*)

Para erradicar la contención de hilos y la ejecución redundante de consultas pesadas en base de datos:
1. **Asistencia Diaria (`daily-attendance.service.ts`):** La variable global `__epmma_sync_in_flight` retiene la promesa de sincronización en curso. Múltiples peticiones entrantes concurrentes reciben la misma promesa compartida, eliminando bloqueos de tabla.
2. **Sesiones de Control (`sesion-control-helper.ts`):** El mapa `sesionesEnVuelo` indexa las sesiones activas bajo la clave `${supervisorId}_${fechaJornada}_${naveId}`, deduplicando actualizaciones concurrentes de contadores en memoria.
3. **Repositorios Cliente (`nave.repository.impl.ts` y `comerciante.repository.impl.ts`):** Emplean promesas en vuelo (`inFlightGetNaves`, `inFlightGetComerciantes`) para deduplicar peticiones consecutivas disparadas por componentes React montados en paralelo.
4. **Caché de Sesión de Naves (`nave-puestos-sync.service.ts`):** El conjunto `navesYaVerificadasEnSesion` almacena en memoria las naves cuya colación y puestos ya fueron verificados. Dispone de invalidación reactiva inmediata (`invalidarVerificacionNave`) al registrarse mutaciones en puestos o naves.

### Componentes de Resiliencia Visual

- **Banner de Fallo de Conexión (`error-conexion.tsx`):** Si el servidor MySQL no responde, la interfaz captura el error sin quebrarse y muestra una alerta modal clara con botón de reintento.
- **Componente de Estado de Error (`error-estado.tsx`):** Manejo visual graceful en tablas y formularios ante excepciones de red.
- **Manejador Perimetral (`src/app/global-error.tsx`):** Atrapa cualquier fallo no controlado a nivel de layout raíz, garantizando la continuidad de la experiencia de usuario.

---

## 8. Sistema de Auditoría y Logging Centralizado en Disco

Para garantizar que la consola de producción y Turbopack permanezcan completamente limpias, el sistema centraliza la trazabilidad en un archivo físico estructurado:

- **Archivo Maestro:** `logs/ep-ema-system.log`.
- **Cola Asíncrona No Bloqueante (`system-logger.ts`):** Los métodos `logInfo`, `logWarn` y `logError` encolan mensajes en memoria que un worker en segundo plano vuelca a disco de manera secuencial, sin congelar el hilo principal de Node.js.
- **Rotación Automática a 5 MB:** Al sobrepasar los 5 MB, el archivo actual se renombra automáticamente a `ep-ema-system.old.log` y se crea un nuevo archivo limpio, preservando siempre el historial inmediato sin desbordar el disco.
- **Marcas de Tiempo Oficiales:** Cada registro incluye fecha y hora exacta formateada en la zona oficial de Ecuador (`America/Guayaquil`).
- **Endpoint Receptor de Errores Web (`POST /api/v1/system-logs`):** La utilidad del navegador `src/lib/client-logger.ts` captura excepciones en tiempo de ejecución de React y las transmite de forma silenciosa al backend para su almacenamiento centralizado en disco.

---

## 9. Matriz de Seguridad, Control de Acceso (RBAC) y Catálogo de 27 Endpoints REST

### Matriz Oficial de Capacidades por Rol Institucional

| Módulo del Sistema | SUPERADMIN | TIC | DIRECTOR | JEFE_OPERATIVO | SUPERVISOR |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Toma de Listas (`/listas`)** | Edición Total | Edición Total | Solo Lectura | Solo Lectura | Edición (Naves Asignadas) |
| **Reportes Operativos (`/reportes`)** | Acceso Total | Acceso Total | Acceso Total | Acceso Total | Filtrado por Naves Asignadas |
| **Catastro de Comerciantes (`/catastro`)** | CRUD Total | CRUD Total | CRUD Total | CRUD Total | Solo Lectura (Sin Acciones) |
| **Planificador de Naves (`/naves`)** | Acceso Total | Acceso Total | Consulta y Edición | Consulta y Edición | ❌ Sin Acceso |
| **Control de Supervisores (`/controlsupervisores`)** | Acceso Total | Acceso Total | Acceso Total | Acceso Total | ❌ Sin Acceso |
| **Ingreso de Catastro (`/ingreso-catastro`)** | Acceso Total | Acceso Total | Acceso Total | Acceso Total | Restringido a Naves Asignadas |
| **Gestión de Usuarios (`/configuracion/usuarios`)** | Acceso Total | Acceso Total | ❌ Sin Acceso | ❌ Sin Acceso | ❌ Sin Acceso |
| **Cambio de Contraseña Personal** | Sí | Sí | Sí | Sí | Sí |

---

### Catálogo Completo de los 27 Route Handlers REST (`/api/v1/*`)

El proxy server-side (`src/proxy.ts`) intercepta perimetralmente cada solicitud a `/api/v1/*`, validando la autenticidad del JWT y aplicando las restricciones de acceso por rol:

| # | Métodos HTTP | Ruta del Endpoint | Descripción Funcional | Roles Autorizados |
| :-: | :--- | :--- | :--- | :--- |
| **1** | `POST` | `/api/v1/auth/login` | Autenticación de credenciales, verificación bcrypt y emisión de Cookie JWT HttpOnly | Público |
| **2** | `POST` | `/api/v1/auth/logout` | Revocación y expiración inmediata de la Cookie de sesión | Autenticado |
| **3** | `GET` | `/api/v1/auth/me` | Obtención del perfil, rol y naves autorizadas de la sesión activa | Autenticado |
| **4** | `POST` | `/api/v1/auth/change-password` | Cambio de contraseña voluntario o de primer ingreso con validación anti-IDOR | Autenticado |
| **5** | `POST` | `/api/v1/auth/forgot-password` | Generación CSPRNG de clave temporal segura de 16 caracteres y envío vía Gmail SMTP | Público |
| **6** | `GET`, `POST` | `/api/v1/usuarios` | Catálogo de colaboradores institucionales y registro de nuevas cuentas | `SUPERADMIN`, `TIC` |
| **7** | `GET`, `PUT`, `DELETE` | `/api/v1/usuarios/[id]` | Consulta detallada, actualización de datos/rol y baja lógica de usuario | `SUPERADMIN`, `TIC` |
| **8** | `POST` | `/api/v1/usuarios/[id]/reset-password` | Restablecimiento administrativo de clave a contraseña temporal `${cedula}*` | `SUPERADMIN`, `TIC` |
| **9** | `GET`, `POST` | `/api/v1/naves` | Listado general de naves con cupos y creación de nueva nave | GET: Todos \| POST: `SUPERADMIN`, `TIC` |
| **10** | `GET`, `PUT`, `DELETE` | `/api/v1/naves/[id]` | Consulta de nave, actualización de capacidad/nombre y eliminación | GET: Todos \| PUT/DEL: `SUPERADMIN`, `TIC` |
| **11** | `GET`, `PUT` | `/api/v1/naves/[id]/plano` | Lectura y actualización de la matriz espacial vectorial (`planoJson`) con candado de cupos | GET: Todos \| PUT: `SUPERADMIN`, `TIC`, `DIRECTOR`, `JEFE_OPERATIVO` |
| **12** | `GET`, `PUT` | `/api/v1/naves/[id]/puestos` | Renombre atómico individual o masivo de puestos con sincronización triple | `SUPERADMIN`, `TIC` |
| **13** | `GET` | `/api/v1/naves/reporte-vacantes` | Certificación oficial de espacios vacantes e inferencia de giro por cercanía | `SUPERADMIN`, `TIC`, `DIRECTOR`, `JEFE_OPERATIVO` |
| **14** | `GET`, `POST` | `/api/v1/comerciantes` | Catastro nominal de comerciantes y alta directa de contribuyente | GET: Todos \| POST: `SUPERADMIN`, `TIC` |
| **15** | `GET`, `PUT`, `DELETE` | `/api/v1/comerciantes/[id]` | Detalle, actualización de giro/actividad y baja lógica de comerciante | GET: Todos \| PUT/DEL: `SUPERADMIN`, `TIC` |
| **16** | `POST` | `/api/v1/catastro/simular` | Simulación analítica y cálculo de diferencias en 4 pasos sin persistir en base de datos | `SUPERADMIN`, `TIC`, `SUPERVISOR` |
| **17** | `POST` | `/api/v1/catastro/importar` | Confirmación e inserción transaccional por lotes del catastro mensual | `SUPERADMIN`, `TIC`, `SUPERVISOR` |
| **18** | `GET`, `POST` | `/api/v1/asistencia` | Consulta de asistencias por nave/fecha y marcación de jornales en campo | GET: Todos \| POST: `SUPERADMIN`, `TIC`, `JEFE_OPERATIVO`, `SUPERVISOR` |
| **19** | `POST` | `/api/v1/asistencia/persistencia` | Ejecución de persistencia selectiva arrastrando la jornada de referencia | `SUPERADMIN`, `TIC`, `JEFE_OPERATIVO`, `SUPERVISOR` |
| **20** | `POST` | `/api/v1/asistencia/justificar-falta` | Transformación justificada de inasistencias pasadas con número de documento | `SUPERADMIN`, `TIC`, `JEFE_OPERATIVO`, `SUPERVISOR` |
| **21** | `POST`, `DELETE` | `/api/v1/asistencia/observaciones` | Inserción y eliminación de novedades (`ObservacionesGeneral`, `Citaciones`, `Notificacion`) | `SUPERADMIN`, `TIC`, `JEFE_OPERATIVO`, `SUPERVISOR` |
| **22** | `POST`, `DELETE` | `/api/v1/asistencia/permisos` | Registro y anulación de permisos por rango de fechas para comerciantes | `SUPERADMIN`, `TIC`, `JEFE_OPERATIVO`, `SUPERVISOR` |
| **23** | `GET`, `POST` | `/api/v1/auditoria/sesiones` | Consulta de sesiones de control con filtros, insignias y radiografía nominal | `SUPERADMIN`, `TIC`, `DIRECTOR`, `JEFE_OPERATIVO` |
| **24** | `GET`, `POST`, `DELETE`| `/api/v1/auditoria/dias-no-laborables`| Catálogo y registro de feriados, paros o días no laborables | `SUPERADMIN`, `TIC`, `DIRECTOR`, `JEFE_OPERATIVO` |
| **25** | `GET`, `POST`, `DELETE`| `/api/v1/auditoria/permisos-supervisores`| Gestión de licencias de supervisores y delegación de coberturas operativas | `SUPERADMIN`, `TIC`, `DIRECTOR`, `JEFE_OPERATIVO` |
| **26** | `GET` | `/api/v1/auditoria/reporte-supervisores`| Consolidado cuantitativo y cualitativo de jornales supervisados | `SUPERADMIN`, `TIC`, `DIRECTOR`, `JEFE_OPERATIVO` |
| **27** | `POST` | `/api/v1/system-logs` | Receptor silencioso de errores del cliente web para volcado a `ep-ema-system.log` | Público / Autenticado |

---

## 10. Despliegue, Sembrado y Comandos Operativos

### Flujo de Puesta en Marcha Local (Entorno de Desarrollo en Puerto 5050)

Para levantar el entorno local completo con sus contenedores y servidor de desarrollo en el puerto **5050**:

```bash
# 1. Clonar el repositorio y acceder a la raíz del proyecto
git clone <url-del-repositorio>
cd ep-ema-control-catastro

# 2. Instalar dependencias deterministas con pnpm
pnpm install

# 3. Iniciar los contenedores de MySQL 8.0 y phpMyAdmin
docker compose up -d

# 4. Sincronizar el esquema relacional de 11 modelos con la base de datos
npx prisma db push

# 5. Ejecutar el sembrado maestro de producción
npx prisma db seed

# 6. Iniciar el servidor de desarrollo con recarga en caliente (puerto 5050)
pnpm dev
```

Puertos y accesos en desarrollo:
- **Aplicación Web EP-EMA:** `http://localhost:5050`
- **Gestor Visual phpMyAdmin:** `http://localhost:8080`
- **Base de Datos MySQL 8.0:** `localhost:3307` (`usuario: ep_ema_user` / `clave: ep_ema_pass` / `bd: ep_ema_db`)

---

### Verificación de Calidad y Tipado

```bash
# Comprobación de tipos en TypeScript (debe retornar 0 errores)
npx tsc --noEmit

# Auditoría de estándares y buenas prácticas de código con ESLint (0 advertencias)
pnpm lint

# Compilación de producción con Next.js (optimización y validación de 38 rutas)
pnpm build
```

---

### Semilla Oficial de Base de Datos (`prisma/seed.ts`)

El script oficial de sembrado establece la infraestructura integral del sistema EP-EMA, aprovisionando la cuenta maestra de acceso, la totalidad de naves comerciales, los croquis espaciales vectoriales y el catastro físico:

- **Usuario Administrador Principal (`SUPERADMIN`):**
  - **Identificador de Acceso / Cédula:** `admin`
  - **Correo Electrónico Oficial:** `sistema.epema@gmail.com`
  - **Contraseña Inicial de Producción:** `Ravine.Snooze.Cover9.Defendant`
  - **Bandera `mustChangePassword`:** `false`
- **Infraestructura Completa de las 27 Naves Institucionales:**
  - Siembra determinista de las 27 naves oficiales (`AMBULANTES`, `NAVE A` hasta `NAVE Z`, `NAVE CF`, `NAVE QCP`, `NAVE BATERIAS`, etc.).
  - Carga los **27 planos espaciales vectoriales** desde `prisma/seed-planos.json` (o respaldo SQL), recreando las cuadrículas exactas de filas y columnas de cada nave.
  - Sincroniza todos los **puestos físicos** y asigna los **comerciantes catastrados** con sus respectivas actividades comerciales y cédulas desde el respaldo maestro.
  - Inicializa la marcación de asistencia del día en estado `"Presente"` para los puestos ocupados.

---

### Guía Paso a Paso para Despliegue en Servidor de Producción (Windows 10 Pro + MySQL Local 3306 + Puerto 5050)

Esta guía documenta la puesta en marcha definitiva de la plataforma en un servidor institucional dedicado con **Windows 10 Pro**, conviviendo de forma segura con otros sistemas sobre el motor nativo **MySQL Server en `localhost:3306`** y sirviendo la aplicación en el puerto **`5050`** accesible desde cualquier equipo o dispositivo móvil en la red local.

#### Paso 1: Configurar MySQL Nativo en `localhost:3306` (Sin Docker)

1. En el servidor Windows 10 Pro, abre la consola de administración de MySQL (`mysql -u root -p`) o tu herramienta visual de base de datos preferida (MySQL Workbench, HeidiSQL, etc.).
2. Crea la base de datos limpia con soporte completo de caracteres en español, sin interferir con otras bases de datos existentes en el servidor:

```sql
CREATE DATABASE IF NOT EXISTS ep_ema_db CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci;
```

3. En la carpeta raíz del proyecto, copia `.env.example` a `.env` (si aún no existe) y edítalo:

```powershell
Copy-Item .env.example .env
notepad .env
```

4. En el archivo `.env`, comenta la línea de Docker (`3307`) y descomenta la línea de producción nativa (`3306`), configurando las credenciales de tu MySQL local:

```env
# ── CONEXIÓN ACTIVA (Desarrollo con Docker en puerto 3307) ──
# DATABASE_URL="mysql://ep_ema_user:ep_ema_pass@localhost:3307/ep_ema_db"

# ── CONEXIÓN PARA PRODUCCIÓN (MySQL Nativo en Windows 10 Pro - Puerto por defecto 3306) ──
DATABASE_URL="mysql://root:TU_CLAVE_MYSQL@localhost:3306/ep_ema_db?connection_limit=15&pool_timeout=15&connect_timeout=10"
```

#### Paso 2: Sincronizar Prisma, Sembrar las 27 Naves/Croquis y Compilar

Ejecuta en PowerShell dentro de la raíz del proyecto:

```powershell
pnpm install
npx prisma generate
npx prisma db push
npx prisma db seed
pnpm build
```

#### Paso 3: Abrir el Puerto 5050 en el Firewall de Windows 10 Pro para toda la Red Local

Abre una consola de **PowerShell como Administrador** y crea la regla de entrada para permitir que todos los dispositivos de la red local puedan acceder:

```powershell
New-NetFirewallRule -DisplayName "EP-EMA Control Catastro (TCP 5050)" -Direction Inbound -LocalPort 5050 -Protocol TCP -Action Allow -Profile Any
```

#### Paso 4: Configurar Acceso HTTPS en el Puerto 5050 Autodetectando la IP del Servidor

El sistema soporta conexiones tanto HTTP como HTTPS gracias a la cookie de sesión adaptativa compatible con LAN:

- **Modo Desarrollo / Pruebas HTTPS con Next.js:**
  ```powershell
  pnpm dev:https
  ```

- **Acceso HTTPS en Producción con `mkcert` y `local-ssl-proxy`:**  
  Detecta automáticamente la IP IPv4 activa del servidor y genera los certificados SSL válidos sin necesidad de conocer la IP de antemano:

  ```powershell
  # 1. Detectar automáticamente la IP IPv4 del servidor
  $ServerIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet' -and $_.IPAddress -notmatch '^169\.254' } | Select-Object -First 1).IPAddress
  Write-Host "IP detectada del servidor: $ServerIP"

  # 2. Generar certificado SSL para localhost y la IP detectada
  mkcert -install
  mkcert localhost 127.0.0.1 $ServerIP

  # 3. Iniciar el proxy SSL redirigiendo hacia el puerto 5050
  npx local-ssl-proxy --key localhost+$ServerIP-key.pem --cert localhost+$ServerIP.pem --source 5050 --target 5050
  ```

#### Paso 5: Activar el Inicio Automático en Segundo Plano ante Reinicios de Windows

Para que el sistema se inicie de forma autónoma en segundo plano cada vez que el servidor Windows 10 Pro arranque o se reinicie:

1. Ejecuta el script de registro en una consola de **PowerShell como Administrador**:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\registrar-tarea-inicio.ps1
```

*El script `scripts/iniciar-produccion.ps1` verifica la conexión de red hacia MySQL mediante comprobaciones TCP (sin tocar ni alterar los servicios del sistema), verifica la compilación `.next` y levanta el servidor Next.js en `0.0.0.0:5050`, registrando la actividad en `logs/autostart-service.log`.*

2. **Comandos Útiles para Gestión de la Tarea Programada:**

```powershell
# Iniciar la tarea programada inmediatamente en segundo plano
Start-ScheduledTask -TaskName "EP-EMA-Control-Catastro-5050"

# Ver el estado actual de la tarea
Get-ScheduledTask -TaskName "EP-EMA-Control-Catastro-5050"

# Revisar el registro de actividad del servicio en tiempo real
Get-Content .\logs\autostart-service.log -Tail 50 -Wait

# Detener la tarea en segundo plano si es necesario
Stop-ScheduledTask -TaskName "EP-EMA-Control-Catastro-5050"
```

---

### Resumen de Comandos que Ejecutarás en el Servidor Windows 10 Pro

Una vez subidos los cambios al repositorio, cuando estés en la consola del servidor de producción solo tendrás que ejecutar:

```powershell
# 1. Clonar o actualizar el repositorio en el servidor
git clone https://github.com/gaot539/ep-ema-control-catastro.git
cd ep-ema-control-catastro

# 2. Copiar .env.example a .env y descomentar la línea de localhost:3306 (comentando la de 3307)
Copy-Item .env.example .env
notepad .env

# 3. Instalar dependencias, crear las 11 tablas en el MySQL local (3306), sembrar los 27 planos y compilar
pnpm install
npx prisma generate
npx prisma db push
npx prisma db seed
pnpm build

# 4. Abrir el puerto 5050 en el Firewall de Windows para que todos en la red puedan entrar
New-NetFirewallRule -DisplayName "EP-EMA Control Catastro (TCP 5050)" -Direction Inbound -LocalPort 5050 -Protocol TCP -Action Allow -Profile Any

# 5. Registrar la tarea en segundo plano (verifica BD sin tocar MySQL y levanta el sistema al reiniciar)
powershell -ExecutionPolicy Bypass -File .\scripts\registrar-tarea-inicio.ps1

# 6. Arrancar la tarea en segundo plano ahora mismo
Start-ScheduledTask -TaskName "EP-EMA-Control-Catastro-5050"
```

---

## 11. Licencia y Derechos Institucionales

Este software ha sido diseñado y desarrollado con carácter confidencial y de uso exclusivo para la **Empresa Pública – Empresa Municipal Mercado Mayorista de Ambato (EP-EMA)**.  
Todos los derechos patrimoniales y de propiedad intelectual reservados © 2026 EP-EMA. Prohibida su copia, distribución, modificación o reproducción no autorizada por la institución.
