// scripts/generar-asistencia-60dias.mjs
// Generador e Inyector de 60 días de historial de asistencia (135.240 registros)
// Soporta inserción ultrarrápida vía Docker (ep_ema_mysql) o vía Prisma (MySQL nativo 3306).

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// 1. Leer .env (forzando prioridad sobre variables de entorno previas y cambiando localhost -> 127.0.0.1)
const envPath = path.join(projectRoot, ".env");
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, "utf-8");
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

if (process.env.DATABASE_URL) {
  // Evitar que Node.js en Windows resuelva localhost a ::1 (IPv6), lo cual cierra la conexión en Docker
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace("@localhost:", "@127.0.0.1:");
}

// 2. Parser de tuplas MySQL desde viejo.sql
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

function extraerVinculosDesdeSQL() {
  const posibles = [
    path.join(projectRoot, "prisma", "viejo.sql"),
    path.join(projectRoot, "viejo.sql"),
    path.join(projectRoot, "prisma", "viejo_2.sql"),
  ];
  const sqlFile = posibles.find((p) => fs.existsSync(p));
  if (!sqlFile) {
    throw new Error("No se encontró prisma/viejo.sql ni viejo.sql.");
  }

  console.log(`📖 Leyendo comerciantes y puestos desde: ${sqlFile}...`);
  const sqlContent = fs.readFileSync(sqlFile, "utf-8");

  const tablas = {};
  const regexInsert = /INSERT INTO `(\w+)`(?:\s*\([^)]+\))?\s*VALUES\s*([\s\S]*?);\r?\n/g;
  let match;
  while ((match = regexInsert.exec(sqlContent)) !== null) {
    const table = match[1];
    if (!tablas[table]) tablas[table] = [];
    tablas[table].push(...parseMySQLValues(match[2]));
  }

  const comerciantesSet = new Set((tablas["comerciantes"] || []).map((c) => String(c[0])));
  const vinculos = [];
  const comerciantesYaAsignados = new Set();

  for (const pRow of tablas["puestos"] || []) {
    const puestoId = String(pRow[0]);
    const comercianteId = pRow[4] ? String(pRow[4]) : null;
    if (comercianteId && comerciantesSet.has(comercianteId) && !comerciantesYaAsignados.has(comercianteId)) {
      comerciantesYaAsignados.add(comercianteId);
      vinculos.push({ comercianteId, puestoId });
    }
  }
  return vinculos;
}

// 3. Verificar si el contenedor Docker ep_ema_mysql está en ejecución
function verificarContenedorDockerActivo() {
  try {
    const out = execSync('docker ps --filter "name=ep_ema_mysql" --format "{{.Names}}"', {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.includes("ep_ema_mysql");
  } catch {
    return false;
  }
}

// 4. Obtener vínculos reales desde el contenedor Docker ep_ema_mysql
function obtenerVinculosDesdeDocker() {
  try {
    const query = "SELECT id, comercianteId FROM puestos WHERE comercianteId IS NOT NULL;";
    const out = execSync(
      `docker exec -i ep_ema_mysql mysql -u root -pep_ema_root_pass -D ep_ema_db -N -B -e "${query}"`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 50 * 1024 * 1024 }
    ).trim();

    if (!out) return [];
    const vinculos = [];
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split("\t");
      if (parts.length >= 2 && parts[0] && parts[1] && parts[1] !== "NULL") {
        vinculos.push({ puestoId: parts[0], comercianteId: parts[1] });
      }
    }
    return vinculos;
  } catch {
    return [];
  }
}

