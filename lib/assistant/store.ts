import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { config as appConfig } from "../config";

/**
 * File-backed store for the assistant's "soul" (persona), "skills" (reusable
 * instruction docs the agent can pull in as a tool), and "memory" (durable
 * facts injected into the system prompt).
 *
 * Everything lives under a dot-folder in the documents volume:
 *
 *   <DOCUMENTS_FOLDER_PATH>/.assistant/
 *     soul.md
 *     skills/<slug>.md   (frontmatter: name, description, whenToUse)
 *     memory/<slug>.md   (frontmatter: name, description, type)
 *
 * The leading dot means the RAG file scanner (`getAllFiles` in lib/files.ts)
 * skips it, so these control files never pollute /files or the vector index.
 */

const assistantDir = () =>
  path.join(appConfig.DOCUMENTS_FOLDER_PATH, ".assistant");
const soulPath = () => path.join(assistantDir(), "soul.md");
const skillsDir = () => path.join(assistantDir(), "skills");
const memoryDir = () => path.join(assistantDir(), "memory");

/** Shipped default persona used until a soul.md is written. */
export const DEFAULT_SOUL = `You are a personal AI assistant. You help your user find and reason over
their own documents, notes, books, calendar, and connected services, and you
answer general questions when they don't need those sources. Be concise,
direct, and honest — if you don't know or a tool returned nothing, say so.`;

export interface Skill {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  body: string;
}

export interface Memory {
  slug: string;
  name: string;
  description: string;
  type: string;
  body: string;
}

/** Sanitize a name into a safe file slug (mirrors lib/tools/noteTool.ts). */
function slugify(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase()
      .substring(0, 100) || "untitled"
  );
}

// --- tiny mtime-keyed cache -------------------------------------------------
// Prompt assembly reads soul/skills/memory on every chat turn, so cache the
// parsed results and only re-read when the file/dir mtime changes.

type CacheEntry<T> = { mtimeMs: number; value: T };
const cache = {
  soul: null as CacheEntry<string> | null,
  skills: null as CacheEntry<Skill[]> | null,
  memory: null as CacheEntry<Memory[]> | null,
};

async function mtimeOf(p: string): Promise<number> {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return 0; // missing → sentinel
  }
}

// --- soul -------------------------------------------------------------------

export async function readSoul(): Promise<string> {
  const mtimeMs = await mtimeOf(soulPath());
  if (cache.soul && cache.soul.mtimeMs === mtimeMs) return cache.soul.value;

  let value = DEFAULT_SOUL;
  if (mtimeMs > 0) {
    try {
      const raw = await readFile(soulPath(), "utf-8");
      // soul.md may or may not have frontmatter; use the body either way.
      const { content } = matter(raw);
      const trimmed = content.trim();
      if (trimmed) value = trimmed;
    } catch (err) {
      console.error("[assistant/store] failed to read soul.md:", err);
    }
  }
  cache.soul = { mtimeMs, value };
  return value;
}

export async function writeSoul(soul: string): Promise<void> {
  await mkdir(assistantDir(), { recursive: true });
  await writeFile(soulPath(), soul, "utf-8");
  cache.soul = null;
}

// --- skills -----------------------------------------------------------------

async function readMdDir<T>(
  dir: string,
  parse: (slug: string, data: Record<string, unknown>, body: string) => T,
): Promise<T[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return []; // dir doesn't exist yet
  }
  const items: T[] = [];
  for (const file of names) {
    if (!file.endsWith(".md")) continue;
    try {
      const raw = await readFile(path.join(dir, file), "utf-8");
      const { content, data } = matter(raw);
      items.push(
        parse(file.replace(/\.md$/, ""), data as Record<string, unknown>, content.trim()),
      );
    } catch (err) {
      console.error(`[assistant/store] failed to parse ${file}:`, err);
    }
  }
  return items;
}

export async function listSkills(): Promise<Skill[]> {
  const mtimeMs = await mtimeOf(skillsDir());
  if (cache.skills && cache.skills.mtimeMs === mtimeMs) return cache.skills.value;

  const value = await readMdDir<Skill>(skillsDir(), (slug, data, body) => ({
    slug,
    name: typeof data.name === "string" && data.name ? data.name : slug,
    description: typeof data.description === "string" ? data.description : "",
    whenToUse: typeof data.whenToUse === "string" ? data.whenToUse : "",
    body,
  }));
  value.sort((a, b) => a.name.localeCompare(b.name));
  cache.skills = { mtimeMs, value };
  return value;
}

