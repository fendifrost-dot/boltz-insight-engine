// Maps a Google Ads lead-form submission row. Pure; no I/O and no logging.

export type AdsLeadField = { fieldType?: string; fieldValue?: string };

export type AdsLeadSubmissionRow = {
  leadFormSubmissionData?: {
    id?: string;
    submissionDateTime?: string;
    leadFormSubmissionFields?: AdsLeadField[];
    customLeadFormSubmissionFields?: AdsLeadField[];
  };
};

export type MappedAdsLead = {
  externalId: string;
  name: string | null;
  email: string | null;
  phoneRaw: string | null;
  symptoms: string | null;
  submittedAt: string | null;
};

/** GAQL is fixed here so a caller cannot widen the query. */
export function googleAdsLeadQuery(sinceDay: string): string {
  return `SELECT lead_form_submission_data.id,
            lead_form_submission_data.submission_date_time,
            lead_form_submission_data.lead_form_submission_fields,
            lead_form_submission_data.custom_lead_form_submission_fields
     FROM lead_form_submission_data
     WHERE lead_form_submission_data.submission_date_time >= '${sinceDay} 00:00:00'
     ORDER BY lead_form_submission_data.submission_date_time DESC
     LIMIT 200`;
}

export function sinceDayUtc(sinceMs: number): string {
  return new Date(sinceMs).toISOString().slice(0, 10);
}

export function mapAdsLeadSubmission(row: AdsLeadSubmissionRow): MappedAdsLead | null {
  const data = row.leadFormSubmissionData;
  const id = data?.id?.trim();
  if (!id) return null;
  const fields = [
    ...(data?.leadFormSubmissionFields ?? []),
    ...(data?.customLeadFormSubmissionFields ?? []),
  ];
  const full = valueOf(fields, "FULL_NAME");
  const first = valueOf(fields, "FIRST_NAME");
  const last = valueOf(fields, "LAST_NAME");
  const combined = [first, last].filter(Boolean).join(" ");
  const name = full ?? (combined || null);
  const emailRaw = valueOf(fields, "EMAIL") ?? valueOf(fields, "WORK_EMAIL");
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  const phoneRaw = valueOf(fields, "PHONE_NUMBER") ?? valueOf(fields, "WORK_PHONE");
  const notes = fields.flatMap((field) => {
    const type = (field.fieldType ?? "").toUpperCase();
    const value = field.fieldValue?.trim();
    if (!value || !type.startsWith("CUSTOM")) return [];
    return [value];
  });
  if (!name && !email && !phoneRaw) return null;
  const submitted = data?.submissionDateTime?.trim();
  return {
    externalId: `google-ads:${id}`,
    name: name ? name.slice(0, 200) : null,
    email,
    phoneRaw,
    symptoms: notes.length > 0 ? notes.join("\n").slice(0, 2000) : null,
    submittedAt: submitted && !Number.isNaN(Date.parse(submitted)) ? new Date(submitted).toISOString() : null,
  };
}

function valueOf(fields: AdsLeadField[], type: string): string | null {
  const found = fields.find((field) => (field.fieldType ?? "").toUpperCase() === type);
  const value = found?.fieldValue?.trim();
  return value || null;
}
