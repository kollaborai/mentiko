import { redirect } from "next/navigation";
import { taskDetailHref } from "@/lib/task-routes";

type TaskDetailRedirectPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TaskDetailRedirectPage({
  params,
  searchParams,
}: TaskDetailRedirectPageProps) {
  const [{ id }, rawSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({}),
  ]);
  const resolvedSearchParams = (
    rawSearchParams && typeof rawSearchParams === "object" ? rawSearchParams : {}
  ) as Record<string, string | string[] | undefined>;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => search.append(key, entry));
    } else if (value !== undefined) {
      search.set(key, value);
    }
  }

  redirect(taskDetailHref(id, search));
}
