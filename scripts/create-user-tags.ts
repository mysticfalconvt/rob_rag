/**
 * Script to create tags for existing users
 * Run with: npx tsx scripts/create-user-tags.ts
 */

import prisma from "../lib/prisma";

async function createUserTags() {
  try {
    console.log("Fetching all users...");
    const users = await prisma.authUser.findMany({
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    console.log(`Found ${users.length} users`);

    let created = 0;
    let alreadyExists = 0;

    for (const user of users) {
      const tagName = user.name.toLowerCase().trim();

      try {
        const existingTag = await prisma.tag.findUnique({
          where: { name: tagName },
        });

        if (existingTag) {
          console.log(`Tag "${tagName}" already exists for user ${user.name}`);
          alreadyExists++;
        } else {
          await prisma.tag.create({
            data: {
              name: tagName,
              status: "approved",
              color: "#2196f3",
            },
          });
          console.log(`✅ Created tag "${tagName}" for user ${user.name}`);
          created++;
        }
      } catch (error) {
        console.error(`Error creating tag for user ${user.name}:`, error);
      }
    }

    console.log(`\n✅ Done!`);
    console.log(`   Created: ${created}`);
    console.log(`   Already existed: ${alreadyExists}`);
    console.log(`   Total: ${users.length}`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createUserTags();
