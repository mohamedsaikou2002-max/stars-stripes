from __future__ import annotations

import json
import random
import secrets
import unicodedata
from pathlib import Path
from typing import Iterable, Mapping

# Unicode "Number Forms" block: Roman numerals (upper/lower) plus the archaic
# Claudian/antiquated letters. Every code point below is assigned.
ALPHABET: tuple[str, ...] = tuple(
    [chr(c) for c in range(0x2160, 0x2189)]      # Ⅰ … ↈ  (incl. ↀ ↁ ↂ Ↄ ↅ ↆ ↇ ↈ)
    + [chr(c) for c in range(0x2170, 0x2180)]    # ⅰ … ⅿ
    + ["\u2184"]                                  # ↄ
)
ALPHABET = tuple(dict.fromkeys(ALPHABET))  # de-dup, keep order

MAX_IDENT_BYTES = 63  # PostgreSQL NAMEDATALEN-1

# Names we never want an identifier to collapse to after normalisation, because
# some tool in the chain may normalise and then emit it unquoted.
_RESERVED = frozenset(
    "all analyse analyze and any array as asc asymmetric both case cast check collate column constraint "
    "create current_catalog current_date current_role current_time current_timestamp current_user default "
    "deferrable desc distinct do else end except false fetch for foreign from grant group having in "
    "initially intersect into lateral leading limit localtime localtimestamp not null offset on only or "
    "order placing primary references returning select session_user some symmetric table then to trailing "
    "true union unique user using variadic when where window with".split()
)


class ProfileError(ValueError):
    pass


def canonical_key(identifier: str) -> str:
    """Form under which two identifiers must NOT collide.

    Many tools (JS, editors, ORMs, copy/paste paths) apply NFKC, which turns
    Ⅻ into "XII"; case-folding then merges Ⅹ/ⅹ. Postgres itself compares bytes,
    so a pair like "ⅩⅠⅠ" and "Ⅻ" is distinct in the DB but identical after NFKC.
    We refuse such pairs so no normalising tool can ever alias two columns.
    """
    return unicodedata.normalize("NFKC", identifier).casefold()


def _check_identifier(name: str) -> None:
    if not name:
        raise ProfileError("empty identifier")
    if len(name.encode("utf-8")) > MAX_IDENT_BYTES:
        raise ProfileError(f"identifier too long for PostgreSQL ({len(name.encode())} bytes): {name!r}")
    if any(ch in name for ch in ('"', "\x00", "\\", "\n", "\r", "\t", " ")):
        raise ProfileError(f"identifier contains forbidden character: {name!r}")
    if canonical_key(name) in _RESERVED:
        raise ProfileError(f"identifier normalises to a reserved word: {name!r}")


def validate_profile(mapping: Mapping[str, str]) -> None:
    """Raise ProfileError if the mapping is unsafe. Checks every pair, not just new ones."""
    seen_exact: dict[str, str] = {}
    seen_canon: dict[str, str] = {}
    for logical, symbol in mapping.items():
        _check_identifier(symbol)
        if symbol in seen_exact:
            raise ProfileError(f"duplicate symbol {symbol!r} for {logical!r} and {seen_exact[symbol]!r}")
        key = canonical_key(symbol)
        if key in seen_canon:
            raise ProfileError(
                f"symbols for {logical!r} and {seen_canon[key]!r} collide after NFKC/casefold ({key!r})"
            )
        seen_exact[symbol] = logical
        seen_canon[key] = logical
        # A symbol must not equal another *logical* clear-text name that stays unmapped.
        if symbol == logical:
            raise ProfileError(f"symbol for {logical!r} is identical to its clear-text name")


class SymbolObfuscator:
    """Bidirectional logical-name <-> symbol mapping (your original class, hardened)."""

    def __init__(self, mapping_dict: Mapping[str, str], *, validate: bool = True):
        if validate:
            validate_profile(mapping_dict)
        self.forward: dict[str, str] = dict(mapping_dict)
        self.reverse: dict[str, str] = {v: k for k, v in self.forward.items()}

    def encode_key(self, cleartext_key: str) -> str:
        """Swap a standard key/field for its symbol token (unmapped names pass through)."""
        return self.forward.get(cleartext_key, cleartext_key)

    def decode_key(self, symbol_token: str) -> str:
        """Restore a symbol token to its clear-text name."""
        return self.reverse.get(symbol_token, symbol_token)

    # --- SQL helpers -----------------------------------------------------
    @staticmethod
    def quote(identifier: str) -> str:
        """Quote an identifier for PostgreSQL. Never builds SQL from user *values*."""
        if '"' in identifier or "\x00" in identifier:
            raise ProfileError(f"cannot quote identifier: {identifier!r}")
        return '"' + identifier + '"'

    def ident(self, cleartext_key: str) -> str:
        return self.quote(self.encode_key(cleartext_key))

    def table(self, cleartext_key: str, schema: str | None = None) -> str:
        t = self.ident(cleartext_key)
        return f"{self.quote(schema)}.{t}" if schema else t

    def column(self, cleartext_key: str) -> str:
        return self.ident(cleartext_key)

    def encode_row(self, row: Mapping[str, object]) -> dict[str, object]:
        return {self.encode_key(k): v for k, v in row.items()}

    def decode_row(self, row: Mapping[str, object]) -> dict[str, object]:
        return {self.decode_key(k): v for k, v in row.items()}


def _rng(seed: int | str | None):
    # Seeded -> reproducible (tests/CI). Unseeded -> OS CSPRNG, so a leaked repo
    # does not reveal how to regenerate a customer's profile.
    return random.Random(seed) if seed is not None else secrets.SystemRandom()


def extend_profile(
    existing: Mapping[str, str],
    logical_names: Iterable[str],
    *,
    seed: int | str | None = None,
    min_len: int = 3,
    max_len: int = 5,
) -> dict[str, str]:
    """Add random symbols for any logical name not already mapped. Existing entries are untouched."""
    if not (1 <= min_len <= max_len <= 20):
        raise ProfileError("length bounds out of range")
    out = dict(existing)
    validate_profile(out)
    taken = {canonical_key(s) for s in out.values()}
    rng = _rng(seed)
    for logical in logical_names:
        if logical in out:
            continue
        for _ in range(10_000):
            n = rng.randint(min_len, max_len)
            cand = "".join(rng.choice(ALPHABET) for _ in range(n))
            key = canonical_key(cand)
            if key in taken or key in _RESERVED or cand == logical:
                continue
            out[logical] = cand
            taken.add(key)
            break
        else:  # pragma: no cover - astronomically unlikely
            raise ProfileError(f"could not find a free symbol for {logical!r}")
    validate_profile(out)
    return out


def generate_profile(
    logical_names: Iterable[str],
    *,
    name: str = "antique_numeral_obfuscation_v1",
    seed: int | str | None = None,
    **kw,
) -> dict:
    mapping = extend_profile({}, logical_names, seed=seed, **kw)
    return {"profile": name, "symbol_mappings": mapping}


def load_profile(path: str | Path) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if "symbol_mappings" not in data:
        raise ProfileError("profile JSON has no 'symbol_mappings'")
    validate_profile(data["symbol_mappings"])
    return data


def save_profile(profile: Mapping, path: str | Path) -> None:
    validate_profile(profile["symbol_mappings"])
    Path(path).write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
