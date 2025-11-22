import prisma from "./prisma";

export interface PaperlessConfig {
  url: string;
  apiToken: string;
  enabled: boolean;
}

export interface PaperlessDocument {
  id: number;
  title: string;
  content: string;
  created: string;
  modified: string;
  tags: number[];
  correspondent: number | null;
  archive_serial_number: string | null;
}

export interface PaperlessDocumentMetadata {
  id: number;
  title: string;
  tags: string[];
  correspondent: string | null;
  created: Date;
  modified: Date;
}

interface PaperlessApiResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

interface PaperlessTag {
  id: number;
  name: string;
}

interface PaperlessCorrespondent {
  id: number;
  name: string;
}

export class PaperlessClient {
  private config: PaperlessConfig;
  private tagCache: Map<number, string> = new Map();
  private correspondentCache: Map<number, string> = new Map();

  constructor(config: PaperlessConfig) {
    if (!config.url || !config.apiToken) {
      throw new Error("Paperless-ngx URL and API token are required");
    }

    // Normalize URL (remove trailing slash)
    this.config = {
      ...config,
      url: config.url.replace(/\/$/, ""),
    };
  }

  private async makeRequest<T>(endpoint: string, retries = 3): Promise<T> {
    const url = `${this.config.url}/api${endpoint}`;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Token ${this.config.apiToken}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Invalid API token");
          }
          if (response.status === 404) {
            throw new Error("Endpoint not found");
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      } catch (error: any) {
        if (attempt === retries - 1) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = 2 ** attempt * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error("Max retries exceeded");
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.makeRequest("/documents/?page=1&page_size=1");
      return true;
    } catch (error) {
      console.error("Paperless-ngx connection test failed:", error);
      return false;
    }
  }

  async getAllDocuments(): Promise<PaperlessDocument[]> {
    const documents: PaperlessDocument[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const response = await this.makeRequest<PaperlessApiResponse<any>>(
          `/documents/?page=${page}&page_size=25`,
        );

        documents.push(...response.results);
        hasMore = response.next !== null;
        page++;
      } catch (error) {
        console.error(`Error fetching documents page ${page}:`, error);
        throw error;
      }
    }

    return documents;
  }

  async getDocument(id: number): Promise<PaperlessDocument> {
    return await this.makeRequest<PaperlessDocument>(`/documents/${id}/`);
  }

  async getDocumentContent(id: number): Promise<string> {
    try {
      // Try to get the text content from the document endpoint
      const doc = await this.getDocument(id);

      // If content is available directly, return it
      if (doc.content) {
        return doc.content;
      }

      // Otherwise, try to download the document
      const url = `${this.config.url}/api/documents/${id}/download/`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Token ${this.config.apiToken}`,
        },
        signal: AbortSignal.timeout(60000), // 60 second timeout for downloads
      });

      if (!response.ok) {
        throw new Error(`Failed to download document: ${response.statusText}`);
      }

      // For now, return the title as content if we can't extract text
      // In a production system, you'd want to handle different file types
      return doc.title;
    } catch (error) {
      console.error(`Error fetching content for document ${id}:`, error);
      throw error;
    }
  }

  async getTagNames(tagIds: number[]): Promise<string[]> {
    const tagNames: string[] = [];

    for (const tagId of tagIds) {
      // Check cache first
      if (this.tagCache.has(tagId)) {
        tagNames.push(this.tagCache.get(tagId)!);
        continue;
      }

      // Fetch from API
      try {
        const tag = await this.makeRequest<PaperlessTag>(`/tags/${tagId}/`);
        this.tagCache.set(tagId, tag.name);
        tagNames.push(tag.name);
      } catch (error) {
        console.error(`Error fetching tag ${tagId}:`, error);
        tagNames.push(`Tag ${tagId}`);
      }
    }

    return tagNames;
  }

  async getCorrespondentName(id: number | null): Promise<string | null> {
    if (id === null) {
      return null;
    }

    // Check cache first
    if (this.correspondentCache.has(id)) {
      return this.correspondentCache.get(id)!;
    }

    // Fetch from API
    try {
      const correspondent = await this.makeRequest<PaperlessCorrespondent>(
        `/correspondents/${id}/`,
      );
      this.correspondentCache.set(id, correspondent.name);
      return correspondent.name;
    } catch (error) {
      console.error(`Error fetching correspondent ${id}:`, error);
      return `Correspondent ${id}`;
    }
  }

  async getDocumentMetadata(id: number): Promise<PaperlessDocumentMetadata> {
    const doc = await this.getDocument(id);
    const tags = await this.getTagNames(doc.tags);
    const correspondent = await this.getCorrespondentName(doc.correspondent);

    return {
      id: doc.id,
      title: doc.title,
      tags,
      correspondent,
      created: new Date(doc.created),
      modified: new Date(doc.modified),
    };
  }

  clearCache(): void {
    this.tagCache.clear();
    this.correspondentCache.clear();
  }
}

// Singleton instance getter
export async function getPaperlessClient(): Promise<PaperlessClient | null> {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    if (
      !settings ||
      !settings.paperlessEnabled ||
      !settings.paperlessUrl ||
      !settings.paperlessApiToken
    ) {
      return null;
    }

    return new PaperlessClient({
      url: settings.paperlessUrl,
      apiToken: settings.paperlessApiToken,
      enabled: settings.paperlessEnabled,
    });
  } catch (error) {
    console.error("Error creating Paperless client:", error);
    return null;
  }
}
