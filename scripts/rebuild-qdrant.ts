/**
 * Rebuild Qdrant collection from scratch
 * This will delete the collection and re-index all files and Goodreads books
 */
import { config } from "../lib/config";

async function rebuild() {
  const COLLECTION_NAME = "documents";
  const QDRANT_URL = config.QDRANT_URL;

  console.log("🗑️  Deleting existing collection...");

  // Delete collection
  const deleteResponse = await fetch(
    `${QDRANT_URL}/collections/${COLLECTION_NAME}`,
    {
      method: "DELETE",
    },
  );

  if (deleteResponse.ok) {
    console.log("✅ Collection deleted");
  } else {
    console.log("⚠️  Collection might not exist, continuing...");
  }

  console.log("\n📦 Creating new collection...");

  // Create collection
  const createResponse = await fetch(
    `${QDRANT_URL}/collections/${COLLECTION_NAME}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vectors: {
          size: 1024,
          distance: "Cosine",
        },
      }),
    },
  );

  if (!createResponse.ok) {
    throw new Error(
      `Failed to create collection: ${await createResponse.text()}`,
    );
  }

  console.log("✅ Collection created");

  console.log("\n🏗️  Creating payload indexes...");

  // Create indexes
  await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/index`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      field_name: "source",
      field_schema: "keyword",
    }),
  });

  await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/index`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      field_name: "filePath",
      field_schema: "keyword",
    }),
  });

  console.log("✅ Indexes created");

  console.log("\n🔄 Now run the following commands to re-index:");
  console.log(
    "1. Re-index files: curl -X POST http://localhost:3000/api/reindex",
  );
  console.log(
    "2. Re-index Goodreads: curl -X POST http://localhost:3000/api/goodreads/sync",
  );
}

rebuild()
  .then(() => {
    console.log("\n✅ Qdrant collection rebuilt successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
