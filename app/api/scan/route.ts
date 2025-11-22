import { NextResponse } from "next/server";
import { scanAllFiles } from "@/lib/indexer";

export async function POST() {
  try {
    const result = await scanAllFiles();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error scanning files:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