// 5. Inyectar SQL masivo directamente al contenedor ep_ema_mysql por stdin
function inyectarSQLPorDocker(registros) {
  return new Promise((resolve, reject) => {
    console.log("🐳 Contenedor 'ep_ema_mysql' detectado. Inyectando los registros directamente en MySQL vía Docker CLI...");

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
      // Ignorar advertencia estándar de contraseña en CLI de MySQL
      if (!txt.includes("Using a password on the command line interface can be insecure")) {
        stderrData += txt;
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderrData || `El proceso mysql en Docker finalizó con código ${code}`));
    });

    const esc = (v) =>
      v === null || v === undefined
        ? "NULL"
        : `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

    child.stdin.write("SET FOREIGN_KEY_CHECKS = 0;\n");
    child.stdin.write("SET UNIQUE_CHECKS = 0;\n");
    child.stdin.write("SET AUTOCOMMIT = 0;\n");

    const batchSize = 1000;
    const totalLotes = Math.ceil(registros.length / batchSize);

    let i = 0;
    function escribirSiguienteLote() {
      let ok = true;
      while (i < registros.length && ok) {
        const chunk = registros.slice(i, i + batchSize);
        const values = chunk
          .map((reg) => {
            const obsJson = reg.observaciones ? esc(JSON.stringify(reg.observaciones)) : "NULL";
            const permJson = reg.permisos ? esc(JSON.stringify(reg.permisos)) : "NULL";
            const nowStr = `'${reg.fecha} 08:00:00.000'`;
            return `(${esc(reg.id)},${esc(reg.comercianteId)},${esc(reg.puestoId)},${esc(reg.fecha)},${esc(reg.estado)},${esc(reg.observacion)},${esc(reg.observacionTexto)},${esc(reg.permisoInicio)},${esc(reg.permisoFin)},${obsJson},${permJson},${nowStr},${nowStr})`;
          })
          .join(",\n");

        const sql = `INSERT IGNORE INTO \`registros_asistencia\` (\`id\`,\`comercianteId\`,\`puestoId\`,\`fecha\`,\`estado\`,\`observacion\`,\`observacionTexto\`,\`permisoInicio\`,\`permisoFin\`,\`observaciones\`,\`permisos\`,\`creadoEn\`,\`actualizadoEn\`) VALUES\n${values};\n`;

        i += batchSize;
        const loteActual = Math.ceil(i / batchSize);
        if (loteActual % 15 === 0 || loteActual === totalLotes) {
          const pct = ((loteActual / totalLotes) * 100).toFixed(1);
          process.stdout.write(
            `\r⏳ Progreso Docker MySQL: Lote ${loteActual}/${totalLotes} (${pct}%) — ${Math.min(i, registros.length).toLocaleString("es-EC")} registros...`
          );
        }

        ok = child.stdin.write(sql);
      }

      if (i < registros.length) {
        child.stdin.once("drain", escribirSiguienteLote);
      } else {
        child.stdin.write("COMMIT;\n");
        child.stdin.write("SET UNIQUE_CHECKS = 1;\n");
        child.stdin.write("SET FOREIGN_KEY_CHECKS = 1;\n");
        child.stdin.end();
      }
    }

    escribirSiguienteLote();
  });
}

