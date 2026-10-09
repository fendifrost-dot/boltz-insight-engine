import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCapability } from "@/server/authz/require-capability.server";

export const getTrainingVideo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ part: z.number().int().min(1).max(3) }).parse(input))
  .handler(async ({ context, data }) => {
    await requireCapability(context, "contacts.read");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: video, error } = await supabaseAdmin.storage
      .from("desk-training")
      .createSignedUrl(`part-${data.part}.mp4`, 3600);
    if (error || !video) throw new Error("This lesson could not load. Please try again.");
    return { url: video.signedUrl };
  });
