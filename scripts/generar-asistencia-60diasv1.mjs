import fs from "fs";
import path from "path";

/**
 * Script generador de 60 días (2 meses) de registros falsos de asistencia
 * para TODOS los comerciantes existentes en prisma/viejo.sql.
 *
 * Genera:
 * 1. prisma/seed-asistencia-60dias.json (JSON completo con todos los comerciantes x 60 días)
 * 2. prisma/seed-asistencia-60dias.sql  (Script SQL por lotes listo para importar en MySQL si se desea)
 *
 * Si se ejecuta con el argumento --db, también inserta los registros directamente en MySQL vía Prisma.
 */

const rootDir = process.cwd();
const sqlCandidates = [
  path.resolve(rootDir, "prisma", "viejo.sql"),
  path.resolve(rootDir, "viejo.sql"),
];

const sqlPath = sqlCandidates.find((p) => fs.existsSync(p));
if (!sqlPath) {
  console.error("❌ No se encontró prisma/viejo.sql ni viejo.sql en el proyecto.");
  process.exit(1);
}

console.log(`📖 Leyendo comerciantes desde: ${sqlPath}...`);
const sqlContent = fs.readFileSync(sqlPath, "utf-8");

// Extraer todas las filas de INSERT INTO `comerciantes` VALUES (...)
function extractInsertRows(sql, tableName) {
  const regex = new RegExp(`INSERT INTO \`${tableName}\` VALUES\\s*([\\s\\S]*?);\\r?\\n`, "g");
  const rows = [];
  let match;

  while ((match = regex.exec(sql)) !== null) {
    const valsStr = match[1];
    let i = 0;
    const n = valsStr.length;

    while (i < n) {
      while (i < n && valsStr[i] !== "(") i++;
      if (i >= n) break;
      i++; // saltar '('
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
  }
  return rows;
}

const rawComerciantes = extractInsertRows(sqlContent, "comerciantes");
if (rawComerciantes.length === 0) {
  console.error("❌ No se encontraron comerciantes en el archivo SQL.");
  process.exit(1);
}

// Estructura de la tabla comerciantes en viejo.sql:
// [0:id, 1:nombres, 2:cedula, 3:nave, 4:nave_id, 5:puesto, 6:producto, 7:estado, 8:dias_asignados, ...]
const comerciantes = rawComerciantes.map((r) => ({
  id: String(r[0]),
  nombres: String(r[1] || "COMERCIANTE SIN NOMBRE"),
  cedula: r[2] ? String(r[2]) : null,
  nave: String(r[3] || "SIN NAVE"),
  naveId: String(r[4] || "nave-a"),
  puesto: String(r[5] || "S/N"),
  producto: String(r[6] || "VARIOS"),
  estado: String(r[7] || "ACTIVO"),
}));

console.log(`✅ Comerciantes extraídos: ${comerciantes.length}`);

// Generar lista de 60 días calendario hacia atrás desde el 2026-10-31 (2 meses completos)
const TOTAL_DIAS = 60;
const fechaFin = new Date("2026-10-31T12:00:00Z");
const fechas = [];

for (let d = TOTAL_DIAS - 1; d >= 0; d--) {
  const dt = new Date(fechaFin);
  dt.setUTCDate(dt.getUTCDate() - d);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  fechas.push(`${yyyy}-${mm}-${dd}`);
}

console.log(`📅 Rango de 60 días: ${fechas[0]} al ${fechas[fechas.length - 1]}`);

// Catálogos de datos realistas para simulación
const SUPERVISORES = [
  "admin",
  "supervisor.norte",
  "supervisor.sur",
  "inspector.catastro1",
  "inspector.catastro2",
];

const OBSERVACIONES_PRESENTE = [
  null,
  null,
  null,
  null,
  "Puesto limpio y en orden",
  "Apertura puntual en nave",
  "Presente en jornada regular",
  "Verificado en recorrido matutino",
];

const OBSERVACIONES_FALTA = [
  "Puesto cerrado durante la inspección de control",
  "No registra ingreso en el turno matutino",
  "Ausencia verificada en recorrido de nave",
  "Sin actividad comercial en la fecha",
];

const JUSTIFICACIONES = [
  "Certificado médico del IESS presentado en administración",
  "Cita médica programada justificada con comprobante",
  "Calamidad doméstica notificada a jefatura de catastro",
  "Trámite municipal urgente respaldado con documento",
];

const OBSERVACIONES_PERMISO = [
  "Permiso autorizado por administración EP-EMA",
  "Permiso temporal por mantenimiento de puesto",
  "Licencia autorizada por abastecimiento en provincia",
];

// Generador pseudoaleatorio determinista (Mulberry32) para reproducibilidad
function createRng(seed = 20261031) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createRng(20261031);

function pickRandom(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function randomHora(minHour = 6, maxHour = 9) {
  const h = minHour + Math.floor(rng() * (maxHour - minHour + 1));
  const m = Math.floor(rng() * 60);
  const s = Math.floor(rng() * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const registros = [];

for (const fecha of fechas) {
  for (const com of comerciantes) {
    const roll = rng();
    let estado = "PRESENTE";
    let observacion = null;
    let justificacion = null;
    let documentoAdjunto = null;

    // Distribución realista: 84% PRESENTE, 9% FALTA, 4% JUSTIFICADO, 3% PERMISO
    if (roll < 0.84) {
      estado = "PRESENTE";
      observacion = pickRandom(OBSERVACIONES_PRESENTE);
    } else if (roll < 0.93) {
      estado = "FALTA";
      observacion = pickRandom(OBSERVACIONES_FALTA);
    } else if (roll < 0.97) {
      estado = "JUSTIFICADO";
      observacion = "Falta justificada mediante oficio en ventanilla";
      justificacion = pickRandom(JUSTIFICACIONES);
      documentoAdjunto = `DOC-JUST-${fecha.replace(/-/g, "")}-${com.id}.pdf`;
    } else {
      estado = "PERMISO";
      observacion = pickRandom(OBSERVACIONES_PERMISO);
      justificacion = "Permiso administrativo aprobado";
    }

    const horaRegistro = randomHora(6, 10);
    const registradoPor = pickRandom(SUPERVISORES);

    registros.push({
      id: `asis_${com.id}_${fecha}`,
      comercianteId: com.id,
      comercianteNombres: com.nombres,
      comercianteCedula: com.cedula,
      naveId: com.naveId,
      nave: com.nave,
      puesto: com.puesto,
      fecha,
      estado,
      observacion,
      justificacion,
      documentoAdjunto,
      horaRegistro,
      registradoPor,
    });
  }
}

const outputJsonPath = path.resolve(rootDir, "prisma", "seed-asistencia-60dias.json");

const payload = {
  metadata: {
    generadoEn: new Date().toISOString(),
    totalComerciantes: comerciantes.length,
    totalDias: TOTAL_DIAS,
    fechaInicio: fechas[0],
    fechaFin: fechas[fechas.length - 1],
    totalRegistros: registros.length,
  },
  registros,
};

console.log(`💾 Guardando ${registros.length.toLocaleString()} registros en prisma/seed-asistencia-60dias.json...`);
fs.writeFileSync(outputJsonPath, JSON.stringify(payload, null, 2), "utf-8");
console.log(`✅ Archivo JSON creado exitosamente: ${outputJsonPath}`);

// Opcional: Si el usuario pasa --sql, genera también un archivo .sql para importar rápido
if (process.argv.includes("--sql")) {
  const sqlOutPath = path.resolve(rootDir, "prisma", "seed-asistencia-60dias.sql");
  console.log(`💾 Generando archivo SQL masivo en: ${sqlOutPath}...`);
  const stream = fs.createWriteStream(sqlOutPath, { encoding: "utf-8" });
  stream.write("-- Sembrado masivo de 60 días de asistencia para todos los comerciantes\n");
  stream.write("SET FOREIGN_KEY_CHECKS = 0;\n");

  const BATCH_SIZE = 1000;
  const esc = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);

  for (let i = 0; i < registros.length; i += BATCH_SIZE) {
    const chunk = registros.slice(i, i + BATCH_SIZE);
    const values = chunk
      .map(
        (r) =>
          `(${esc(r.id)},${esc(r.comercianteId)},${esc(r.fecha)},${esc(r.estado)},${esc(r.observacion)},${esc(r.justificacion)},${esc(r.documentoAdjunto)},${esc(r.horaRegistro)},${esc(r.registradoPor)},NOW(3),NOW(3))`
      )
      .join(",\n");

    stream.write(
      `INSERT IGNORE INTO \`registros_asistencia\` (\`id\`,\`comerciante_id\`,\`fecha\`,\`estado\`,\`observacion\`,\`justificacion\`,\`documento_adjunto\`,\`hora_registro\`,\`registrado_por\`,\`created_at\`,\`updated_at\`) VALUES\n${values};\n`
    );
  }

  stream.write("SET FOREIGN_KEY_CHECKS = 1;\n");
  stream.end();
  console.log(`✅ Archivo SQL generado exitosamente.`);
}

// Opcional: Si el usuario pasa --db, inserta directamente en la base de datos vía Prisma
if (process.argv.includes("--db")) {
  console.log("🚀 Conectando a MySQL mediante Prisma para insertar los registros en lotes...");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const BATCH_SIZE = 2000;
    let insertados = 0;
    for (let i = 0; i < registros.length; i += BATCH_SIZE) {
      const lote = registros.slice(i, i + BATCH_SIZE).map((r) => ({
        id: r.id,
        comercianteId: r.comercianteId,
        fecha: r.fecha,
        estado: r.estado,
        observacion: r.observacion,
        justificacion: r.justificacion,
        documentoAdjunto: r.documentoAdjunto,
        horaRegistro: r.horaRegistro,
        registradoPor: r.registradoPor,
      }));
      const res = await prisma.registroAsistencia.createMany({
        data: lote,
        skipDuplicates: true,
      });
      insertados += res.count;
      console.log(`   -> Lote procesado (${Math.min(i + BATCH_SIZE, registros.length)}/${registros.length})`);
    }
    console.log(`✅ Se insertaron ${insertados.toLocaleString()} nuevos registros en la tabla registros_asistencia.`);
  } catch (err) {
    console.error("❌ Error insertando en la base de datos:", err);
  } finally {
    await prisma.$disconnect();
  }
}