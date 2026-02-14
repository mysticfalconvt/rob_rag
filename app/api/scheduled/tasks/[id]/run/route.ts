import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { sendFormattedMessage } from "@/lib/matrix/sender";

/**
 * POST /api/scheduled/tasks/[id]/run
 * Trigger immediate execution of a scheduled task
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(req);

    // Require admin role
    const user = await prisma.authUser.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Get task
    const task = await prisma.scheduledTask.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const startedAt = new Date();
    let status = "success";
    let error: string | null = null;
    let response: string | null = null;
    let metadata: any = {};

    try {
      if (task.type === "matrix_reminder") {
        // Execute Matrix reminder
        if (!task.query || !task.matrixRoomId) {
          throw new Error("Missing query or matrixRoomId for reminder");
        }

        // Call RAG flow
        const internalServiceKey = process.env.INTERNAL_SERVICE_KEY;
        if (!internalServiceKey) {
          throw new Error("INTERNAL_SERVICE_KEY not configured");
        }

        const ragResponse = await fetch("http://localhost:3000/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: task.query }],
            triggerSource: "scheduled",
            internalServiceKey,
          }),
        });

        if (!ragResponse.ok) {
          throw new Error(`RAG flow returned ${ragResponse.status}`);
        }

        // Read streaming response
        const reader = ragResponse.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        let fullResponse = "";
        let sources: any[] = [];
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });

          if (chunk.includes("__SOURCES__:")) {
            const parts = chunk.split("__SOURCES__:");
            fullResponse += parts[0];

            if (parts[1]) {
              try {
                const sourcesData = JSON.parse(parts[1]);
                sources = sourcesData.sources || [];
              } catch (e) {
                console.error("[Scheduled Task] Failed to parse sources:", e);
              }
            }
          } else {
            fullResponse += chunk;
          }
        }

        response = fullResponse.trim();

        // Send to Matrix room
        await sendFormattedMessage(task.matrixRoomId, response, sources);

        metadata = {
          roomId: task.matrixRoomId,
          query: task.query,
          sourceCount: sources.length,
        };
      } else if (task.type === "auto_sync") {
        // Execute auto-sync
        if (!task.syncSource) {
          throw new Error("Missing syncSource for auto-sync task");
        }

        let syncResult: any = {};

        if (task.syncSource === "google-calendar") {
          // TODO: Implement Google Calendar sync
          throw new Error("Google Calendar auto-sync not yet implemented");
        } else if (task.syncSource === "paperless") {
          // Use existing paperless sync
          const { runScheduledSync } = await import("@/lib/paperlessSync");
          await runScheduledSync();
          syncResult = { status: "success", message: "Paperless sync completed" };
        } else if (task.syncSource === "goodreads") {
          // TODO: Implement Goodreads sync
          throw new Error("Goodreads auto-sync not yet implemented");
        } else {
          throw new Error(`Unknown sync source: ${task.syncSource}`);
        }

        response = `Sync completed: ${JSON.stringify(syncResult)}`;
        metadata = syncResult;
      } else {
        throw new Error(`Unknown task type: ${task.type}`);
      }
    } catch (err) {
      console.error("[Scheduled Task] Execution error:", err);
      status = "failed";
      error = err instanceof Error ? err.message : "Unknown error";
    }

    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();

    // Create execution record
    const execution = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        status,
        startedAt,
        completedAt,
        duration,
        error,
        response,
        metadata: JSON.stringify(metadata),
      },
    });

    // Update task last run info
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: {
        lastRun: startedAt,
        lastRunStatus: status,
        lastRunError: error,
      },
    });

    return NextResponse.json({
      execution,
      status,
      response,
      error,
      duration,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Scheduled Tasks API] Error running task:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
