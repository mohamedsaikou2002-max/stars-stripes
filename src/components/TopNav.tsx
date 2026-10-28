import { useEffect, useState } from "react";
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
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <nav className="w-full font-[Tektur]" aria-label="Primary navigation">
      <button type="button" aria-label={open ? "Close navigation" : "Open navigation"}
        aria-controls="stars-primary-links" aria-expanded={open}
        className="lg:hidden rounded-xl border border-slate-300 bg-white px-4 py-3 text-xs tracking-widest text-slate-900 min-h-11"
        onClick={() => setOpen(v => !v)}>
        {open ? "CLOSE MENU" : "MENU"}
      </button>
      <div id="stars-primary-links"
        className={`${open ? "flex" : "hidden"} lg:flex flex-col lg:flex-row lg:flex-wrap gap-2 lg:gap-x-4 lg:gap-y-3 mt-2 lg:mt-0 text-[11px] tracking-[0.15em] lg:tracking-[0.3em] bg-white/95 lg:bg-transparent border border-slate-200 lg:border-0 rounded-xl lg:rounded-none p-2 lg:p-0 shadow-md lg:shadow-none`}>
        {LINKS.filter(l => OPTIONAL[l.to] ?? true).map(l => {
          const active = pathname === l.to;
          return (
            <Link key={l.to} to={l.to}
              aria-current={active ? "page" : undefined}
              className={`block rounded-lg px-3 py-2 min-h-10 transition ${active ? "text-blue-800 border-l-2 lg:border-b-2 lg:border-l-0 border-red-500 bg-blue-50 lg:bg-transparent" : "text-slate-800/75 hover:bg-slate-100"}`}>
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
