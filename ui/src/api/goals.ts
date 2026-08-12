import type { Goal } from "@paperclipai/shared";
import { api } from "./client";

export type GoalActivity = {
  issues: Array<{
    id: string;
    identifier: string | null;
    title: string;
    status: string;
    priority: string;
    updatedAt: string;
  }>;
  routines: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    lastTriggeredAt: string | null;
    updatedAt: string;
  }>;
};

export const goalsApi = {
  list: (companyId: string) => api.get<Goal[]>(`/companies/${companyId}/goals`),
  get: (id: string) => api.get<Goal>(`/goals/${id}`),
  activity: (id: string) => api.get<GoalActivity>(`/goals/${id}/activity`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Goal>(`/companies/${companyId}/goals`, data),
  update: (id: string, data: Record<string, unknown>) => api.patch<Goal>(`/goals/${id}`, data),
  remove: (id: string) => api.delete<Goal>(`/goals/${id}`),
};
