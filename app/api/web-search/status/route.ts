import { NextResponse } from "next/server";
import { isWebSearchConfigured, isSearXNGConfigured, isPerplexicaConfigured } from "@/lib/webSearch";

export async function GET() {
  return NextResponse.json({
    available: isWebSearchConfigured(),
    searxng: isSearXNGConfigured(),
    perplexica: isPerplexicaConfigured(),
  });
}
