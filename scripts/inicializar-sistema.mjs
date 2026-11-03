// scripts/inicializar-sistema.mjs
// Script Maestro Interactivo para Inicializar EP-EMA en DEV (Docker + 60 días falsos) o PRODUCCIÓN (MySQL Nativo limpio)

import fs from "fs";
import path from "path";
import crypto from "crypto";
import readline from "readline";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// ── 1. Utilidad para leer variables del archivo .env ──────────────────────────
function cargarEnv() {
  const envPath = path.join(projectRoot, ".env");
  const envVars = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        envVars[key] = val;
        process.env[key] = val;
      }
    }
  }
  return envVars;
}

function actualizarDatabaseUrlEnEnv(nuevaUrl) {
  const envPath = path.join(projectRoot, ".env");
  process.env.DATABASE_URL = nuevaUrl;
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `DATABASE_URL="${nuevaUrl}"\n`, "utf-8");
    return;
  }
  let content = fs.readFileSync(envPath, "utf-8");
  if (/^DATABASE_URL\s*=/m.test(content)) {
    content = content.replace(/^DATABASE_URL\s*=.*$/m, `DATABASE_URL="${nuevaUrl}"`);
  } else {
    content += `\nDATABASE_URL="${nuevaUrl}"\n`;
  }
  fs.writeFileSync(envPath, content, "utf-8");
}

// ── 2. Interfaz de preguntas interactivas en consola ──────────────────────────
function crearPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const preguntar = (texto, porDefecto = "") =>
    new Promise((resolve) => {
      const sufijo = porDefecto !== "" ? ` [${porDefecto}]: ` : ": ";
      rl.question(`${texto}${sufijo}`, (respuesta) => {
        const valor = respuesta.trim();
        resolve(valor !== "" ? valor : porDefecto);
      });
    });
  return { preguntar, cerrar: () => rl.close() };
}

