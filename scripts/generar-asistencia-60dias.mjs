// scripts/generar-asistencia-60dias.mjs
// Generador de 60 días de historial de asistencia para todos los comerciantes
// Soporta exportación a JSON, SQL e inserción directa en MySQL por micro-lotes seguros.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// 1. Cargar variables de entorno desde .env manualmente antes de inicializar Prisma
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
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

// 2. Parser de tuplas MySQL para respaldo desde viejo.sql si no se usa BD
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

// 3. Generador determinista pseudoaleatorio para realismo de asistencias
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

  let prisma = null;
  let vinculos = [];

  if (insertarEnBD) {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient({
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
    });

    console.log("🔌 Verificando conexión activa con MySQL...");
    try {
      await prisma.$connect();
      // Ampliar max_allowed_packet y timeouts de la sesión actual si el usuario tiene privilegios
      await prisma.$executeRawUnsafe("SET SESSION net_read_timeout = 120").catch(() => {});
      await prisma.$executeRawUnsafe("SET SESSION net_write_timeout = 120").catch(() => {});
    } catch (connErr) {
      console.error("❌ No se pudo conectar a MySQL. Verifica que el contenedor Docker (puerto 3307) o tu servicio MySQL local (3306) esté encendido y que DATABASE_URL en .env sea correcto.");
      console.error("Detalle:", connErr.message);
      process.exit(1);
    }

    // Consultar directamente los puestos ocupados reales en la base de datos para garantizar integridad referencial (FK)
    const puestosOcupadosBD = await prisma.puesto.findMany({
      where: { comercianteId: { not: null } },
      select: { id: true, comercianteId: true },
    });

    if (puestosOcupadosBD.length > 0) {
      vinculos = puestosOcupadosBD.map((p) => ({
        comercianteId: p.comercianteId,
        puestoId: p.id,
      }));
      console.log(`✅ Comerciantes activos leídos directamente desde MySQL: ${vinculos.length}`);
    } else {
      console.log("⚠️ La tabla 'puestos' en MySQL está vacía. Ejecuta primero 'npx prisma db seed'. Leyendo desde viejo.sql para el JSON...");
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
    const esc = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);

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

  if (insertarEnBD && prisma) {
    // Micro-lotes de 250 registros para nunca exceder max_allowed_packet de MySQL
    const BATCH_SIZE = 250;
    let insertados = 0;
    const totalLotes = Math.ceil(registros.length / BATCH_SIZE);

    console.log(`🚀 Insertando ${registros.length.toLocaleString("es-EC")} registros en MySQL en ${totalLotes} micro-lotes de ${BATCH_SIZE}...`);

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

      let exitoLote = false;
      for (let intento = 1; intento <= 3; intento++) {
        try {
          const res = await prisma.registroAsistencia.createMany({
            data: lote,
            skipDuplicates: true,
          });
          insertados += res.count;
          exitoLote = true;
          break;
        } catch (err) {
          if (intento === 3) {
            console.error(`\n❌ Error definitivo en el lote ${Math.floor(i / BATCH_SIZE) + 1}:`, err.message);
            await prisma.$disconnect();
            process.exit(1);
          }
          // Reconectar si MySQL cerró el socket temporalmente
          await prisma.$disconnect().catch(() => {});
          await new Promise((r) => setTimeout(r, 1000));
          await prisma.$connect();
        }
      }

      const loteActual = Math.floor(i / BATCH_SIZE) + 1;
      if (loteActual % 20 === 0 || loteActual === totalLotes) {
        const pct = ((loteActual / totalLotes) * 100).toFixed(1);
        process.stdout.write(`\r⏳ Progreso: Lote ${loteActual}/${totalLotes} (${pct}%) — Insertados: ${insertados.toLocaleString("es-EC")}   `);
      }
    }

    console.log(`\n🎉 Inserción en MySQL completada con éxito: ${insertados.toLocaleString("es-EC")} registros almacenados.`);
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ Error inesperado:", err);
  process.exit(1);
});
