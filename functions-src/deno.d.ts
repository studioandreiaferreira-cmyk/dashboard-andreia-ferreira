// Minimal Deno globals used by the Edge Functions (they are bundled and run on Supabase's Deno runtime).
declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
  env: { get(name: string): string | undefined };
};
