from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .obfuscator import extend_profile, generate_profile, load_profile, save_profile, validate_profile
from .render import logical_names, render_template


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="schema_obfuscation", description="Antique-numeral schema obfuscation tools")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="create a brand-new random profile")
    g.add_argument("--names", required=True, help="comma-separated logical names")
    g.add_argument("--out", required=True)
    g.add_argument("--seed", help="reproducible output (tests only; omit in production)")

    e = sub.add_parser("extend", help="add random symbols for names a template needs; keeps existing ones")
    e.add_argument("--profile", required=True)
    e.add_argument("--template", required=True)
    e.add_argument("--seed")

    r = sub.add_parser("render", help="render a SQL template with a profile")
    r.add_argument("--profile", required=True)
    r.add_argument("--template", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--schema", default="core")

    v = sub.add_parser("verify", help="check a profile for collisions (exact, NFKC, reserved words, length)")
    v.add_argument("--profile", required=True)

    a = p.parse_args(argv)
    if a.cmd == "generate":
        names = [n.strip() for n in a.names.split(",") if n.strip()]
        save_profile(generate_profile(names, seed=a.seed), a.out)
        print(f"wrote {a.out} ({len(names)} symbols)")
    elif a.cmd == "extend":
        prof = load_profile(a.profile)
        needed = logical_names(Path(a.template).read_text(encoding="utf-8"))
        before = set(prof["symbol_mappings"])
        prof["symbol_mappings"] = extend_profile(prof["symbol_mappings"], needed, seed=a.seed)
        save_profile(prof, a.profile)
        print("added:", ", ".join(sorted(set(prof["symbol_mappings"]) - before)) or "(nothing)")
    elif a.cmd == "render":
        prof = load_profile(a.profile)
        sql = render_template(Path(a.template).read_text(encoding="utf-8"), prof["symbol_mappings"], schema=a.schema)
        Path(a.out).write_text(sql, encoding="utf-8")
        print(f"wrote {a.out}")
    elif a.cmd == "verify":
        validate_profile(load_profile(a.profile)["symbol_mappings"])
        print("profile OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