// ── 3. Parser de tuplas MySQL desde prisma/viejo.sql ──────────────────────────
function parseMySQLValues(valsStr) {
  const rows = [];
  let i = 0;
  const n = valsStr.length;

  while (i < n) {
    while (i < n && valsStr[i] !== "(") i++;
    if (i >= n) break;
    i++;
    const row = [];

    while (i < n && valsStr[i] !== ")") {
      while (i < n && " \t\r\n,".includes(valsStr[i])) i++;
      if (i >= n || valsStr[i] === ")") break;

      if (valsStr[i] === "'") {
        i++;
        let s = "";
        while (i < n) {
          if (valsStr[i] === "\\") {
            i++;
            if (i < n) {
              const c = valsStr[i];
              if (c === "n") s += "\n";
              else if (c === "r") s += "\r";
              else if (c === "t") s += "\t";
              else if (c === "0") s += "\0";
              else s += c;
              i++;
            }
          } else if (valsStr[i] === "'") {
            if (i + 1 < n && valsStr[i + 1] === "'") {
              s += "'";
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            s += valsStr[i];
            i++;
          }
        }
        row.push(s);
      } else {
        const start = i;
        while (i < n && valsStr[i] !== "," && valsStr[i] !== ")") i++;
        const token = valsStr.slice(start, i).trim();
        if (token.toUpperCase() === "NULL") row.push(null);
        else if (token.includes(".")) row.push(Number(token));
        else row.push(parseInt(token, 10));
      }
    }
    if (i < n && valsStr[i] === ")") i++;
    rows.push(row);
  }
  return rows;
}

function leerDatosMaestrosDesdeSQL() {
  const posiblesRutas = [
    path.join(projectRoot, "prisma", "viejo.sql"),
    path.join(projectRoot, "viejo.sql"),
    path.join(projectRoot, "prisma", "viejo_2.sql"),
  ];
  const rutaSQL = posiblesRutas.find((p) => fs.existsSync(p));
  if (!rutaSQL) {
    throw new Error("No se encontró prisma/viejo.sql. Asegúrate de que el archivo exista.");
  }

  console.log(`\n📖 Extrayendo naves, planos, puestos y comerciantes desde: ${path.basename(rutaSQL)}...`);
  const sqlContent = fs.readFileSync(rutaSQL, "utf-8");
  const tablas = {};
  const regexInsert = /INSERT INTO `(\w+)`(?:\s*\([^)]+\))?\s*VALUES\s*([\s\S]*?);\r?\n/g;
  let match;
  while ((match = regexInsert.exec(sqlContent)) !== null) {
    const table = match[1];
    if (!tablas[table]) tablas[table] = [];
    tablas[table].push(...parseMySQLValues(match[2]));
  }

  // Cargar también seed-planos.json si existe como respaldo adicional
  const rutaPlanosJson = path.join(projectRoot, "prisma", "seed-planos.json");
  const seedPlanosJson = fs.existsSync(rutaPlanosJson)
    ? JSON.parse(fs.readFileSync(rutaPlanosJson, "utf-8"))
    : {};

  // 1. Procesar Planos Espaciales (planos_naves)
  const planosMap = new Map();
  for (const row of tablas["planos_naves"] || []) {
    const id = String(row[0]);
    const naveId = String(row[1]);
    const filas = Number(row[2]) || 12;
    const columnas = Number(row[3]) || 12;
    let celdas = [];
    try {
      celdas = JSON.parse(String(row[4] || "[]"));
    } catch {
      celdas = seedPlanosJson[naveId]?.celdas || [];
    }
    planosMap.set(naveId, { id, naveId, filas, columnas, celdas });
  }

  // 2. Procesar Comerciantes (comerciantes)
  const comerciantesRawMap = new Map();
  for (const cRow of tablas["comerciantes"] || []) {
    comerciantesRawMap.set(String(cRow[0]), cRow);
  }

  // 3. Procesar Puestos (puestos) manteniendo 100% compatibilidad con los códigos de los croquis
  const comerciantesFinales = [];
  const puestosFinales = [];
  const comerciantesInsertados = new Set();
  const conteoPuestosPorNave = new Map();

  for (const pRow of tablas["puestos"] || []) {
    const puestoId = String(pRow[0]);
    let codigo = String(pRow[1] ?? "").trim();
    const naveId = String(pRow[2]);
    const estadoRaw = String(pRow[3]) === "Ocupado" ? "Ocupado" : "Vacante";
    const comercianteId = pRow[4] ? String(pRow[4]) : null;

    // Omitir puesto vacante huérfano '1' de NAVE G para que su croquis 8x9 quede 29/29 (100% ubicado)
    if (naveId === "nave-g" && codigo === "1" && !comercianteId) {
      continue;
    }

    // En NAVE C normalizar vacantes '77', '98', '99' -> '077', '098', '099' para coincidir 100% con el croquis
    if (naveId === "nave-c" && /^\d{1,2}$/.test(codigo)) {
      codigo = codigo.padStart(3, "0");
    }

    // En AMBULANTES normalizar 'NULL' -> '0'
    if (naveId === "ambulantes" && (!codigo || codigo.toUpperCase() === "NULL")) {
      codigo = "0";
    }

    const comRow = comercianteId ? comerciantesRawMap.get(comercianteId) : null;

    if (comRow && comercianteId && !comerciantesInsertados.has(comercianteId)) {
      comerciantesInsertados.add(comercianteId);
      const ciuRaw = String(comRow[1] || "S/N").trim();
      comerciantesFinales.push({
        idInterno: comercianteId,
        ciu: !ciuRaw || ciuRaw === "-" ? "S/N" : ciuRaw,
        cedula: String(comRow[2] || ""),
        contribuyente: String(comRow[3] || "SIN NOMBRE"),
        actividad: String(comRow[4] || "General"),
        puestoId: codigo,
        nave: String(comRow[6] || ""),
        estadoRegistro: String(comRow[7]) === "Deshabilitado" ? "Deshabilitado" : "Habilitado",
        creadoPor: "seed-maestro",
      });
    }

    puestosFinales.push({
      id: puestoId,
      codigo,
      naveId,
      estado: comRow ? "Ocupado" : estadoRaw === "Ocupado" ? "Vacante" : estadoRaw,
      comercianteId: comRow ? comercianteId : null,
    });

    conteoPuestosPorNave.set(naveId, (conteoPuestosPorNave.get(naveId) || 0) + 1);
  }

  // 4. Procesar Naves (naves) poniendo NAVE A primero para que el Planificador Espacial abra en NAVE A por defecto
  const navesRaw = tablas["naves"] || [];
  navesRaw.sort((a, b) => {
    if (a[0] === "nave-a") return -1;
    if (b[0] === "nave-a") return 1;
    return String(a[1]).localeCompare(String(b[1]), "es");
  });

  const navesFinales = [];
  const planosFinales = [];

  for (const nRow of navesRaw) {
    const naveId = String(nRow[0]);
    const nombre = String(nRow[1]);
    const totalPuestosReales = conteoPuestosPorNave.get(naveId) ?? Number(nRow[2]) ?? 100;

    navesFinales.push({
      id: naveId,
      nombre,
      cantidadPuestos: totalPuestosReales,
      limitePuestos: totalPuestosReales,
      supervisores: [],
      estadoRegistro: "Habilitado",
    });

    const planoExistente = planosMap.get(naveId);
    if (planoExistente) {
      planosFinales.push(planoExistente);
    } else {
      const celdasVacias = [];
      for (let r = 0; r < 12; r++) {
        for (let c = 0; c < 12; c++) {
          celdasVacias.push({ fila: r, columna: c, tipo: "VACIO", rowSpan: 1, colSpan: 1 });
        }
      }
      planosFinales.push({
        id: crypto.randomUUID(),
        naveId,
        filas: 12,
        columnas: 12,
        celdas: celdasVacias,
      });
    }
  }

  return {
    navesFinales,
    planosFinales,
    comerciantesFinales,
    puestosFinales,
  };
}

