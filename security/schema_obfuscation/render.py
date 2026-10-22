from __future__ import annotations

import re
from typing import Mapping

from .obfuscator import SymbolObfuscator

# {{t:name}} -> quoted obfuscated table ident   {{c:name}} -> quoted obfuscated column ident
# {{s}}      -> private schema name
_TOKEN = re.compile(r"\{\{\s*(t|c|s)(?::([a-z][a-z0-9_]*))?\s*\}\}")


def logical_names(template: str) -> list[str]:
    """Logical names a template needs mapped, in first-use order."""
    seen: dict[str, None] = {}
    for kind, name in _TOKEN.findall(template):
        if kind in ("t", "c") and name:
            seen.setdefault(name, None)
    return list(seen)


def render_template(template: str, mapping: Mapping[str, str], *, schema: str = "core") -> str:
    ob = SymbolObfuscator(mapping)
    missing = [n for n in logical_names(template) if n not in mapping]
    if missing:
        raise KeyError(
            "profile has no symbol for: " + ", ".join(missing) + "  (run the 'extend' command first)"
        )

    def sub(m: re.Match) -> str:
        kind, name = m.group(1), m.group(2)
        if kind == "s":
            return SymbolObfuscator.quote(schema)
        if not name:
            raise ValueError(f"placeholder {m.group(0)!r} needs a name")
        return ob.ident(name)

    out = _TOKEN.sub(sub, template)
    if "{{" in out:
        raise ValueError("unrendered placeholder left in output")
    return out
