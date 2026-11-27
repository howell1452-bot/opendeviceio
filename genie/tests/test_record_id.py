"""Retired id prefixes: the Python twin of the SDK's normalizeRecordId."""

from __future__ import annotations

from odio_genie import assemble, normalize_record_id
from odio_genie.record_id import retired_id_prefixes


def test_rewrites_the_retired_attero_prefix():
    assert normalize_record_id("attero-tech-by-qsc/axiom-ml1") == "attero-tech/axiom-ml1"
    assert normalize_record_id("attero-tech-by-qsc/und6io@2") == "attero-tech/und6io@2"


def test_leaves_other_ids_alone():
    for value in ["attero-tech/axiom-ml1", "qsys/core-110f", "attero-tech-by-qsc", "", None, 42]:
        assert normalize_record_id(value) == value


def test_map_points_at_current_prefixes_only():
    retired = retired_id_prefixes()
    assert retired["attero-tech-by-qsc"] == "attero-tech"
    for current in retired.values():
        assert current not in retired


def test_assemble_normalizes_the_draft_id():
    doc = {
        "id": "attero-tech-by-qsc/axon-dth1620",
        "device": {"manufacturer": "Attero Tech by QSC", "model": "Axon D-TH1620"},
        "ports": [],
    }
    assemble(doc)
    assert doc["id"] == "attero-tech/axon-dth1620"
