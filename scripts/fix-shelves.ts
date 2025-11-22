/**
 * Fix shelves data that might be stored as plain strings instead of JSON
 * Run with: npx tsx scripts/fix-shelves.ts
 */
import prisma from "../lib/prisma";

async function fixShelves() {
  console.log("Fixing shelves data...");

  const books = await prisma.goodreadsBook.findMany();
  let fixed = 0;

  for (const book of books) {
    if (!book.shelves) continue;

    try {
      // Try to parse as JSON
      JSON.parse(book.shelves);
      // Already valid JSON, skip
    } catch (error) {
      // Not valid JSON, convert it
      const shelvesArray = book.shelves
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const shelvesJson = JSON.stringify(shelvesArray);

      await prisma.goodreadsBook.update({
        where: { id: book.id },
        data: { shelves: shelvesJson },
      });

      console.log(`Fixed shelves for book: ${book.title} (${book.id})`);
      fixed++;
    }
  }

  console.log(`✅ Fixed ${fixed} books`);
}

fixShelves()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