// ── 4. Generador de 60 días de registros falsos (solo para modo DEV) ──────────
function generarRegistrosAsistencia60Dias(puestosFinales) {
  const puestosOcupados = puestosFinales.filter((p) => p.comercianteId);
  const fechas = [];
  const fin = new Date(Date.UTC(2026, 9, 31)); // 2026-10-31
  for (let offset = 59; offset >= 0; offset--) {
    const dt = new Date(fin.getTime() - offset * 86400000);
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    fechas.push(`${yyyy}-${mm}-${dd}`);
  }

  let seed = 20261031;
  const rng = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const MOTIVOS_OBS = [
    "Puesto limpio y ordenado durante la inspección matutina.",
    "Se recuerda mantener despejado el pasillo de circulación.",
    "Apertura del puesto con 20 minutos de retraso.",
    "Verificación de balanza y precios exhibidos correctamente.",
  ];
  const MOTIVOS_PERM = [
    "Cita médica justificada en el IESS",
    "Calamidad doméstica familiar debidamente respaldada",
    "Trámite administrativo personal urgente",
  ];

  const registros = [];
  for (const p of puestosOcupados) {
    for (const fecha of fechas) {
      const r = rng();
      let estado = "Presente";
      let observacion = null;
      let observacionTexto = null;
      let permisoInicio = null;
      let permisoFin = null;
      let observaciones = null;
      let permisos = null;

      if (r < 0.88) {
        estado = "Presente";
        if (rng() < 0.03) {
          const txt = MOTIVOS_OBS[Math.floor(rng() * MOTIVOS_OBS.length)];
          observacion = txt;
          observacionTexto = txt;
          observaciones = [
            {
              id: crypto.randomUUID(),
              tipo: "ObservacionesGeneral",
              numeroDocumento: `OBS-${fecha.replace(/-/g, "")}`,
              texto: txt,
              fechaHora: `${fecha}T08:30:00.000Z`,
            },
          ];
        }
      } else if (r < 0.96) {
        estado = "Ausente";
      } else {
        estado = "Permiso";
        const mot = MOTIVOS_PERM[Math.floor(rng() * MOTIVOS_PERM.length)];
        permisoInicio = fecha;
        permisoFin = fecha;
        observacion = `Permiso autorizado: ${mot}`;
        observacionTexto = observacion;
        permisos = [
          {
            id: crypto.randomUUID(),
            motivo: mot,
            fechaAsignacion: `${fecha}T07:00:00.000Z`,
            fechaInicio: fecha,
            fechaFin: fecha,
          },
        ];
      }

      registros.push({
        id: crypto.randomUUID(),
        comercianteId: p.comercianteId,
        puestoId: p.id,
        fecha,
        estado,
        observacion,
        observacionTexto,
        permisoInicio,
        permisoFin,
        observaciones,
        permisos,
      });
    }
  }
  return registros;
}

