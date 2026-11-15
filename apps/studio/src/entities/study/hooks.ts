import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/shared/api";
import { keys } from "@/entities/drift";

export function useStudies(choose = false) {
  const api = useApi();
  return useQuery({ queryKey: [...keys.studies, choose], staleTime: Infinity, retry: false, queryFn: () => api.loadStudies({ choose }) });
}
