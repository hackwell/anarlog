import { useQuery } from "@tanstack/react-query";

export function useWebResources<T>(endpoint: string) {
  return useQuery({
    queryKey: ["settings", endpoint, "suggestions"],
    queryFn: async () => {
      const response = await fetch(
        `https://sessionecho.flagbit.de/api/${endpoint}`,
        {
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        return [];
      }
      return response.json() as Promise<T[]>;
    },
  });
}
