"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { get, set, del } from "idb-keyval";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

// Create IndexedDB persister
const persister: Persister = {
  persistClient: async (client: PersistedClient) => {
    await set("rob-rag-cache", client);
  },
  restoreClient: async () => {
    return await get<PersistedClient>("rob-rag-cache");
  },
  removeClient: async () => {
    await del("rob-rag-cache");
  },
};

// Create QueryClient with configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // Data fresh for 5 minutes
      gcTime: 30 * 60 * 1000, // Cache for 30 minutes
      refetchOnWindowFocus: true, // Refetch when tab focused
      refetchOnMount: false, // Don't refetch if data is fresh
      retry: 1,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
