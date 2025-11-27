/**
 * Query Builder for constructing Qdrant filters
 * Provides a fluent interface for building complex filters
 */

export interface QdrantFilter {
  must?: any[];
  should?: any[];
  must_not?: any[];
}

export interface QdrantCondition {
  key: string;
  match?: { value: any };
  range?: {
    gt?: number | string;
    gte?: number | string;
    lt?: number | string;
    lte?: number | string;
  };
}

/**
 * Fluent query builder for Qdrant filters
 */
export class QueryBuilder {
  private mustConditions: any[] = [];
  private shouldConditions: any[] = [];
  private mustNotConditions: any[] = [];

  /**
   * Filter by source name (e.g., "goodreads", "paperless")
   */
  source(sourceName: string): this {
    this.mustConditions.push({
      key: "source",
      match: { value: sourceName },
    });
    return this;
  }

  /**
   * Filter by multiple sources (OR logic)
   */
  sources(sourceNames: string[]): this {
    if (sourceNames.length === 0) return this;

    if (sourceNames.length === 1) {
      return this.source(sourceNames[0]);
    }

    // Multiple sources: use "should" (OR logic)
    this.shouldConditions.push(
      ...sourceNames.map((name) => ({
        key: "source",
        match: { value: name },
      })),
    );
    return this;
  }

  /**
   * Filter by user ID
   */
  userId(userId: string): this {
    this.mustConditions.push({
      key: "userId",
      match: { value: userId },
    });
    return this;
  }

  /**
   * Filter by exact field match
   */
  equals(field: string, value: any): this {
    this.mustConditions.push({
      key: field,
      match: { value },
    });
    return this;
  }

  /**
   * Filter by field with OR logic (any of the values)
   */
  in(field: string, values: any[]): this {
    if (values.length === 0) return this;

    if (values.length === 1) {
      return this.equals(field, values[0]);
    }

    this.shouldConditions.push(
      ...values.map((value) => ({
        key: field,
        match: { value },
      })),
    );
    return this;
  }

  /**
   * Filter by greater than
   */
  greaterThan(field: string, value: number | string): this {
    this.mustConditions.push({
      key: field,
      range: { gt: value },
    });
    return this;
  }

  /**
   * Filter by greater than or equal
   */
  greaterThanOrEqual(field: string, value: number | string): this {
    this.mustConditions.push({
      key: field,
      range: { gte: value },
    });
    return this;
  }

  /**
   * Filter by less than
   */
  lessThan(field: string, value: number | string): this {
    this.mustConditions.push({
      key: field,
      range: { lt: value },
    });
    return this;
  }

  /**
   * Filter by less than or equal
   */
  lessThanOrEqual(field: string, value: number | string): this {
    this.mustConditions.push({
      key: field,
      range: { lte: value },
    });
    return this;
  }

  /**
   * Filter by range (inclusive)
   */
  range(field: string, min: number | string, max: number | string): this {
    this.mustConditions.push({
      key: field,
      range: { gte: min, lte: max },
    });
    return this;
  }

  /**
   * Filter by date range
   * Dates are converted to ISO strings for comparison
   */
  dateRange(field: string, start: Date, end: Date): this {
    const startStr = start.toISOString();
    const endStr = end.toISOString();

    this.mustConditions.push({
      key: field,
      range: { gte: startStr, lte: endStr },
    });
    return this;
  }

  /**
   * Add a custom condition to "must" array
   */
  must(condition: any): this {
    this.mustConditions.push(condition);
    return this;
  }

  /**
   * Add a custom condition to "should" array (OR logic)
   */
  should(condition: any): this {
    this.shouldConditions.push(condition);
    return this;
  }

  /**
   * Add a custom condition to "must_not" array
   */
  mustNot(condition: any): this {
    this.mustNotConditions.push(condition);
    return this;
  }

  /**
   * Build the final Qdrant filter object
   */
  build(): QdrantFilter | undefined {
    const filter: QdrantFilter = {};

    if (this.mustConditions.length > 0) {
      filter.must = this.mustConditions;
    }

    if (this.shouldConditions.length > 0) {
      filter.should = this.shouldConditions;
    }

    if (this.mustNotConditions.length > 0) {
      filter.must_not = this.mustNotConditions;
    }

    // Return undefined if no conditions (cleaner API)
    if (
      this.mustConditions.length === 0 &&
      this.shouldConditions.length === 0 &&
      this.mustNotConditions.length === 0
    ) {
      return undefined;
    }

    return filter;
  }

  /**
   * Reset the builder to start fresh
   */
  reset(): this {
    this.mustConditions = [];
    this.shouldConditions = [];
    this.mustNotConditions = [];
    return this;
  }
}

/**
 * Create a new query builder instance
 */
export function createQueryBuilder(): QueryBuilder {
  return new QueryBuilder();
}

/**
 * Helper to build a simple source filter
 */
export function buildSourceFilter(
  sourceFilter:
    | "all"
    | "uploaded"
    | "synced"
    | "paperless"
    | "goodreads"
    | "none"
    | string[],
): QdrantFilter | undefined {
  if (!sourceFilter || sourceFilter === "all" || sourceFilter === "none") {
    return undefined;
  }

  const builder = createQueryBuilder();

  if (Array.isArray(sourceFilter)) {
    // Handle special formats like "goodreads:userId"
    const parsedSources = sourceFilter.map((s) => {
      if (s.startsWith("goodreads:")) {
        const userId = s.split(":")[1];
        return {
          must: [
            { key: "source", match: { value: "goodreads" } },
            { key: "userId", match: { value: userId } },
          ],
        };
      }
      return {
        key: "source",
        match: { value: s },
      };
    });

    // If multiple sources with special handling, use should
    if (parsedSources.length > 1) {
      parsedSources.forEach((condition) => builder.should(condition));
    } else if (parsedSources.length === 1) {
      const condition = parsedSources[0];
      if ("must" in condition && condition.must) {
        // Special format with userId
        condition.must.forEach((c: any) => builder.must(c));
      } else {
        builder.must(condition);
      }
    }
  } else {
    // Single source string
    if (sourceFilter.startsWith("goodreads:")) {
      const userId = sourceFilter.split(":")[1];
      builder.source("goodreads").userId(userId);
    } else {
      builder.source(sourceFilter);
    }
  }

  return builder.build();
}
