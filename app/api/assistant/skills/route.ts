import { type NextRequest, NextResponse } from "next/server";
import { deleteSkill, listSkills, saveSkill } from "@/lib/assistant/store";
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
  console.error("[api/assistant/skills] error:", error);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    return NextResponse.json(await listSkills());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { name, description, whenToUse, body } = await req.json();
    if (!name || typeof name !== "string" || typeof body !== "string" || !body) {
      return NextResponse.json(
        { error: "name and body are required" },
        { status: 400 },
      );
    }
    const skill = await saveSkill({
      name,
      description: typeof description === "string" ? description : "",
      whenToUse: typeof whenToUse === "string" ? whenToUse : "",
      body,
    });
    return NextResponse.json(skill);
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
    const deleted = await deleteSkill(name);
    return NextResponse.json({ deleted });
  } catch (error) {
    return errorResponse(error);
  }
}