// 6. Generador determinista pseudoaleatorio para realismo de asistencias
function createRng(seed = 20261031) {
  let state = seed >>> 0;
  return function () {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function generarFechas60Dias(fechaFinStr = "2026-10-31", totalDias = 60) {
  const fechas = [];
  const [y, m, d] = fechaFinStr.split("-").map(Number);
  const fin = new Date(Date.UTC(y, m - 1, d));

  for (let offset = totalDias - 1; offset >= 0; offset--) {
    const dt = new Date(fin.getTime() - offset * 86400000);
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    fechas.push(`${yyyy}-${mm}-${dd}`);
  }
  return fechas;
}

const MOTIVOS_OBSERVACION = [
  "Puesto limpio y ordenado durante la inspección matutina.",
  "Se recuerda mantener despejado el pasillo de circulación.",
  "Apertura del puesto con 20 minutos de retraso.",
  "Verificación de balanza y precios exhibidos correctamente.",
  "Notificación preventiva por almacenamiento fuera de línea.",
];

const MOTIVOS_PERMISO = [
  "Cita médica justificada en el IESS",
  "Calamidad doméstica familiar debidamente respaldada",
  "Trámite administrativo personal urgente",
  "Reposo médico por prescripción facultativa",
];

async function main() {
  const args = process.argv.slice(2);
  const insertarEnBD = args.includes("--db");
  const exportarSQL = args.includes("--sql");

  const dockerActivo = verificarContenedorDockerActivo();
  let vinculos = [];

  if (insertarEnBD && dockerActivo) {
    vinculos = obtenerVinculosDesdeDocker();
    if (vinculos.length > 0) {
      console.log(`✅ Comerciantes ocupados leídos desde el contenedor MySQL: ${vinculos.length}`);
    } else {
      console.log("⚠️ La tabla 'puestos' en el contenedor está vacía. Usando vínculos de viejo.sql...");
      vinculos = extraerVinculosDesdeSQL();
    }
  } else {
    vinculos = extraerVinculosDesdeSQL();
    console.log(`✅ Comerciantes extraídos: ${vinculos.length}`);
  }

  const fechas = generarFechas60Dias("2026-10-31", 60);
  console.log(`📅 Rango de 60 días: ${fechas[0]} al ${fechas[fechas.length - 1]}`);

  const rng = createRng(20261031);
  const registros = [];

  for (const { comercianteId, puestoId } of vinculos) {
    for (const fecha of fechas) {
      const r = rng();
      let estado = "Presente";
      let observacion = null;
      let observacionTexto = null;
      let permisoInicio = null;
      let permisoFin = null;
      let observaciones = null;
      let permisos = null;

      // Distribución realista: 88% Presente, 8% Ausente, 4% Permiso
      if (r < 0.88) {
        estado = "Presente";
        if (rng() < 0.03) {
          const textoObs = MOTIVOS_OBSERVACION[Math.floor(rng() * MOTIVOS_OBSERVACION.length)];
          observacion = textoObs;
          observacionTexto = textoObs;
          observaciones = [
            {
              id: crypto.randomUUID(),
              tipo: "ObservacionesGeneral",
              numeroDocumento: `OBS-${fecha.replace(/-/g, "")}`,
              texto: textoObs,
              fechaHora: `${fecha}T08:30:00.000Z`,
            },
          ];
        }
      } else if (r < 0.96) {
        estado = "Ausente";
        if (rng() < 0.15) {
          const textoCit = "Ausencia sin justificación previa en control operativo.";
          observacion = textoCit;
          observacionTexto = textoCit;
          observaciones = [
            {
              id: crypto.randomUUID(),
              tipo: "Notificacion",
              numeroDocumento: `NOT-${fecha.replace(/-/g, "")}`,
              texto: textoCit,
              fechaHora: `${fecha}T09:15:00.000Z`,
            },
          ];
        }
      } else {
        estado = "Permiso";
        const motivoPerm = MOTIVOS_PERMISO[Math.floor(rng() * MOTIVOS_PERMISO.length)];
        permisoInicio = fecha;
        permisoFin = fecha;
        observacion = `Permiso autorizado: ${motivoPerm}`;
        observacionTexto = observacion;
        permisos = [
          {
            id: crypto.randomUUID(),
            motivo: motivoPerm,
            fechaAsignacion: `${fecha}T07:00:00.000Z`,
            fechaInicio: fecha,
            fechaFin: fecha,
          },
        ];
      }

      registros.push({
        id: crypto.randomUUID(),
        comercianteId,
        puestoId,
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

  const outJsonPath = path.join(projectRoot, "prisma", "seed-asistencia-60dias.json");
  console.log(`💾 Guardando ${registros.length.toLocaleString("es-EC")} registros en prisma/seed-asistencia-60dias.json...`);
  fs.writeFileSync(outJsonPath, JSON.stringify(registros, null, 2), "utf-8");
  console.log(`✅ Archivo JSON creado exitosamente: ${outJsonPath}`);

  if (exportarSQL) {
    const outSqlPath = path.join(projectRoot, "prisma", "seed-asistencia-60dias.sql");
    console.log(`💾 Generando archivo SQL por lotes en: ${outSqlPath}...`);
    const stream = fs.createWriteStream(outSqlPath, { encoding: "utf-8" });
    stream.write("-- Volcado de 60 días de asistencia EP-EMA\n");
    stream.write("SET FOREIGN_KEY_CHECKS = 0;\n");

    const sqlBatchSize = 500;
    const esc = (v) =>
      v === null || v === undefined
        ? "NULL"
        : `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

    for (let i = 0; i < registros.length; i += sqlBatchSize) {
      const chunk = registros.slice(i, i + sqlBatchSize);
      const values = chunk
        .map((reg) => {
          const obsJson = reg.observaciones ? esc(JSON.stringify(reg.observaciones)) : "NULL";
          const permJson = reg.permisos ? esc(JSON.stringify(reg.permisos)) : "NULL";
          const nowStr = `'${reg.fecha} 08:00:00.000'`;
          return `(${esc(reg.id)},${esc(reg.comercianteId)},${esc(reg.puestoId)},${esc(reg.fecha)},${esc(reg.estado)},${esc(reg.observacion)},${esc(reg.observacionTexto)},${esc(reg.permisoInicio)},${esc(reg.permisoFin)},${obsJson},${permJson},${nowStr},${nowStr})`;
        })
        .join(",\n");

      stream.write(
        `INSERT IGNORE INTO \`registros_asistencia\` (\`id\`,\`comercianteId\`,\`puestoId\`,\`fecha\`,\`estado\`,\`observacion\`,\`observacionTexto\`,\`permisoInicio\`,\`permisoFin\`,\`observaciones\`,\`permisos\`,\`creadoEn\`,\`actualizadoEn\`) VALUES\n${values};\n\n`
      );
    }
    stream.write("SET FOREIGN_KEY_CHECKS = 1;\n");
    stream.end();
    console.log(`✅ Archivo SQL generado: ${outSqlPath}`);
  }

  if (insertarEnBD) {
    if (dockerActivo) {
      await inyectarSQLPorDocker(registros);
      console.log(`\n🎉 ¡Éxito! Los ${registros.length.toLocaleString("es-EC")} registros de 60 días quedaron insertados en el contenedor MySQL.`);
    } else {
      console.log("🔌 Conectando a MySQL local mediante Prisma (127.0.0.1)...");
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL } },
      });
      await prisma.$connect();

      const BATCH_SIZE = 250;
      const totalLotes = Math.ceil(registros.length / BATCH_SIZE);
      let insertados = 0;

      for (let i = 0; i < registros.length; i += BATCH_SIZE) {
        const lote = registros.slice(i, i + BATCH_SIZE).map((r) => ({
          id: r.id,
          comercianteId: r.comercianteId,
          puestoId: r.puestoId,
          fecha: r.fecha,
          estado: r.estado,
          observacion: r.observacion,
          observacionTexto: r.observacionTexto,
          permisoInicio: r.permisoInicio,
          permisoFin: r.permisoFin,
          ...(r.observaciones ? { observaciones: r.observaciones } : {}),
          ...(r.permisos ? { permisos: r.permisos } : {}),
        }));

        const res = await prisma.registroAsistencia.createMany({
          data: lote,
          skipDuplicates: true,
        });
        insertados += res.count;

        const loteActual = Math.floor(i / BATCH_SIZE) + 1;
        if (loteActual % 20 === 0 || loteActual === totalLotes) {
          const pct = ((loteActual / totalLotes) * 100).toFixed(1);
          process.stdout.write(`\r⏳ Progreso Prisma: Lote ${loteActual}/${totalLotes} (${pct}%) — Insertados: ${insertados.toLocaleString("es-EC")}   `);
        }
      }

      console.log(`\n🎉 Inserción en MySQL completada con éxito: ${insertados.toLocaleString("es-EC")} registros almacenados.`);
      await prisma.$disconnect();
    }
  }
}

main().catch((err) => {
  console.error("\n❌ Error inesperado:", err.message || err);
  process.exit(1);
});
