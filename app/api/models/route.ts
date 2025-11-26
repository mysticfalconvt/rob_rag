import { type NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { requireAuth } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const res = await fetch(`${config.LM_STUDIO_API_URL}/models`);

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch models from LM Studio" },
        { status: 500 },
      );
    }

    const data = await res.json();

    // LM Studio returns { data: [ { id: "model-name", ... }, ... ] }
    const models = data.data?.map((model: any) => model.id) || [];

    return NextResponse.json({ models });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching models:", error);
    return NextResponse.json(
      { error: "Failed to connect to LM Studio" },
      { status: 500 },
    );
  }
}
