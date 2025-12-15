import * as bcrypt from "bcrypt";
import prisma from "./prisma";

const SALT_ROUNDS = 12;

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 */
export function isValidPassword(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a new user (admin only operation)
 */
export async function createUser(data: {
  email: string;
  name: string;
  password: string;
  role?: "admin" | "user";
  createdBy?: string;
}) {
  const { email, name, password, role = "user", createdBy } = data;

  // Validate email
  if (!isValidEmail(email)) {
    throw new Error("Invalid email format");
  }

  // Validate password
  const passwordValidation = isValidPassword(password);
  if (!passwordValidation.valid) {
    throw new Error(
      `Password validation failed: ${passwordValidation.errors.join(", ")}`,
    );
  }

  // Check if user already exists
  const existingUser = await prisma.authUser.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new Error("User with this email already exists");
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create user
  const user = await prisma.authUser.create({
    data: {
      email,
      name,
      passwordHash,
      role,
      createdBy,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Auto-create a tag for this user (lowercase, approved)
  try {
    const tagName = name.toLowerCase().trim();
    await prisma.tag.upsert({
      where: { name: tagName },
      update: {}, // If tag exists, don't update it
      create: {
        name: tagName,
        status: "approved", // User tags are auto-approved
        color: "#2196f3", // Blue color for user tags
      },
    });
    console.log(`Created user tag: ${tagName}`);
  } catch (error) {
    console.error("Error creating user tag:", error);
    // Don't fail user creation if tag creation fails
  }

  return user;
}

/**
 * Authenticate a user by email and password
 */
export async function authenticateUser(email: string, password: string) {
  // Find user by email
  const user = await prisma.authUser.findUnique({
    where: { email },
  });

  if (!user) {
    return null;
  }

  // Check if user is active
  if (!user.isActive) {
    return null; // Don't reveal account status
  }

  // Verify password
  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  // Return user without password hash
  const { passwordHash, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

/**
 * Get or create the initial admin user from environment variables
 */
export async function ensureAdminUser() {
  // Check if any users exist
  const userCount = await prisma.authUser.count();
  if (userCount > 0) {
    return null; // Users already exist
  }

  // Get admin credentials from environment
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME || "Administrator";

  if (!adminEmail || !adminPassword) {
    console.warn(
      "⚠️  No users exist and ADMIN_EMAIL/ADMIN_PASSWORD not set in environment variables",
    );
    return null;
  }

  console.log("👤 Creating initial admin user:", adminEmail);

  // Create admin user
  try {
    const admin = await createUser({
      email: adminEmail,
      name: adminName,
      password: adminPassword,
      role: "admin",
    });

    console.log("✅ Admin user created successfully");
    return admin;
  } catch (error) {
    console.error("❌ Failed to create admin user:", error);
    throw error;
  }
}

/**
 * Check if a user is an admin
 */
export function isAdmin(user: { role: string }): boolean {
  return user.role === "admin";
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string) {
  const user = await prisma.authUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      userName: true,
      userBio: true,
      userPreferences: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return user;
}

/**
 * Update user profile
 */
export async function updateUserProfile(
  userId: string,
  data: {
    name?: string;
    userName?: string;
    userBio?: string;
    userPreferences?: any;
  },
) {
  const updateData: any = {};

  if (data.name !== undefined) updateData.name = data.name;
  if (data.userName !== undefined) updateData.userName = data.userName;
  if (data.userBio !== undefined) updateData.userBio = data.userBio;
  if (data.userPreferences !== undefined) {
    updateData.userPreferences = JSON.stringify(data.userPreferences);
  }

  const user = await prisma.authUser.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      userName: true,
      userBio: true,
      userPreferences: true,
      updatedAt: true,
    },
  });

  return user;
}
