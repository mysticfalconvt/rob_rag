"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function useConversationActions(conversationId: string | null) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  const saveConversation = async (): Promise<{
    success: boolean;
    message: string;
  }> => {
    if (!conversationId) {
      return {
        success: false,
        message: "Please send a message first to create a conversation.",
      };
    }

    setIsSaving(true);
    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/export`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to save conversation");
      }

      const data = await response.json();
      return {
        success: true,
        message: `Saved as ${data.filename} and indexed!`,
      };
    } catch (error) {
      console.error("Error saving conversation:", error);
      return {
        success: false,
        message: "Failed to save conversation. Please try again.",
      };
    } finally {
      setIsSaving(false);
    }
  };

  const deleteConversation = async (): Promise<{
    success: boolean;
    message: string;
  }> => {
    if (!conversationId) {
      return { success: false, message: "No conversation to delete." };
    }

    if (!confirm("Delete this conversation?")) {
      return { success: false, message: "Cancelled" };
    }

    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setTimeout(() => {
          router.push("/");
        }, 1000);
        return {
          success: true,
          message: "Conversation deleted successfully!",
        };
      } else {
        throw new Error("Failed to delete conversation");
      }
    } catch (error) {
      console.error("Error deleting conversation:", error);
      return {
        success: false,
        message: "Failed to delete conversation. Please try again.",
      };
    }
  };

  return {
    isSaving,
    saveConversation,
    deleteConversation,
  };
}
