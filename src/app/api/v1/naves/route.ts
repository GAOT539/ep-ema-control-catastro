import { NextResponse } from "next/server";
import { prisma } from "@/infrastructure/database/prisma";
import {
  sincronizarPuestosDeNaveEnBD,
  asegurarColacionEspanolEnBD,
  invalidarNavesYaVerificadas,
} from "@/infrastructure/database/nave-puestos-sync.service";
import { generarSlugNave } from "@/infrastructure/database/catastro-reconciliacion.service";
import { getAccessibleNaveIds } from "@/infrastructure/auth/authorization";
import { obtenerFechaHoyEcuador } from "@/infrastructure/database/daily-attendance.service";
import { logError, esErrorConexionBD } from "@/infrastructure/logger/system-logger";

export async function GET(request: Request) {
  try {
    const accessibleNaveIds = await getAccessibleNaveIds(request);
    const [navesRaw, supervisoresUsuarios] = await Promise.all([
      prisma.nave.findMany({
        where: accessibleNaveIds ? { id: { in: accessibleNaveIds } } : undefined,
        include: { puestos: true },
        orderBy: { creadoEn: "asc" },
      }),
      prisma.usuario.findMany({
        where: { rol: "SUPERVISOR", estado: "Habilitado" },
        select: { nombres: true, apellidos: true },
      }),
    ]);

    // Solo sincronizar naves que presenten inconsistencias reales en memoria
    let naves = navesRaw;
    const navesDescuadradas = navesRaw.filter((n) => {
      if (n.puestos.length !== n.cantidadPuestos) return true;
      const hayOcupadoSinComerciante = n.puestos.some(
        (p) => p.estado === "Ocupado" && !p.comercianteId
      );
      return hayOcupadoSinComerciante;
    });

    if (navesDescuadradas.length > 0) {
      for (const d of navesDescuadradas) {
        await sincronizarPuestosDeNaveEnBD(d.id);
      }
      naves = await prisma.nave.findMany({
        where: accessibleNaveIds ? { id: { in: accessibleNaveIds } } : undefined,
        include: { puestos: true },
        orderBy: { creadoEn: "asc" },
      });
    }

    const nombresSupervisores = Array.from(
      new Set(
        supervisoresUsuarios
          .map((s) => `${s.nombres} ${s.apellidos}`.replace(/\s+/g, " ").trim())
          .filter(Boolean)
      )
    );

    const hoyStr = obtenerFechaHoyEcuador();
    const reemplazosActivos = await prisma.coberturaNaveSupervisor.findMany({
      where: {
        tipoCobertura: "REEMPLAZO_TEMPORAL",
        estado: "ACTIVO",
        fechaInicio: { lte: hoyStr },
        fechaFin: { gte: hoyStr },
        permiso: { estado: "ACTIVO" },
      },
    });

    const mapaReemplazosPorNave = new Map<string, string[]>();
    for (const r of reemplazosActivos) {
      if (r.supervisorReemplazoNombre) {
        const arr = mapaReemplazosPorNave.get(r.naveId) || [];
        arr.push(r.supervisorReemplazoNombre);
        mapaReemplazosPorNave.set(r.naveId, arr);
      }
    }

    const formattedNaves = naves.map((n) => {
      const supervisoresBase = Array.isArray(n.supervisores) ? (n.supervisores as string[]) : [];
      const reemplazosHoy = mapaReemplazosPorNave.get(n.id) || [];
      const supervisoresTotales = Array.from(new Set([...supervisoresBase, ...reemplazosHoy]));

      return {
        id: n.id,
        nombre: n.nombre,
        cantidadPuestos: n.cantidadPuestos,
        limitePuestos: n.limitePuestos,
        supervisores: supervisoresTotales,
        reemplazosTemporalesHoy: reemplazosHoy,
        estadoRegistro: n.estadoRegistro,
        puestos: n.puestos.map((p) => ({
          id: p.id,
          codigo: p.codigo,
          naveId: p.naveId,
          estado: p.estado,
          comercianteId: p.comercianteId ?? undefined,
        })),
      };
    });

    return NextResponse.json({
      naves: formattedNaves,
      supervisoresDisponibles: nombresSupervisores,
    });
  } catch (error) {
    logError("API", "Error en GET /api/v1/naves", error);
    if (esErrorConexionBD(error)) {
      return NextResponse.json(
        {
          error:
            "El servidor de base de datos MySQL no se encuentra disponible en este momento. Verifique que el servicio esté iniciado.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Error al obtener las naves." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nombre, cantidadPuestos, supervisores } = body;

    if (!nombre) {
      return NextResponse.json({ error: "El nombre de la nave es obligatorio." }, { status: 400 });
    }

    const nombreLimpio = String(nombre).normalize("NFC").trim().toUpperCase();
    const slug = generarSlugNave(nombreLimpio);

    const idNave = slug || `nave-${Date.now()}`;
    const cantidad = Number(cantidadPuestos) > 0 ? Number(cantidadPuestos) : 100;
    const listaSupervisores = Array.isArray(supervisores)
      ? supervisores
          .map((s) => String(s).replace(/\s+/g, " ").trim())
          .filter(Boolean)
      : [];

    // Asegurar colación en español en BD antes de crear la nave
    await asegurarColacionEspanolEnBD();

    const resultado = await prisma.$transaction(async (tx) => {
      // 1. Crear la nave
      const nave = await tx.nave.create({
        data: {
          id: idNave,
          nombre: nombreLimpio,
          cantidadPuestos: cantidad,
          limitePuestos: cantidad,
          supervisores: listaSupervisores,
          estadoRegistro: "Habilitado",
        },
      });

      // 2. Generar puestos vacantes iniciales numerados como "1", "2", "3", ..., String(cantidad)
      const puestosData = [];
      for (let i = 1; i <= cantidad; i++) {
        puestosData.push({
          codigo: String(i),
          naveId: nave.id,
          estado: "Vacante" as const,
        });
      }
      await tx.puesto.createMany({ data: puestosData });

      // 3. Crear PlanoNave inicial en blanco (12x12 VACIO)
      const celdasPlano = [];
      for (let r = 0; r < 12; r++) {
        for (let c = 0; c < 12; c++) {
          celdasPlano.push({
            fila: r,
            columna: c,
            tipo: "VACIO",
            rowSpan: 1,
            colSpan: 1,
          });
        }
      }

      await tx.planoNave.create({
        data: {
          naveId: nave.id,
          filas: 12,
          columnas: 12,
          planoJson: celdasPlano,
        },
      });

      // 4. Sincronizar navesAsignadas en supervisores
      if (listaSupervisores.length > 0) {
        const todosSupervisores = await tx.usuario.findMany({
          where: { rol: "SUPERVISOR" },
        });

        for (const u of todosSupervisores) {
          const nombreCompleto = `${u.nombres} ${u.apellidos}`.replace(/\s+/g, " ").trim();
          const asignadas = Array.isArray(u.navesAsignadas) ? (u.navesAsignadas as string[]) : [];

          const coincide =
            listaSupervisores.includes(nombreCompleto) ||
            listaSupervisores.some(
              (s) => s.localeCompare(nombreCompleto, undefined, { sensitivity: "accent" }) === 0
            );

          if (coincide) {
            if (!asignadas.includes(nave.id)) {
              await tx.usuario.update({
                where: { id: u.id },
                data: { navesAsignadas: [...asignadas, nave.id] },
              });
            }
          }
        }
      }

      return nave;
    });

    invalidarNavesYaVerificadas(resultado.id);

    const puestosCreados = await prisma.puesto.findMany({ where: { naveId: resultado.id } });

    return NextResponse.json(
      {
        id: resultado.id,
        nombre: resultado.nombre,
        cantidadPuestos: resultado.cantidadPuestos,
        limitePuestos: resultado.limitePuestos,
        supervisores: listaSupervisores,
        estadoRegistro: resultado.estadoRegistro,
        puestos: puestosCreados.map((p) => ({
          id: p.id,
          codigo: p.codigo,
          naveId: p.naveId,
          estado: p.estado,
        })),
      },
      { status: 201 }
    );
  } catch (error) {
    logError("API", "Error en POST /api/v1/naves", error);
    if (esErrorConexionBD(error)) {
      return NextResponse.json(
        {
          error:
            "El servidor de base de datos MySQL no se encuentra disponible en este momento. Verifique que el servicio esté iniciado.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Error al crear la nave." }, { status: 500 });
  }
}
