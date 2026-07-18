import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });
    const query = (settings?.weatherDefaultLocation || "Burlington, VT").trim();

    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`,
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `Open-Meteo geocoding returned ${res.status}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    const hit = data?.results?.[0];
    if (!hit) {
      return NextResponse.json(
        { error: `Could not resolve location "${query}"` },
        { status: 400 },
      );
    }
    const label = [hit.name, hit.admin1, hit.country_code]
      .filter(Boolean)
      .join(", ");
    return NextResponse.json({ success: true, resolved: label });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    console.error("Error testing weather:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connection failed" },
      { status: 500 },
    );
  }
}
