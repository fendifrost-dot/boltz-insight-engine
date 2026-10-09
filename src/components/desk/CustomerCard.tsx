import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CarFront } from "lucide-react";
import type { DeskLeadCard } from "@/lib/desk-intake";
import { deskSourceLabel, deskStatusLabel, deskVehicle } from "@/lib/desk-display";
import { displayPhone } from "@/lib/lead-inbox-thread-sync";
import { appointmentLabel } from "@/lib/desk-schedule";

export function CustomerCard({
  lead,
  showVisit = false,
}: {
  lead: DeskLeadCard;
  showVisit?: boolean;
}) {
  return (
    <Link to="/desk/leads/$leadId" params={{ leadId: lead.id }} className="desk-customer-card">
      <span className="desk-customer-avatar">
        {lead.name?.trim().charAt(0).toUpperCase() || <CarFront size={20} />}
      </span>
      <div className="desk-customer-info">
        <strong>{lead.name || "Name not recorded"}</strong>
        <p>
          {displayPhone(lead.phone)}
          {deskVehicle(lead) ? ` · ${deskVehicle(lead)}` : ""}
        </p>
        <span>
          {showVisit && lead.appointmentAt
            ? appointmentLabel(lead.appointmentAt)
            : deskSourceLabel(lead.leadSource)}
        </span>
      </div>
      <span className="desk-status-pill">{deskStatusLabel(lead.lifecycle)}</span>
      <ArrowUpRight className="desk-card-arrow" size={18} />
    </Link>
  );
}
