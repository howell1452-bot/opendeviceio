"""Retired id prefixes: the Python twin of the SDK's normalizeRecordId."""

from __future__ import annotations

import logging

import pytest

from odio_genie import (
    assemble,
    brand_slug,
    expected_id_prefix,
    normalize_manufacturer,
    normalize_record_id,
    with_brand_prefix,
)
from odio_genie.manufacturer import manufacturer_key
from odio_genie.record_id import retired_id_prefixes


def test_rewrites_the_retired_attero_prefix():
    assert normalize_record_id("attero-tech-by-qsc/axiom-ml1") == "attero-tech/axiom-ml1"
    assert normalize_record_id("attero-tech-by-qsc/und6io@2") == "attero-tech/und6io@2"


def test_leaves_other_ids_alone():
    for value in ["attero-tech/axiom-ml1", "crestron/dm-md8x8", "attero-tech-by-qsc", "", None, 42]:
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


# Registry paging and ID cleanup brief, item 4: the prefix is the brand slug.

@pytest.mark.parametrize(
    "name,slug",
    [
        ("1Beyond", "1beyond"),
        ("Attero Tech", "attero-tech"),
        ("Extreme Networks", "extreme-networks"),
        ("NETGEAR", "netgear"),
        ("Stem Audio", "stem-audio"),
        ("New Brand & Co", "new-brand-and-co"),
        ("  --Odd__Name--  ", "odd-name"),
        ("Société Générale", "societe-generale"),
        ("İstanbul Ses", "istanbul-ses"),
        ("Cafe\u0301 Audio", "cafe-audio"),
        ("Ørsted", "rsted"),
    ],
)
def test_brand_slug_matches_sql(name, slug):
    assert brand_slug(name) == slug


@pytest.mark.parametrize(
    "name,prefix",
    [
        ("Q-SYS", "qsc"),
        ("QSYS", "qsc"),
        ("QSC Audio", "qsc"),
        ("QSC Audio Products, LLC", "qsc"),
        ("USL Inc", "usl"),
        ("USL, Inc.", "usl"),
        ("US L Inc", "usl"),
        ("Ultra Stereo Labs", "usl"),
        ("DIS Digital Conference Systems", "dis"),
        ("Attero Tech by QSC", "attero-tech"),
        ("Extreme Networks", "extreme-networks"),
    ],
)
def test_aliases_map_to_the_brand_slug(name, prefix):
    assert expected_id_prefix(name) == prefix


def test_manufacturer_key_and_normalize_match_the_sdk():
    assert manufacturer_key("USL, Inc.") == "usl"
    assert manufacturer_key("Inc") == ""
    assert normalize_manufacturer("Q-SYS") == "QSC"
    assert normalize_manufacturer("Some New Brand GmbH") == "Some New Brand GmbH"


@pytest.mark.parametrize(
    "old,manufacturer,new",
    [
        ("qsys/ad-c6t-zb", "QSC", "qsc/ad-c6t-zb"),
        ("qsc-audio-products/cx4", "QSC Audio Products", "qsc/cx4"),
        ("uslinc/cm-10b", "USL", "usl/cm-10b"),
        ("usl-inc/jsd", "USL Inc", "usl/jsd"),
        ("dis-digital-conference-systems/dm-6680-f", "DIS", "dis/dm-6680-f"),
        ("crestron/cen-extrm-220-24p-kit", "Extreme Networks", "extreme-networks/cen-extrm-220-24p-kit"),
        ("qsys/core-110f@v2", "Q-SYS", "qsc/core-110f@v2"),
    ],
)
def test_assemble_puts_the_id_under_the_brand_slug_and_logs_it(old, manufacturer, new, caplog):
    doc = {"id": old, "device": {"manufacturer": manufacturer, "model": "X"}, "ports": []}
    with caplog.at_level(logging.WARNING, logger="odio_genie"):
        assemble(doc)
    assert doc["id"] == new
    assert f"{old} -> {new}" in caplog.text


def test_assemble_leaves_a_correct_id_alone_and_quiet(caplog):
    doc = {"id": "qsc/core-610", "device": {"manufacturer": "QSC", "model": "Core 610"}, "ports": []}
    with caplog.at_level(logging.WARNING, logger="odio_genie"):
        assemble(doc)
    assert doc["id"] == "qsc/core-610"
    assert caplog.text == ""


def test_without_a_manufacturer_only_retired_prefixes_change():
    assert with_brand_prefix("qsys/x", None) == "qsc/x"
    assert with_brand_prefix("someone/x", None) == "someone/x"
