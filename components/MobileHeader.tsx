"use client";

import styles from "./MobileHeader.module.css";
import { config } from "@/lib/config";

interface MobileHeaderProps {
  title?: string;
}

export default function MobileHeader({ title }: MobileHeaderProps) {
  const handleMobileMenuClick = () => {
    // Dispatch custom event to open sidebar menu
    window.dispatchEvent(new CustomEvent("openMobileMenu"));
  };

  return (
    <div className={styles.header}>
      <button
        className={styles.hamburger}
        onClick={handleMobileMenuClick}
        aria-label="Open menu"
      >
        <i className="fas fa-bars"></i>
      </button>
      <h1>
        {title || (
          <>
            <i className="fas fa-robot"></i>
            <span>{config.APP_NAME}</span>
          </>
        )}
      </h1>
    </div>
  );
}