// ── 5. Inyección directa por flujo SQL hacia Docker (Modo DEV ultrarrápido) ───
function ejecutarSQLPorDockerStream(bloquesSQL, etiquetaProgreso = "Sembrando") {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        "ep_ema_mysql",
        "mysql",
        "-u",
        "root",
        "-pep_ema_root_pass",
        "--default-character-set=utf8mb4",
        "ep_ema_db",
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    let stderrData = "";
    child.stderr.on("data", (d) => {
      const txt = d.toString();
      if (!txt.includes("Using a password on the command line interface can be insecure")) {
        stderrData += txt;
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderrData || `Proceso mysql en Docker terminó con código ${code}`));
    });

    let idx = 0;
    const total = bloquesSQL.length;

    function escribirSiguiente() {
      let ok = true;
      while (idx < total && ok) {
        const sql = bloquesSQL[idx];
        idx++;
        if (idx % 10 === 0 || idx === total) {
          const pct = ((idx / total) * 100).toFixed(1);
          process.stdout.write(`\r⏳ ${etiquetaProgreso}: ${idx}/${total} bloques (${pct}%)...   `);
        }
        ok = child.stdin.write(sql);
      }
      if (idx < total) {
        child.stdin.once("drain", escribirSiguiente);
      } else {
        child.stdin.end();
      }
    }

    escribirSiguiente();
  });
}

