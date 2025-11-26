import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();

    if (!session.isLoggedIn || !session.user) {
      return NextResponse.json(
        { authenticated: false, user: null },
        { status: 200 },
      );
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: session.user.role,
      },
    });
  } catch (error) {
    console.error("Session check error:", error);
    return NextResponse.json(
      { authenticated: false, user: null },
      { status: 200 },
    );
  }
}
