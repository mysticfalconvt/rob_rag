import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    if (!settings?.githubToken) {
      return NextResponse.json(
        { error: "GitHub token is required" },
        { status: 400 },
      );
    }

    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${settings.githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "rob-rag",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error:
            res.status === 401
              ? "GitHub rejected the token (401). Use a classic PAT with 'repo' scope."
              : `GitHub API returned ${res.status}: ${body.slice(0, 200) || res.statusText}`,
        },
        { status: 502 },
      );
    }

    const user = await res.json();
    return NextResponse.json({ success: true, login: user.login });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    console.error("Error testing GitHub connection:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connection failed" },
      { status: 500 },
    );
  }
}
