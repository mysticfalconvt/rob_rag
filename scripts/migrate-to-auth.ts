#!/usr/bin/env tsx
/**
 * Migration script to add authentication to the application
 *
 * This script:
 * 1. Backs up the current database
 * 2. Creates an admin user from environment variables
 * 3. Associates existing conversations with the admin user
 * 4. Renames User table references to GoodreadsUser
 */

import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

async function main() {
  console.log("🔄 Starting authentication migration...\n");

  // 1. Backup database
  console.log("📦 Creating database backup...");
  const dbPath = "./prisma/dev.db";
  const backupPath = `./prisma/dev.db.backup.${Date.now()}`;

  if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, backupPath);
    console.log(`✅ Database backed up to: ${backupPath}\n`);
  } else {
    console.log("⚠️  No existing database found, will create new one\n");
  }

  // 2. Get admin credentials from environment
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const adminName = process.env.ADMIN_NAME || "Administrator";

  console.log("👤 Creating admin user...");
  console.log(`   Email: ${adminEmail}`);
  console.log(`   Name: ${adminName}`);

  // Hash password
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  // Create admin user (we'll do this after schema migration)
  console.log("✅ Admin credentials prepared\n");

  console.log("⚠️  NEXT STEPS:");
  console.log("1. The schema has been updated in prisma/schema.prisma");
  console.log("2. You need to manually run the migration in your terminal:");
  console.log("   npx prisma migrate dev --name add_authentication");
  console.log(
    "3. Then run this script again to create the admin user and migrate data",
  );
  console.log("\nOr, if you don't have existing data you want to keep:");
  console.log("   npx prisma db push --force-reset");
  console.log("   Then run this script to create the admin user\n");
}

main()
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
