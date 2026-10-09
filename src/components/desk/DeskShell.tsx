import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, ClipboardList, LogOut, MessageCircle, Moon, Search, Settings2, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { signOutOwnerSession } from "@/lib/owner-session.browser";
import { useIsOwner } from "@/components/ops/Shell";
import { DeskChat } from "./DeskChat";
import { useDeskTheme } from "./useDeskTheme";

export function DeskShell({
  children,
  fullChat = false,
}: {
  children?: ReactNode;
  fullChat?: boolean;
}) {
  const isOwner = useIsOwner();
  const { theme, toggleTheme } = useDeskTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOutOwnerSession();
    await navigate({ to: "/auth", replace: true });
  }
  return (
    <div className="desk-app" data-theme={theme}>
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
          <Link to="/desk/tutorial" activeProps={{ className: "is-active" }}>
            <BookOpen size={18} />
            Tutorial
          </Link>
        </nav>
        <div className="desk-account">
          <button
            type="button"
            className="desk-theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"}
            title={theme === "dark" ? "Use light mode" : "Use dark mode"}
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
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
