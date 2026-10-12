import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCapability } from "@/server/authz/require-capability.server";

const disputeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,192}$/);

export const getSquareDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireCapability(context, "integrations.manage");
    const { squareDashboard } = await import("@/server/square/read.server");
    return squareDashboard();
  });

export const listSquareDisputes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireCapability(context, "integrations.manage");
    const { readDisputeList } = await import("@/server/square/dispute-read.server");
    return readDisputeList({ limit: 100 });
  });

export const getSquareDispute = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ disputeId: disputeIdSchema }).parse(input))
  .handler(async ({ context, data }) => {
    await requireCapability(context, "integrations.manage");
    const { readDisputeDetail } = await import("@/server/square/dispute-read.server");
    return readDisputeDetail({ disputeId: data.disputeId, audience: "owner" });
  });

export const saveDisputeEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        disputeId: disputeIdSchema,
        kind: z.string().min(1).max(40),
        status: z.string().min(1).max(40),
        linkUrl: z.string().max(2000).nullable().optional(),
        note: z.string().max(2000).nullable().optional(),
        clearFile: z.boolean().optional(),
        file: z
          .object({
            name: z.string().min(1).max(200),
            mime: z.string().min(1).max(80),
            base64: z.string().min(1).max(7_000_000),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await requireCapability(context, "integrations.manage");
    const dispute = await import("@/server/square/dispute");
    if (!dispute.isEvidenceKind(data.kind) || !dispute.isEvidenceStatus(data.status)) {
      return { ok: false as const, reason: "invalid_checklist" };
    }
    const link = dispute.parseEvidenceLink(data.linkUrl);
    if (!link.ok) return { ok: false as const, reason: link.error };
    const note = dispute.parseEvidenceNote(data.note);
    if (!note.ok) return { ok: false as const, reason: note.error };
    let prepared: {
      bytes: Uint8Array;
      mime: (typeof dispute.EVIDENCE_MIMES)[number];
      name: string;
    } | null = null;
    if (data.file) {
      if (!dispute.isEvidenceMime(data.file.mime))
        return { ok: false as const, reason: "file_type" };
      const cleaned = data.file.base64.replace(/\s/g, "");
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
        return { ok: false as const, reason: "file_invalid" };
      }
      const bytes = new Uint8Array(Buffer.from(cleaned, "base64"));
      if (
        bytes.length === 0 ||
        bytes.length > dispute.MAX_EVIDENCE_BYTES ||
        !dispute.evidenceBytesMatch(data.file.mime, bytes)
      ) {
        return { ok: false as const, reason: "file_invalid" };
      }
      prepared = { bytes, mime: data.file.mime, name: data.file.name };
    }
    const store = await import("@/server/square/dispute-store.server");
    const existing = await store.getStoredDispute(data.disputeId);
    if (!existing) return { ok: false as const, reason: "dispute_not_found" };
    await store.updateEvidenceRow({
      disputeId: data.disputeId,
      kind: data.kind,
      status: data.status,
      linkUrl: link.link,
      note: note.note,
      clearFile: data.clearFile === true && !data.file,
    });
    if (prepared) {
      await store.attachEvidenceFile({
        disputeId: data.disputeId,
        kind: data.kind,
        bytes: prepared.bytes,
        contentType: prepared.mime,
        fileName: dispute.safeEvidenceFileName(prepared.name),
        extension: dispute.evidenceExtension(prepared.mime),
      });
    }
    return { ok: true as const, reason: null };
  });