export async function getSkill(name: string): Promise<Skill | null> {
  const slug = slugify(name);
  const skills = await listSkills();
  return (
    skills.find((s) => s.slug === slug || s.name.toLowerCase() === name.toLowerCase()) ??
    null
  );
}

export async function saveSkill(input: {
  name: string;
  description: string;
  whenToUse: string;
  body: string;
}): Promise<Skill> {
  await mkdir(skillsDir(), { recursive: true });
  const slug = slugify(input.name);
  const file = matter.stringify(`\n${input.body.trim()}\n`, {
    name: input.name,
    description: input.description,
    whenToUse: input.whenToUse,
  });
  await writeFile(path.join(skillsDir(), `${slug}.md`), file, "utf-8");
  cache.skills = null;
  return {
    slug,
    name: input.name,
    description: input.description,
    whenToUse: input.whenToUse,
    body: input.body.trim(),
  };
}

export async function deleteSkill(name: string): Promise<boolean> {
  const slug = slugify(name);
  try {
    await unlink(path.join(skillsDir(), `${slug}.md`));
    cache.skills = null;
    return true;
  } catch {
    return false;
  }
}

// --- memory -----------------------------------------------------------------

export async function listMemories(): Promise<Memory[]> {
  const mtimeMs = await mtimeOf(memoryDir());
  if (cache.memory && cache.memory.mtimeMs === mtimeMs) return cache.memory.value;

  const value = await readMdDir<Memory>(memoryDir(), (slug, data, body) => ({
    slug,
    name: typeof data.name === "string" && data.name ? data.name : slug,
    description: typeof data.description === "string" ? data.description : "",
    type: typeof data.type === "string" ? data.type : "note",
    body,
  }));
  value.sort((a, b) => a.name.localeCompare(b.name));
  cache.memory = { mtimeMs, value };
  return value;
}

export async function getMemory(name: string): Promise<Memory | null> {
  const slug = slugify(name);
  const memories = await listMemories();
  return (
    memories.find(
      (m) => m.slug === slug || m.name.toLowerCase() === name.toLowerCase(),
    ) ?? null
  );
}

export async function saveMemory(input: {
  name: string;
  description: string;
  type?: string;
  body: string;
}): Promise<Memory> {
  await mkdir(memoryDir(), { recursive: true });
  const slug = slugify(input.name);
  const type = input.type || "note";
  const file = matter.stringify(`\n${input.body.trim()}\n`, {
    name: input.name,
    description: input.description,
    type,
  });
  await writeFile(path.join(memoryDir(), `${slug}.md`), file, "utf-8");
  cache.memory = null;
  return {
    slug,
    name: input.name,
    description: input.description,
    type,
    body: input.body.trim(),
  };
}

export async function deleteMemory(name: string): Promise<boolean> {
  const slug = slugify(name);
  try {
    await unlink(path.join(memoryDir(), `${slug}.md`));
    cache.memory = null;
    return true;
  } catch {
    return false;
  }
}

// --- prompt-section builders ------------------------------------------------

/** Compact catalog injected into the system prompt so the model knows which
 *  skills exist and can pull one in via the use_skill tool. */
export function buildSkillsCatalog(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => {
    const when = s.whenToUse ? ` Use when: ${s.whenToUse}` : "";
    return `- ${s.name}: ${s.description}.${when}`;
  });
  return (
    "AVAILABLE SKILLS — reusable instructions you can load. When a task matches " +
    "one, call the use_skill tool with its exact name to read the full instructions, " +
    "then follow them:\n" +
    lines.join("\n")
  );
}

/** Compact memory index injected every turn; full text fetched via recall_memory. */
export function buildMemoryIndex(memories: Memory[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map((m) => `- ${m.name}: ${m.description}`);
  return (
    "KNOWN MEMORIES — durable facts you've saved about the user and their world. " +
    "Take these into account. Call the recall_memory tool with a name to read the " +
    "full detail when relevant:\n" +
    lines.join("\n")
  );
}
