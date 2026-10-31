// ── API Route: POST /api/v1/auth/login ─────────────────────────────────────────

import { NextResponse } from "next/server";
import { prisma } from "@/infrastructure/database/prisma";
import { verifyPasswordHash } from "@/infrastructure/auth/password.utils";
import { firmarTokenJwt, AUTH_COOKIE_NAME } from "@/infrastructure/auth/jwt.utils";
import { logError, esErrorConexionBD } from "@/infrastructure/logger/system-logger";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { identificador, password } = body;

    if (!identificador || !password) {
      return NextResponse.json(
        { success: false, error: "Identificador y contraseña requeridos." },
        { status: 400 }
      );
    }

    const cleanId = String(identificador).trim();
    const cleanEmail = cleanId.toLowerCase();

    // Buscar por cédula, correo (sin distinguir mayúsculas/minúsculas) o alias especial 'admin'
    const usuario = await prisma.usuario.findFirst({
      where: {
        OR: [
          { cedula: cleanId },
          { correo: cleanId },
          { correo: cleanEmail },
          ...(cleanId.toLowerCase() === "admin"
            ? [{ rol: "SUPERADMIN" as const }]
            : []),
        ],
      },
    });

    if (!usuario) {
      return NextResponse.json(
        { success: false, error: "Credenciales incorrectas. Verifique usuario y contraseña." },
        { status: 401 }
      );
    }

    if (usuario.estado !== "Habilitado") {
      return NextResponse.json(
        { success: false, error: "El usuario se encuentra deshabilitado. Contacte al administrador." },
        { status: 403 }
      );
    }

    const passwordValida = await verifyPasswordHash(password, usuario.passwordHash);
    if (!passwordValida) {
      return NextResponse.json(
        { success: false, error: "Credenciales incorrectas. Verifique usuario y contraseña." },
        { status: 401 }
      );
    }

    const naves = Array.isArray(usuario.navesAsignadas)
      ? (usuario.navesAsignadas as string[])
      : [];

    // Firmar JWT
    const token = await firmarTokenJwt({
      sub: usuario.id,
      cedula: usuario.cedula,
      rol: usuario.rol,
      navesAsignadas: naves,
    });

    const userResponse = {
      id: usuario.id,
      cedula: usuario.cedula,
      nombres: usuario.nombres,
      apellidos: usuario.apellidos,
      correo: usuario.correo ?? undefined,
      rol: usuario.rol,
      mustChangePassword: usuario.mustChangePassword,
      navesAsignadas: naves,
      estado: usuario.estado,
    };

    const response = NextResponse.json({
      success: true,
      user: userResponse,
    });

    const forwardedProto = request.headers.get("x-forwarded-proto");
    const isHttps =
      forwardedProto === "https" ||
      request.url.startsWith("https://") ||
      process.env.FORCE_SECURE_COOKIE === "true";

    // Guardar JWT en cookie HttpOnly compatible con LAN (HTTP y HTTPS)
    response.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60, // 8 horas
    });

    return response;
  } catch (error) {
    logError("API", "Error en POST /api/v1/auth/login", error);
    if (esErrorConexionBD(error)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El servidor de base de datos MySQL no se encuentra disponible en este momento. Verifique que el servicio esté iniciado.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { success: false, error: "Error interno del servidor al autenticar." },
      { status: 500 }
    );
  }
}
