"use client";

import { useState, useEffect } from "react";
import Card from "./Card";
import Toast from "@/components/Toast";
import styles from "./UserProfile.module.css";

export default function UserProfile() {
  const [userName, setUserName] = useState("");
  const [userBio, setUserBio] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/profile");
      if (response.ok) {
        const data = await response.json();
        setUserName(data.userName || "");
        setUserBio(data.userBio || "");
      }
    } catch (error) {
      console.error("Failed to fetch profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName, userBio }),
      });
      if (response.ok) {
        setToast({
          message: "Profile saved successfully!",
          type: "success",
        });
      } else {
        throw new Error("Failed to save profile");
      }
    } catch (error) {
      console.error("Failed to save profile:", error);
      setToast({
        message: "Failed to save profile",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card title="User Profile">
        <div className={styles.loading}>Loading profile...</div>
      </Card>
    );
  }

  return (
    <>
      <Card
        title="User Profile"
        subtitle="Help the AI understand your context"
        action={
          <button
            onClick={handleSave}
            className={styles.saveButton}
            disabled={loading || saving}
          >
            {saving ? "Saving..." : "Save Profile"}
          </button>
        }
      >

        <div className={styles.field}>
          <label htmlFor="userName" className={styles.label}>
            Your Name
          </label>
          <p className={styles.description}>
            Used to personalize responses and provide context to the AI.
          </p>
          <input
            id="userName"
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className={styles.input}
            placeholder="e.g., John Smith"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="userBio" className={styles.label}>
            About You
          </label>
          <p className={styles.description}>
            Share your background, role, interests, or any context that helps
            the AI provide better answers. This information will be included
            when searching documents and generating responses.
          </p>
          <textarea
            id="userBio"
            value={userBio}
            onChange={(e) => setUserBio(e.target.value)}
            className={styles.textarea}
            placeholder="e.g., I'm a software engineer working on backend systems. I'm interested in distributed systems, Python, and DevOps practices."
            rows={6}
          />
        </div>
      </Card>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </>
  );
}
