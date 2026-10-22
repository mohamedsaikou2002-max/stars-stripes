"""Antique-numeral schema obfuscation for Stars and Stripes.

Obfuscated identifiers raise the cost of casually reading a dumped schema.
They are NOT an access-control mechanism; real protection is RLS/privilege
lockdown, per-field encryption, and authenticated access (see docs/SECURITY.md).
"""
from .obfuscator import (  # noqa: F401
    ALPHABET,
    SymbolObfuscator,
    ProfileError,
    generate_profile,
    extend_profile,
    load_profile,
    save_profile,
    canonical_key,
    validate_profile,
)
from .render import render_template  # noqa: F401