const escSQL = (v) =>
  v === null || v === undefined
    ? "NULL"
    : `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

function construirBloquesSQLMaestros(superadmin, datos, ahoraISO) {
  const bloques = [];
  bloques.push("SET FOREIGN_KEY_CHECKS = 0;\nSET UNIQUE_CHECKS = 0;\nSET AUTOCOMMIT = 0;\n");

  // Asegurar colación en español en naves y comerciantes
  bloques.push(
    "ALTER TABLE `naves` MODIFY `nombre` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci NOT NULL;\n" +
    "ALTER TABLE `comerciantes` MODIFY `nave` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci NULL;\n"
  );

  // Limpiar todas las tablas
  const tablasLimpiar = [
    "coberturas_naves_supervisores",
    "permisos_supervisores",
    "reglas_dias_no_laborables",
    "auditoria_registros",
    "sesiones_control_supervisor",
    "registros_asistencia",
    "puestos",
    "planos_naves",
    "comerciantes",
    "naves",
    "usuarios",
  ];
  for (const t of tablasLimpiar) {
    bloques.push(`DELETE FROM \`${t}\`;\n`);
  }

  // 1. Insertar SUPERADMIN con contraseña cifrada bcrypt
  bloques.push(
    `INSERT INTO \`usuarios\` (\`id\`,\`cedula\`,\`nombres\`,\`apellidos\`,\`correo\`,\`rol\`,\`mustChangePassword\`,\`passwordHash\`,\`navesAsignadas\`,\`estado\`,\`creadoEn\`,\`actualizadoEn\`) VALUES (${escSQL(superadmin.id)},${escSQL(superadmin.cedula)},${escSQL(superadmin.nombres)},${escSQL(superadmin.apellidos)},${escSQL(superadmin.correo)},'SUPERADMIN',0,${escSQL(superadmin.passwordHash)},'[]','Habilitado',${escSQL(ahoraISO)},${escSQL(ahoraISO)});\n`
  );

  // 2. Insertar las 27 Naves (con creadoEn escalonado por 1 segundo para respetar el orden en que NAVE A es primera)
  const baseMs = Date.now() - 60000;
  datos.navesFinales.forEach((n, idx) => {
    const ts = new Date(baseMs + idx * 1000).toISOString().replace("T", " ").replace("Z", "");
    bloques.push(
      `INSERT INTO \`naves\` (\`id\`,\`nombre\`,\`cantidadPuestos\`,\`limitePuestos\`,\`supervisores\`,\`estadoRegistro\`,\`creadoEn\`,\`actualizadoEn\`) VALUES (${escSQL(n.id)},${escSQL(n.nombre)},${n.cantidadPuestos},${n.limitePuestos},'[]','Habilitado',${escSQL(ts)},${escSQL(ts)});\n`
    );
  });

  // 3. Insertar los 27 Planos Espaciales (planos_naves)
  for (const pl of datos.planosFinales) {
    const jsonStr = JSON.stringify(pl.celdas);
    bloques.push(
      `INSERT INTO \`planos_naves\` (\`id\`,\`naveId\`,\`filas\`,\`columnas\`,\`planoJson\`,\`actualizadoEn\`) VALUES (${escSQL(pl.id)},${escSQL(pl.naveId)},${pl.filas},${pl.columnas},${escSQL(jsonStr)},${escSQL(ahoraISO)});\n`
    );
  }

  // 4. Insertar Comerciantes en lotes de 200
  for (let i = 0; i < datos.comerciantesFinales.length; i += 200) {
    const chunk = datos.comerciantesFinales.slice(i, i + 200);
    const vals = chunk
      .map(
        (c) =>
          `(${escSQL(c.idInterno)},${escSQL(c.ciu)},${escSQL(c.cedula)},${escSQL(c.contribuyente)},${escSQL(c.actividad)},${escSQL(c.puestoId)},${escSQL(c.nave)},${escSQL(c.estadoRegistro)},${escSQL(c.creadoPor)},${escSQL(ahoraISO)},${escSQL(ahoraISO)})`
      )
      .join(",\n");
    bloques.push(
      `INSERT INTO \`comerciantes\` (\`idInterno\`,\`ciu\`,\`cedula\`,\`contribuyente\`,\`actividad\`,\`puestoId\`,\`nave\`,\`estadoRegistro\`,\`creadoPor\`,\`creadoEn\`,\`actualizadoEn\`) VALUES\n${vals};\n`
    );
  }

  // 5. Insertar Puestos en lotes de 200
  for (let i = 0; i < datos.puestosFinales.length; i += 200) {
    const chunk = datos.puestosFinales.slice(i, i + 200);
    const vals = chunk
      .map(
        (p) =>
          `(${escSQL(p.id)},${escSQL(p.codigo)},${escSQL(p.naveId)},${escSQL(p.estado)},${escSQL(p.comercianteId)},${escSQL(ahoraISO)},${escSQL(ahoraISO)})`
      )
      .join(",\n");
    bloques.push(
      `INSERT INTO \`puestos\` (\`id\`,\`codigo\`,\`naveId\`,\`estado\`,\`comercianteId\`,\`creadoEn\`,\`actualizadoEn\`) VALUES\n${vals};\n`
    );
  }

  bloques.push("COMMIT;\nSET UNIQUE_CHECKS = 1;\nSET FOREIGN_KEY_CHECKS = 1;\n");
  return bloques;
}

