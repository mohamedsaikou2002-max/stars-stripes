import { Link, useLocation } from "react-router-dom";

const LINKS = [
  { to: "/", label: "ADVISOR" },
  { to: "/eagle-view", label: "EAGLE VIEW" },
  { to: "/knowledge", label: "KNOWLEDGE" },
  { to: "/swarm", label: "SWARM" },
  { to: "/briefs", label: "BRIEFS" },
  { to: "/pod-room", label: "POLICY LAB" },
  { to: "/eagle-eye", label: "EAGLE EYE" },
  { to: "/game-theory", label: "GAME THEORY" },
  { to: "/profile", label: "PROFILE" },
  { to: "/home", label: "HOME" },
];

const OPTIONAL: Record<string, boolean> = {
  "/eagle-eye": import.meta.env.VITE_ENABLE_EAGLE_EYE === "true",
  "/home": import.meta.env.VITE_ENABLE_HOME_NODE === "true",
};

export const TopNav = () => {
  const { pathname } = useLocation();
  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-3 text-[11px] tracking-[0.3em] font-[Tektur]">
      {LINKS.filter((l) => OPTIONAL[l.to] ?? true).map((l) => {
        const active = pathname === l.to;
        return (
          <Link
            key={l.to}
            to={l.to}
            className={`transition ${active ? "text-blue-800 border-b-2 border-red-500" : "text-slate-900/60 hover:text-slate-900/80"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
};
