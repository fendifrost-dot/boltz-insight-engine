import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, LogOut, MessageCircle, Search, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { signOutOwnerSession } from "@/lib/owner-session.browser";
import { useIsOwner } from "@/components/ops/Shell";
import { DeskChat } from "./DeskChat";

export function DeskShell({
  children,
  fullChat = false,
}: {
  children?: ReactNode;
  fullChat?: boolean;
}) {
  const isOwner = useIsOwner();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOutOwnerSession();
    await navigate({ to: "/auth", replace: true });
  }
  return (
    <div className="desk-app">
      <header className="desk-topbar">
        <Link to="/desk" className="desk-brand" aria-label="Boltz Automotive front desk">
          <img src="/boltz-logo.jpg" alt="Boltz Automotive" width="1282" height="480" />
          <span>SHOP DESK</span>
        </Link>
        <nav aria-label="Shop desk" className="desk-nav">
          <Link to="/desk" activeOptions={{ exact: true }} activeProps={{ className: "is-active" }}>
            <ClipboardList size={18} />
            Front desk
          </Link>
          <Link to="/desk/leads" activeProps={{ className: "is-active" }}>
            <Search size={18} />
            Find a customer
          </Link>
          <Link to="/desk/chat" activeProps={{ className: "is-active" }}>
            <MessageCircle size={18} />
            Grok chat
          </Link>
        </nav>
        <div className="desk-account">
          {isOwner && (
            <Link to="/" aria-label="Manage shop" title="Manage shop">
              <Settings2 size={19} />
            </Link>
          )}
          <button
            type="button"
            onClick={() => void signOut()}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={19} />
          </button>
        </div>
      </header>
      <div className={`desk-workspace ${fullChat ? "desk-chat-only" : ""}`}>
        {fullChat ? (
          <main>
            <DeskChat expanded />
          </main>
        ) : (
          <>
            <main className="desk-main">{children}</main>
            <aside className="desk-chat-aside" aria-label="Grok shop assistant">
              <DeskChat />
            </aside>
          </>
        )}
      </div>
      <footer className="desk-footer">
        <span>BOLTZ AUTOMOTIVE</span>
        <span>Chicago’s South Side · Built around our customers.</span>
      </footer>
    </div>
  );
}