// ── 6. Flujo Principal Interactivo ────────────────────────────────────────────
async function main() {
  cargarEnv();
  const { preguntar, cerrar } = crearPrompt();

  console.log("=========================================================================");
  console.log("   🏛️  ASISTENTE DE INICIALIZACIÓN Y SEMBRADO MAESTRO EP-EMA           ");
  console.log("=========================================================================");

  const modoInput = await preguntar(
    "¿En qué entorno deseas inicializar la base de datos? (dev / produccion)",
    "dev"
  );
  const esProduccion = modoInput.toLowerCase().startsWith("prod");

  // Leer credenciales del SUPERADMIN desde .env
  let adminId = process.env.SUPERADMIN_ID || "u-super";
  let adminCedula = process.env.SUPERADMIN_CEDULA || "admin";
  let adminNombres = process.env.SUPERADMIN_NOMBRES || "Administrador";
  let adminApellidos = process.env.SUPERADMIN_APELLIDOS || "Sistema";
  let adminCorreo = process.env.SUPERADMIN_CORREO || "sistema.epema@gmail.com";
  let adminPasswordPlano = process.env.SUPERADMIN_PASSWORD || "Ravine.Snooze.Cover9.Defendant";

  if (esProduccion) {
    console.log("\n── Configuración de Conexión MySQL para PRODUCCIÓN ──");
    const dbHost = await preguntar("Host del servidor MySQL", "127.0.0.1");
    const dbPort = await preguntar("Puerto de MySQL", "3306");
    const dbUser = await preguntar("Usuario de MySQL", "root");
    const dbPass = await preguntar("Contraseña de MySQL", "");
    const dbName = await preguntar("Nombre de la Base de Datos", "ep_ema_db");

    console.log("\n── Confirmación de Credenciales del SUPERADMIN (leídas desde .env) ──");
    adminCedula = await preguntar("Usuario / Cédula del SUPERADMIN", adminCedula);
    adminCorreo = await preguntar("Correo del SUPERADMIN", adminCorreo);
    adminPasswordPlano = await preguntar("Contraseña del SUPERADMIN (se cifrará con bcrypt)", adminPasswordPlano);

    const authPart = dbPass ? `${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPass)}` : encodeURIComponent(dbUser);
    const nuevaUrl = `mysql://${authPart}@${dbHost}:${dbPort}/${dbName}?connection_limit=15&pool_timeout=30&connect_timeout=20`;
    actualizarDatabaseUrlEnEnv(nuevaUrl);
    console.log(`✅ DATABASE_URL actualizado en .env apuntando a ${dbHost}:${dbPort}/${dbName}`);
  } else {
    console.log("\n── Modo DESARROLLO (Docker ep_ema_mysql en puerto 3307) seleccionado ──");
    console.log(`👤 SUPERADMIN desde .env -> Usuario: ${adminCedula} | Correo: ${adminCorreo}`);
  }

  cerrar();

  // Cifrar la contraseña del SUPERADMIN con bcrypt (10 rondas)
  console.log("🔐 Cifrando contraseña de SUPERADMIN con bcrypt (10 salt rounds)...");
  const passwordHash = await bcrypt.hash(adminPasswordPlano, 10);
  const superadminData = {
    id: adminId,
    cedula: adminCedula,
    nombres: adminNombres,
    apellidos: adminApellidos,
    correo: adminCorreo,
    passwordHash,
  };

  // Extraer datos maestros de prisma/viejo.sql
  const datosMaestros = leerDatosMaestrosDesdeSQL();
  console.log(
    `📦 Datos extraídos del SQL:\n` +
      `   • Naves: ${datosMaestros.navesFinales.length}\n` +
      `   • Planos Espaciales (Croquis): ${datosMaestros.planosFinales.length}\n` +
      `   • Comerciantes: ${datosMaestros.comerciantesFinales.length}\n` +
      `   • Puestos con código: ${datosMaestros.puestosFinales.length}`
  );

  const ahoraISO = new Date().toISOString().replace("T", " ").replace("Z", "");

  if (!esProduccion) {
    // ── MODO DEV: Usar contenedor Docker ep_ema_mysql ──
    console.log("\n🐳 Verificando contenedor Docker 'ep_ema_mysql'...");
    const running = execSync('docker ps --filter "name=ep_ema_mysql" --format "{{.Names}}"', {
      encoding: "utf-8",
    }).trim();

    if (!running.includes("ep_ema_mysql")) {
      console.log("⚠️ Contenedor ep_ema_mysql no está iniciado. Ejecutando 'docker compose up -d'...");
      execSync("docker compose up -d", { stdio: "inherit", cwd: projectRoot });
      await new Promise((r) => setTimeout(r, 10000));
    }

    console.log("📐 Sincronizando las 11 tablas del esquema Prisma (npx prisma db push)...");
    execSync("npx prisma db push --skip-generate", { stdio: "inherit", cwd: projectRoot });

    // 1. Inyectar Naves, Planos, Comerciantes y Puestos en Docker
    const bloquesMaestros = construirBloquesSQLMaestros(superadminData, datosMaestros, ahoraISO);
    await ejecutarSQLPorDockerStream(bloquesMaestros, "Sembrando Naves, Croquis, Puestos y Comerciantes");
    console.log("\n✅ 27 Naves, 27 Planos Espaciales, 2.254 Comerciantes y 2.272 Puestos sembrados con éxito.");

    // 2. Generar e inyectar los 60 días de registros falsos de asistencia
    console.log("\n📅 Generando 60 días de registros falsos de asistencia para modo DEV...");
    const registros60Dias = generarRegistrosAsistencia60Dias(datosMaestros.puestosFinales);

    const outJsonPath = path.join(projectRoot, "prisma", "seed-asistencia-60dias.json");
    fs.writeFileSync(outJsonPath, JSON.stringify(registros60Dias, null, 2), "utf-8");
    console.log(`💾 Archivo JSON guardado (${registros60Dias.length.toLocaleString("es-EC")} registros): prisma/seed-asistencia-60dias.json`);

    const bloquesAsistencia = ["SET FOREIGN_KEY_CHECKS = 0;\nSET UNIQUE_CHECKS = 0;\nSET AUTOCOMMIT = 0;\n"];
    const batchSize = 1000;
    for (let i = 0; i < registros60Dias.length; i += batchSize) {
      const chunk = registros60Dias.slice(i, i + batchSize);
      const vals = chunk
        .map((reg) => {
          const obsJson = reg.observaciones ? escSQL(JSON.stringify(reg.observaciones)) : "NULL";
          const permJson = reg.permisos ? escSQL(JSON.stringify(reg.permisos)) : "NULL";
          const ts = `'${reg.fecha} 08:00:00.000'`;
          return `(${escSQL(reg.id)},${escSQL(reg.comercianteId)},${escSQL(reg.puestoId)},${escSQL(reg.fecha)},${escSQL(reg.estado)},${escSQL(reg.observacion)},${escSQL(reg.observacionTexto)},${escSQL(reg.permisoInicio)},${escSQL(reg.permisoFin)},${obsJson},${permJson},${ts},${ts})`;
        })
        .join(",\n");
      bloquesAsistencia.push(
        `INSERT IGNORE INTO \`registros_asistencia\` (\`id\`,\`comercianteId\`,\`puestoId\`,\`fecha\`,\`estado\`,\`observacion\`,\`observacionTexto\`,\`permisoInicio\`,\`permisoFin\`,\`observaciones\`,\`permisos\`,\`creadoEn\`,\`actualizadoEn\`) VALUES\n${vals};\n`
      );
    }
    bloquesAsistencia.push("COMMIT;\nSET UNIQUE_CHECKS = 1;\nSET FOREIGN_KEY_CHECKS = 1;\n");

    await ejecutarSQLPorDockerStream(bloquesAsistencia, "Inyectando 60 días de asistencia en Docker");
    console.log(
      `\n🎉 ¡ENTORNO DEV COMPLETADO!\n` +
        `   • SUPERADMIN: ${adminCedula} (${adminCorreo})\n` +
        `   • 27 Naves con sus 27 Croquis reales restaurados\n` +
        `   • ${datosMaestros.comerciantesFinales.length} Comerciantes y ${datosMaestros.puestosFinales.length} Puestos\n` +
        `   • ${registros60Dias.length.toLocaleString("es-EC")} Registros de asistencia (60 días)`
    );
  } else {
    // ── MODO PRODUCCIÓN: MySQL Nativo en el puerto configurado (CERO registros falsos) ──
    console.log("\n📐 Sincronizando esquema de 11 tablas en el servidor MySQL de Producción...");
    execSync("npx prisma db push", { stdio: "inherit", cwd: projectRoot });

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL,
    });

    await prisma.$connect();

    // Asegurar colación utf8mb4_spanish_ci para distinguir N de Ñ
    await prisma
      .$executeRawUnsafe(
        "ALTER TABLE `naves` MODIFY `nombre` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci NOT NULL;"
      )
      .catch(() => {});
    await prisma
      .$executeRawUnsafe(
        "ALTER TABLE `comerciantes` MODIFY `nave` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci NULL;"
      )
      .catch(() => {});

    console.log("🧹 Limpiando tablas previas en orden de dependencias...");
    await prisma.coberturaNaveSupervisor.deleteMany({});
    await prisma.permisoSupervisor.deleteMany({});
    await prisma.reglaDiaNoLaborable.deleteMany({});
    await prisma.auditoriaRegistro.deleteMany({});
    await prisma.sesionControlSupervisor.deleteMany({});
    await prisma.registroAsistencia.deleteMany({});
    await prisma.puesto.deleteMany({});
    await prisma.planoNave.deleteMany({});
    await prisma.comerciante.deleteMany({});
    await prisma.nave.deleteMany({});
    await prisma.usuario.deleteMany({});

    console.log(`👤 Creando SUPERADMIN (${superadminData.cedula} / ${superadminData.correo})...`);
    await prisma.usuario.create({
      data: {
        id: superadminData.id,
        cedula: superadminData.cedula,
        nombres: superadminData.nombres,
        apellidos: superadminData.apellidos,
        correo: superadminData.correo,
        rol: "SUPERADMIN",
        mustChangePassword: false,
        passwordHash: superadminData.passwordHash,
        estado: "Habilitado",
        navesAsignadas: [],
      },
    });

    console.log("🏛️ Insertando las 27 Naves y sus 27 Planos Espaciales (Croquis)...");
    const baseMs = Date.now() - 60000;
    for (let i = 0; i < datosMaestros.navesFinales.length; i++) {
      const n = datosMaestros.navesFinales[i];
      await prisma.nave.create({
        data: {
          id: n.id,
          nombre: n.nombre,
          cantidadPuestos: n.cantidadPuestos,
          limitePuestos: n.limitePuestos,
          supervisores: [],
          estadoRegistro: "Habilitado",
          creadoEn: new Date(baseMs + i * 1000),
        },
      });
    }

    for (const pl of datosMaestros.planosFinales) {
      await prisma.planoNave.create({
        data: {
          id: pl.id,
          naveId: pl.naveId,
          filas: pl.filas,
          columnas: pl.columnas,
          planoJson: pl.celdas,
        },
      });
    }

    console.log("👥 Insertando Comerciantes en micro-lotes seguros de 200...");
    for (let i = 0; i < datosMaestros.comerciantesFinales.length; i += 200) {
      const lote = datosMaestros.comerciantesFinales.slice(i, i + 200);
      await prisma.comerciante.createMany({ data: lote });
    }

    console.log("🏪 Insertando Puestos en micro-lotes seguros de 200...");
    for (let i = 0; i < datosMaestros.puestosFinales.length; i += 200) {
      const lote = datosMaestros.puestosFinales.slice(i, i + 200);
      await prisma.puesto.createMany({ data: lote });
    }

    await prisma.$disconnect();

    console.log(
      `\n🎉 ¡ENTORNO DE PRODUCCIÓN INICIALIZADO EN LIMPIO!\n` +
        `   • SUPERADMIN creado: ${superadminData.cedula} (${superadminData.correo})\n` +
        `   • 27 Naves y 27 Planos Espaciales (Croquis) cargados al 100%\n` +
        `   • ${datosMaestros.comerciantesFinales.length} Comerciantes y ${datosMaestros.puestosFinales.length} Puestos vinculados\n` +
        `   • 0 Registros falsos de asistencia (Base de datos limpia para salir a producción)`
    );
  }
}

main().catch((err) => {
  console.error("\n❌ Error durante la inicialización:", err.message || err);
  process.exit(1);
});