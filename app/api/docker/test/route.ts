import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    if (!settings?.portainerUrl || !settings?.portainerApiKey) {
      return NextResponse.json(
        { error: "Portainer URL and API key are required" },
        { status: 400 },
      );
    }

    const endpointId = settings.portainerEndpointId || 1;
    const url = `${settings.portainerUrl}/api/endpoints/${endpointId}/docker/containers/json`;

    const res = await fetch(url, {
      headers: {
        "X-API-Key": settings.portainerApiKey,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Portainer API returned ${res.status}: ${body || res.statusText}` },
        { status: 502 },
      );
    }

    const containers = await res.json();
    return NextResponse.json({
      success: true,
      containerCount: containers.length,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    console.error("Error testing Portainer connection:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connection failed" },
      { status: 500 },
    );
  }
}
