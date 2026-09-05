import { z } from "zod";

const clientSchema = z.object({
  VITE_API_BASE_URL: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }),
  VITE_DEMO_MODE: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export function parseClientEnv(source: Readonly<Record<string, unknown>>) {
  const result = clientSchema.safeParse(source);
  if (!result.success) throw new Error("Invalid public configuration.");
  return {
    apiBaseUrl: result.data.VITE_API_BASE_URL.replace(/\/$/, ""),
    demoMode: result.data.VITE_DEMO_MODE,
  };
}
