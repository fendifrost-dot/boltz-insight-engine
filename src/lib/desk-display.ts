/** Friendly display labels only; stored attribution and lifecycle values stay intact. */
export function deskSourceLabel(source: string | null): string {
  if (!source) return "Not recorded";
  const key = source.toLowerCase();
  if (key.includes("facebook") || key.includes("meta")) return "Facebook";
  if (key.includes("instagram")) return "Instagram";
  if (key.includes("google")) return key.includes("ads") ? "Google ad" : "Google";
  if (key.includes("ringcentral")) return "Text message";
  if (key.includes("durable")) return "Website";
  if (key === "bot_outbound") return "Shop follow-up";
  return source.replace(/_/g, " ");
}

export function deskStatusLabel(status: string): string {
  return (
    (
      {
        New: "New customer",
        Contacted: "Spoke with customer",
        Qualified: "Ready to book",
        "Appointment Scheduled": "Visit booked",
        Inspected: "Vehicle checked",
        "Estimate Sent": "Estimate sent",
        Approved: "Work approved",
        "In Progress": "Being repaired",
        Completed: "Repair finished",
        Paid: "Paid",
        Lost: "Did not book",
        "No response": "Waiting for a reply",
        "No-show": "Missed visit",
        "Outside service capability": "Service we don’t offer",
      } as Record<string, string>
    )[status] ?? status
  );
}

export function deskVehicle(lead: {
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
}): string {
  return [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(" ");
}
