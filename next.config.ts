import type { NextConfig } from "next";
import os from "os";

function getDynamicNetworkOrigins(): string[] {
  const origins = new Set<string>(["localhost", "127.0.0.1", "*.local"]);
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal && net.address) {
        origins.add(net.address);
        const parts = net.address.split(".");
        if (parts.length === 4) {
          const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
          for (let i = 1; i <= 254; i++) {
            origins.add(`${prefix}.${i}`);
          }
        }
      }
    }
  }

  return Array.from(origins);
}

const nextConfig: NextConfig = {
  allowedDevOrigins: getDynamicNetworkOrigins(),
};

export default nextConfig;
