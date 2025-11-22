import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { indexFile } from "@/lib/indexer";
import prisma from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Fetch the conversation with messages
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    // Generate markdown content
    const title = conversation.title || "Untitled Conversation";
    const createdDate = new Date(conversation.createdAt).toLocaleDateString();
    const updatedDate = new Date(conversation.updatedAt).toLocaleDateString();

    let markdown = `# ${title}\n\n`;
    markdown += `**Created:** ${createdDate}\n`;
    markdown += `**Last Updated:** ${updatedDate}\n`;
    markdown += `**Conversation ID:** ${id}\n\n`;
    markdown += `---\n\n`;

    // Add each message to the markdown
    for (const message of conversation.messages) {
      const role = message.role === "user" ? "👤 User" : "🤖 Assistant";
      markdown += `## ${role}\n\n`;
      markdown += `${message.content}\n\n`;

      // Add sources if available
      if (message.sources) {
        try {
          const sources = JSON.parse(message.sources);
          if (sources && sources.length > 0) {
            markdown += `### Sources\n\n`;
            for (const source of sources) {
              markdown += `- **${source.fileName}** (score: ${source.score.toFixed(3)})\n`;
              if (source.source) {
                markdown += `  - Source: ${source.source}\n`;
              }
              markdown += `  - Path: \`${source.filePath}\`\n`;
              markdown += `  - Excerpt: ${source.chunk.substring(0, 150)}...\n\n`;
            }
          }
        } catch (e) {
          console.error("Error parsing sources:", e);
        }
      }

      markdown += `---\n\n`;
    }

    // Generate a safe filename
    const safeTitle = title.replace(/[^a-zA-Z0-9-]/g, "_");
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `${safeTitle}_${timestamp}.md`;
    const uploadDir = path.join(config.DOCUMENTS_FOLDER_PATH, "File Uploads");
    const filePath = path.join(uploadDir, filename);

    // Write the markdown file
    await writeFile(filePath, markdown, "utf-8");
    console.log(`Conversation exported to ${filePath}`);

    // Index the new markdown file
    await indexFile(filePath);

    return NextResponse.json({
      success: true,
      filePath,
      filename,
    });
  } catch (error) {
    console.error("Error exporting conversation:", error);
    return NextResponse.json(
      { error: "Failed to export conversation" },
      { status: 500 },
    );
  }
}
