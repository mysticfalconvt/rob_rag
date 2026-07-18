import { type NextRequest, NextResponse } from "next/server";
import { deleteMemory, listMemories, saveMemory } from "@/lib/assistant/store";
import { requireAdmin, requireAuth } from "@/lib/session";

function errorResponse(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error.message.includes("Forbidden")) {
      return NextResponse.json(
        { error: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }
  }
  console.error("[api/assistant/memory] error:", error);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    return NextResponse.json(await listMemories());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { name, description, type, body } = await req.json();
    if (!name || typeof name !== "string" || typeof body !== "string" || !body) {
      return NextResponse.json(
        { error: "name and body are required" },
        { status: 400 },
      );
    }
    const memory = await saveMemory({
      name,
      description: typeof description === "string" ? description : "",
      type: typeof type === "string" ? type : undefined,
      body,
    });
    return NextResponse.json(memory);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);
    const name = new URL(req.url).searchParams.get("name");
    if (!name) {
      return NextResponse.json({ error: "Missing name" }, { status: 400 });
    }
    const deleted = await deleteMemory(name);
    return NextResponse.json({ deleted });
  } catch (error) {
    return errorResponse(error);
  }
}
