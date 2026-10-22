import json
import sys
import unicodedata
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from schema_obfuscation import (  # noqa: E402
    ProfileError, SymbolObfuscator, extend_profile, generate_profile, load_profile, render_template, validate_profile,
)
from schema_obfuscation.render import logical_names  # noqa: E402

ROOT = Path(__file__).resolve().parents[1] / "schema_obfuscation"
USER_V1 = {
    "auth_users": "ⅨↂⅭ", "user_id": "ⅴⅵⅬ", "email": "Ⅻↁ", "password_hash": "ⅢↈⅯⅶ",
    "retrieval_records": "Ⅰↂↇⅴ", "record_id": "ⅭⅮⅿ", "owner_id": "ⅫↃⅷ",
    "source_origin": "ⅵↂⅷ", "category": "Ⅳⅹↅ", "payload": "ⅯⅭⅮ",
}


def test_users_original_mappings_are_valid_and_preserved_in_shipped_profile():
    validate_profile(USER_V1)
    shipped = load_profile(ROOT / "profiles" / "stars_v1.json")["symbol_mappings"]
    for k, v in USER_V1.items():
        assert shipped[k] == v


def test_original_example_output_unchanged():
    ob = SymbolObfuscator({"owner_id": "ⅫↃⅷ", "payload": "ⅯⅭⅮ", "retrieval_records": "Ⅰↂↇⅴ"})
    assert ob.encode_key("retrieval_records") == "Ⅰↂↇⅴ"
    assert ob.decode_key("ⅫↃⅷ") == "owner_id"
    assert ob.encode_key("created_at") == "created_at"  # unmapped passes through


def test_roundtrip_and_quoting():
    ob = SymbolObfuscator(USER_V1)
    for k in USER_V1:
        assert ob.decode_key(ob.encode_key(k)) == k
    assert ob.table("retrieval_records", "core") == '"core"."Ⅰↂↇⅴ"'
    with pytest.raises(ProfileError):
        SymbolObfuscator.quote('bad"name')


def test_nfkc_collision_is_rejected():
    # Ⅻ -> "XII" and ⅩⅠⅠ -> "XII": distinct bytes, identical once any tool normalises.
    assert unicodedata.normalize("NFKC", "Ⅻ") == unicodedata.normalize("NFKC", "ⅩⅠⅠ")
    with pytest.raises(ProfileError, match="collide"):
        validate_profile({"a": "Ⅻ", "b": "ⅩⅠⅠ"})


def test_case_fold_collision_is_rejected():
    with pytest.raises(ProfileError, match="collide"):
        validate_profile({"a": "ⅩⅠ", "b": "ⅹⅰ"})


def test_exact_duplicate_and_bad_identifiers_rejected():
    with pytest.raises(ProfileError):
        validate_profile({"a": "ⅩⅠ", "b": "ⅩⅠ"})
    with pytest.raises(ProfileError):
        validate_profile({"a": 'Ⅰ"Ⅱ'})
    with pytest.raises(ProfileError, match="too long"):
        validate_profile({"a": "Ⅰ" * 22})  # 3 bytes each -> 66 bytes
    with pytest.raises(ProfileError, match="identical"):
        validate_profile({"abc": "abc"})


def test_generate_random_profiles_are_valid_unique_and_differ():
    names = [f"col_{i}" for i in range(200)]
    a = generate_profile(names)["symbol_mappings"]
    b = generate_profile(names)["symbol_mappings"]
    validate_profile(a)
    assert len(set(a.values())) == 200
    assert a != b  # unseeded -> CSPRNG


def test_seeded_generation_is_reproducible():
    assert generate_profile(["x", "y"], seed=7) == generate_profile(["x", "y"], seed=7)
    assert generate_profile(["x", "y"], seed=7) != generate_profile(["x", "y"], seed=8)


def test_extend_keeps_existing_and_adds_only_missing():
    out = extend_profile(USER_V1, ["email", "brand_new"], seed=1)
    assert {k: out[k] for k in USER_V1} == USER_V1
    assert "brand_new" in out and len(out) == len(USER_V1) + 1


def test_every_symbol_in_alphabet_is_assigned_and_postgres_safe():
    from schema_obfuscation import ALPHABET
    assert all(unicodedata.category(c) in ("Nl", "Ll", "Lu") for c in ALPHABET)
    assert len(ALPHABET) >= 40


def test_render_reproduces_users_original_tables():
    prof = load_profile(ROOT / "profiles" / "stars_v1.json")["symbol_mappings"]
    sql = render_template((ROOT / "templates" / "core.sql.tmpl").read_text(encoding="utf-8"), prof)
    # Their two tables, with their symbols, must appear exactly as authored.
    assert 'CREATE TABLE IF NOT EXISTS "core"."ⅨↂⅭ" (\n    "ⅴⅵⅬ" UUID PRIMARY KEY' in sql
    assert '"Ⅻↁ" VARCHAR(255) UNIQUE NOT NULL' in sql
    assert '"ⅢↈⅯⅶ" VARCHAR(255) NOT NULL' in sql
    assert '"ⅫↃⅷ" UUID REFERENCES "core"."ⅨↂⅭ"("ⅴⅵⅬ")' in sql
    assert '"ⅵↂⅷ" VARCHAR(100) NOT NULL' in sql and '"Ⅳⅹↅ" VARCHAR(100) NOT NULL' in sql
    assert '"ⅯⅭⅮ" JSONB NOT NULL DEFAULT \'{}\'::jsonb' in sql
    assert "{{" not in sql


def test_shipped_migration_is_in_sync_with_template_and_profile():
    prof = load_profile(ROOT / "profiles" / "stars_v1.json")["symbol_mappings"]
    rendered = render_template((ROOT / "templates" / "core.sql.tmpl").read_text(encoding="utf-8"), prof)
    shipped = (Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "20261022000000_obfuscated_core.sql").read_text(encoding="utf-8")
    assert rendered == shipped, "re-run: python -m schema_obfuscation render ..."


def test_render_fails_loudly_on_unmapped_name():
    with pytest.raises(KeyError, match="no symbol"):
        render_template("SELECT {{c:not_mapped}}", USER_V1)


def test_template_names_are_all_mapped():
    prof = load_profile(ROOT / "profiles" / "stars_v1.json")["symbol_mappings"]
    names = logical_names((ROOT / "templates" / "core.sql.tmpl").read_text(encoding="utf-8"))
    assert set(names) <= set(prof)
