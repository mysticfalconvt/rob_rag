"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import Sidebar from "./Sidebar";
import { config } from "@/lib/config";
import styles from "../app/layout.module.css";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (
      !isLoading &&
      !isAuthenticated &&
      pathname !== "/login" &&
      !hasRedirected.current
    ) {
      hasRedirected.current = true;
      router.push("/login");
    }

    // Reset redirect flag when becoming authenticated or when on login page
    if (isAuthenticated || pathname === "/login") {
      hasRedirected.current = false;
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontSize: "1.2rem",
          color: "#666",
        }}
      >
        Loading...
      </div>
    );
  }

  // Allow access to login page without authentication (no sidebar)
  if (pathname === "/login") {
    return <>{children}</>;
  }

  // Require authentication for all other pages
  if (!isAuthenticated) {
    return null; // Will redirect via useEffect
  }

  // Authenticated users get the sidebar + main content layout
  return (
    <div className={styles.container}>
      <Sidebar appName={config.APP_NAME} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
