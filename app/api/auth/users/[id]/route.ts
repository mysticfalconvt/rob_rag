import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

// PATCH /api/auth/users/[id] - Update user (admin or self)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(req);
    const { id: userId } = await params;

    // Check permissions: admin can update anyone, user can update self
    const isAdmin = session.user.role === "admin";
    const isSelf = session.user.id === userId;

    if (!isAdmin && !isSelf) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const updateData: any = {};

    // Only admin can change these fields
    if (isAdmin) {
      if (body.role !== undefined) updateData.role = body.role;
      if (body.isActive !== undefined) updateData.isActive = body.isActive;
    }

    // Both admin and self can update these fields
    if (body.name !== undefined) updateData.name = body.name;
    if (body.userName !== undefined) updateData.userName = body.userName;
    if (body.userBio !== undefined) updateData.userBio = body.userBio;
    if (body.userPreferences !== undefined) {
      updateData.userPreferences = JSON.stringify(body.userPreferences);
    }

    // Password change (requires current password for self, not required for admin)
    if (body.password !== undefined) {
      if (!isAdmin) {
        // User changing own password - require current password
        if (!body.currentPassword) {
          return NextResponse.json(
            { error: "Current password required" },
            { status: 400 },
          );
        }

        // Verify current password
        const user = await prisma.authUser.findUnique({
          where: { id: userId },
        });

        if (!user) {
          return NextResponse.json(
            { error: "User not found" },
            { status: 404 },
          );
        }

        const bcrypt = await import("bcrypt");
        const isValid = await bcrypt.compare(
          body.currentPassword,
          user.passwordHash,
        );
        if (!isValid) {
          return NextResponse.json(
            { error: "Current password is incorrect" },
            { status: 401 },
          );
        }
      }

      updateData.passwordHash = await hashPassword(body.password);
    }

    // Update user
    const user = await prisma.authUser.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        userName: true,
        userBio: true,
        userPreferences: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE /api/auth/users/[id] - Delete user (admin only)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(req);
    const { id: userId } = await params;

    // Prevent admin from deleting themselves
    if (session.user.id === userId) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 },
      );
    }

    // Delete user (cascade will handle conversations, files, sessions)
    await prisma.authUser.delete({
      where: { id: userId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    console.error("Error deleting user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
