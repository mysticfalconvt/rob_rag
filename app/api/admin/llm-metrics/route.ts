import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    // Require admin authentication
    const session = await requireAuth(req);
    const user = await prisma.authUser.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const timeRange = searchParams.get("timeRange") || "7d"; // 24h, 7d, 30d, all
    const requestType = searchParams.get("requestType"); // Filter by request type
    const conversationId = searchParams.get("conversationId"); // Filter by conversation
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");

    // Calculate date filter
    let dateFilter: Date | undefined;
    const now = new Date();
    switch (timeRange) {
      case "24h":
        dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "7d":
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFilter = undefined;
    }

    // Build where clause
    const where: any = {};
    if (dateFilter) {
      where.createdAt = { gte: dateFilter };
    }
    if (requestType) {
      where.requestType = requestType;
    }
    if (conversationId) {
      where.conversationId = conversationId;
    }

    // Get requests with pagination
    const [requests, totalCount] = await Promise.all([
      prisma.lLMRequest.findMany({
        where,
        include: {
          calls: {
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.lLMRequest.count({ where }),
    ]);

    // Calculate aggregate metrics
    const aggregates = await prisma.lLMRequest.aggregate({
      where,
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        duration: true,
      },
      _avg: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        duration: true,
        tokensPerSecond: true,
      },
    });

    // Get call type breakdown
    const callTypeBreakdown = await prisma.lLMCall.groupBy({
      by: ["callType"],
      where: dateFilter
        ? {
            request: {
              createdAt: { gte: dateFilter },
            },
          }
        : undefined,
      _count: {
        id: true,
      },
      _sum: {
        totalTokens: true,
        duration: true,
      },
      _avg: {
        tokensPerSecond: true,
      },
    });

    // Get model usage breakdown
    const modelBreakdown = await prisma.lLMRequest.groupBy({
      by: ["model"],
      where,
      _count: {
        id: true,
      },
      _sum: {
        totalTokens: true,
        duration: true,
      },
      _avg: {
        tokensPerSecond: true,
      },
    });

    // Get request type breakdown
    const requestTypeBreakdown = await prisma.lLMRequest.groupBy({
      by: ["requestType"],
      where,
      _count: {
        id: true,
      },
      _sum: {
        totalTokens: true,
      },
    });

    // Get time series data (requests per hour for last 24h or per day for longer ranges)
    const groupByUnit = timeRange === "24h" ? "hour" : "day";

    // Build the query dynamically - use Prisma.raw for SQL keywords
    let timeSeriesQuery;
    if (dateFilter) {
      timeSeriesQuery = Prisma.sql`
        SELECT
          DATE_TRUNC(${Prisma.raw(`'${groupByUnit}'`)}, "createdAt") as time,
          COUNT(*)::bigint as count,
          COALESCE(SUM("totalTokens"), 0)::bigint as tokens
        FROM "LLMRequest"
        WHERE "createdAt" >= ${dateFilter}
        GROUP BY DATE_TRUNC(${Prisma.raw(`'${groupByUnit}'`)}, "createdAt")
        ORDER BY time DESC
        LIMIT 100
      `;
    } else {
      timeSeriesQuery = Prisma.sql`
        SELECT
          DATE_TRUNC(${Prisma.raw(`'${groupByUnit}'`)}, "createdAt") as time,
          COUNT(*)::bigint as count,
          COALESCE(SUM("totalTokens"), 0)::bigint as tokens
        FROM "LLMRequest"
        GROUP BY DATE_TRUNC(${Prisma.raw(`'${groupByUnit}'`)}, "createdAt")
        ORDER BY time DESC
        LIMIT 100
      `;
    }

    const timeSeriesData = await prisma.$queryRaw<
      Array<{ time: Date; count: bigint; tokens: bigint }>
    >(timeSeriesQuery);

    return NextResponse.json({
      requests: requests.map((r) => ({
        ...r,
        calls: r.calls.map((c) => ({
          ...c,
          // Keep full payload for detail view
          callPayload: c.callPayload,
        })),
        // Keep full request payload for detail view
        requestPayload: r.requestPayload,
      })),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
      aggregates: {
        totalRequests: totalCount,
        totalPromptTokens: aggregates._sum.promptTokens || 0,
        totalCompletionTokens: aggregates._sum.completionTokens || 0,
        totalTokens: aggregates._sum.totalTokens || 0,
        totalDuration: aggregates._sum.duration || 0,
        avgPromptTokens: Math.round(aggregates._avg.promptTokens || 0),
        avgCompletionTokens: Math.round(aggregates._avg.completionTokens || 0),
        avgTokens: Math.round(aggregates._avg.totalTokens || 0),
        avgDuration: Math.round(aggregates._avg.duration || 0),
        avgTokensPerSecond: aggregates._avg.tokensPerSecond?.toFixed(2) || "0",
      },
      breakdowns: {
        byCallType: callTypeBreakdown.map((b) => ({
          callType: b.callType,
          count: b._count.id,
          totalTokens: b._sum.totalTokens || 0,
          totalDuration: b._sum.duration || 0,
          avgTokensPerSecond: b._avg.tokensPerSecond?.toFixed(2) || "0",
        })),
        byModel: modelBreakdown.map((b) => ({
          model: b.model,
          count: b._count.id,
          totalTokens: b._sum.totalTokens || 0,
          totalDuration: b._sum.duration || 0,
          avgTokensPerSecond: b._avg.tokensPerSecond?.toFixed(2) || "0",
        })),
        byRequestType: requestTypeBreakdown.map((b) => ({
          requestType: b.requestType,
          count: b._count.id,
          totalTokens: b._sum.totalTokens || 0,
        })),
      },
      timeSeries: timeSeriesData.map((d) => ({
        time: d.time,
        count: Number(d.count),
        tokens: Number(d.tokens),
      })),
    });
  } catch (error) {
    console.error("LLM metrics API error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
