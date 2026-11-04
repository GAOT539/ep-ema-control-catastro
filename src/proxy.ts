// ── Proxy Server-Side: Protección de Rutas API y Panel ───────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, verificarTokenJwt } from "@/infrastructure/auth/jwt.utils";

// Rutas públicas que no requieren autenticación
const PUBLIC_API_ROUTES = [
  "/api/v1/auth/login",
  "/api/v1/auth/forgot-password",
  "/api/v1/auth/logout",
];

// Rutas que requieren roles específicos (prefijos para cualquier método)
const ROLE_RESTRICTIONS: Record<string, string[]> = {
  "/api/v1/auditoria": ["SUPERADMIN", "TIC", "DIRECTOR", "JEFE_OPERATIVO"],
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Solo interceptar rutas de la API v1
  if (!pathname.startsWith("/api/v1/")) {
    return NextResponse.next();
  }

  // Rutas públicas: dejar pasar
  if (PUBLIC_API_ROUTES.some((route) => pathname === route)) {
    return NextResponse.next();
  }

  // Obtener token de la cookie o del header Authorization
  let token = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return NextResponse.json(
      { error: "No autorizado. Token de sesión no encontrado." },
      { status: 401 }
    );
  }

  // Verificar token JWT
  const payload = await verificarTokenJwt(token);
  if (!payload || !payload.sub || !payload.rol) {
    return NextResponse.json(
      { error: "Sesión expirada o inválida. Inicie sesión nuevamente." },
      { status: 401 }
    );
  }

  // Verificar restricciones de rol por ruta
  const method = request.method.toUpperCase();
  const rol = payload.rol as string;

  for (const [routePrefix, allowedRoles] of Object.entries(ROLE_RESTRICTIONS)) {
    if (pathname.startsWith(routePrefix)) {
      if (!allowedRoles.includes(rol)) {
        return NextResponse.json(
          { error: "Acceso denegado. No tiene permisos para esta operación." },
          { status: 403 }
        );
      }
    }
  }

  // Refuerzo de validación por método y matriz oficial de roles
  // 1. /api/v1/usuarios:
  // - GET: permitido para SUPERADMIN, TIC, DIRECTOR y JEFE_OPERATIVO (para selectores de supervisores en control y reportes)
  // - POST, PUT, DELETE: exclusivamente SUPERADMIN y TIC (administración de cuentas y restablecimiento de claves)
  if (pathname.startsWith("/api/v1/usuarios")) {
    if (method === "GET") {
      if (!["SUPERADMIN", "TIC", "DIRECTOR", "JEFE_OPERATIVO"].includes(rol)) {
        return NextResponse.json(
          { error: "Acceso denegado. No tiene permisos para consultar usuarios." },
          { status: 403 }
        );
      }
    } else if (["POST", "PUT", "DELETE"].includes(method)) {
      if (!["SUPERADMIN", "TIC"].includes(rol)) {
        return NextResponse.json(
          { error: "Acceso denegado. Solo SUPERADMIN y TIC pueden administrar usuarios." },
          { status: 403 }
        );
      }
    }
  }

  // 2. /api/v1/naves: SUPERADMIN, TIC, DIRECTOR y JEFE_OPERATIVO tienen acceso total
  if (pathname.startsWith("/api/v1/naves")) {
    // Reporte de vacantes: exclusivo para roles directivos/administrativos
    if (pathname.startsWith("/api/v1/naves/reporte-vacantes")) {
      if (!["SUPERADMIN", "TIC", "DIRECTOR", "JEFE_OPERATIVO"].includes(rol)) {
        return NextResponse.json(
          { error: "Acceso denegado. No tiene permisos para consultar el reporte de vacantes." },
          { status: 403 }
        );
      }
    }

    // Mutaciones (POST, PUT, DELETE): creación, edición, plano, puestos y eliminación
    if (["POST", "PUT", "DELETE"].includes(method)) {
      if (!["SUPERADMIN", "TIC", "DIRECTOR", "JEFE_OPERATIVO"].includes(rol)) {
        return NextResponse.json(
          { error: "Acceso denegado. Solo roles directivos y administrativos pueden modificar o registrar naves." },
          { status: 403 }
        );
      }
    }
  }

  // 2. /api/v1/comerciantes (POST, PUT, DELETE): SUPERADMIN, TIC, DIRECTOR y JEFE_OPERATIVO
  if (
    pathname.startsWith("/api/v1/comerciantes") &&
    ["POST", "PUT", "DELETE"].includes(method)
  ) {
    if (!["SUPERADMIN", "TIC", "DIRECTOR", "JEFE_OPERATIVO"].includes(rol)) {
      return NextResponse.json(
        { error: "Acceso denegado. Solo roles directivos y administrativos pueden modificar o registrar comerciantes." },
        { status: 403 }
      );
    }
  }

  // 3. /api/v1/catastro/simular y /api/v1/catastro/importar: SUPERADMIN, TIC, DIRECTOR, JEFE_OPERATIVO y SUPERVISOR
  if (
    pathname.startsWith("/api/v1/catastro/simular") ||
    pathname.startsWith("/api/v1/catastro/importar")
  ) {
    if (!["SUPERADMIN", "TIC", "DIRECTOR", "JEFE_OPERATIVO", "SUPERVISOR"].includes(rol)) {
      return NextResponse.json(
        { error: "Acceso denegado. No tiene permisos para importar o simular catastro." },
        { status: 403 }
      );
    }
  }

  // 3. /api/v1/asistencia (POST, DELETE): solo SUPERADMIN, TIC, JEFE_OPERATIVO y SUPERVISOR (DIRECTOR es solo lectura)
  if (
    pathname.startsWith("/api/v1/asistencia") &&
    ["POST", "DELETE"].includes(method)
  ) {
    if (!["SUPERADMIN", "TIC", "JEFE_OPERATIVO", "SUPERVISOR"].includes(rol)) {
      return NextResponse.json(
        { error: "Acceso denegado. Su rol no tiene permisos para registrar o eliminar asistencia." },
        { status: 403 }
      );
    }
  }

  // Inyectar datos del usuario en los headers para que los Route Handlers los lean
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", payload.sub as string);
  requestHeaders.set("x-user-cedula", payload.cedula as string);
  requestHeaders.set("x-user-rol", payload.rol as string);
  if (payload.navesAsignadas) {
    requestHeaders.set("x-user-naves", JSON.stringify(payload.navesAsignadas));
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/api/v1/:path*"],
};
