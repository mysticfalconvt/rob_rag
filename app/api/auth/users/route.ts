import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { createUser } from "@/lib/auth";
import prisma from "@/lib/prisma";

// GET /api/auth/users - List all users (admin only)
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const users = await prisma.authUser.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            conversations: true,
            uploadedFiles: true,
          },
        },
        conversations: {
          select: {
            id: true,
            title: true,
            updatedAt: true,
            _count: {
              select: {
                messages: true,
              },
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Transform the data to match the frontend interface
    const transformedUsers = users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      userName: null, // Not selected in query
      userBio: null, // Not selected in query
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      conversationCount: user._count.conversations,
      uploadedFileCount: user._count.uploadedFiles,
      conversations: user.conversations.map((conv) => ({
        id: conv.id,
        title: conv.title,
        updatedAt: conv.updatedAt.toISOString(),
        _count: conv._count,
      })),
    }));

    return NextResponse.json(transformedUsers);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/auth/users - Create a new user (admin only)
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(req);

    const { email, name, password, role = "user" } = await req.json();

    // Validate input
    if (!email || !name || !password) {
      return NextResponse.json(
        { error: "Email, name, and password are required" },
        { status: 400 },
      );
    }

    // Validate role
    if (role !== "user" && role !== "admin") {
      return NextResponse.json(
        { error: "Role must be either 'user' or 'admin'" },
        { status: 400 },
      );
    }

    // Create user
    const user = await createUser({
      email,
      name,
      password,
      role,
      createdBy: session.user.id,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (error.message.includes("already exists")) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (error.message.includes("validation")) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error("Error creating user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
