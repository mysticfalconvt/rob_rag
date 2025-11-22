import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export async function GET() {
  try {
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
    console.error("Error fetching models:", error);
    return NextResponse.json(
      { error: "Failed to connect to LM Studio" },
      { status: 500 },
    );
  }
}
