import { opsGet, opsPost } from "./ops-client.js";

export async function listTemplates(category?: string) {
  const result = await opsGet<{ templates: any[] }>("/api/mentiko-mcp/ops/templates");
  const templates = result?.templates ?? [];
  if (!category) return templates;
  return templates.filter((t: any) => t.category === category);
}

export async function installTemplate(templateId: string) {
  return await opsPost("/api/mentiko-mcp/ops/templates", { templateId }) as {
    id: string;
    name: string;
    agentCount: number;
  };
}
