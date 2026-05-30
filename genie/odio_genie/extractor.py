"""Extraction back-ends.

An :class:`Extractor` turns source text into a *candidate* ODIO document (a plain
``dict``). Two implementations are provided:

* :class:`MockExtractor` - deterministic, dependency-free, returns a fixed valid
  candidate. Used by the test suite and as an offline default.
* :class:`ClaudeExtractor` - calls the Anthropic Messages API with schema-shaped
  tool-use and prompt-caches the schema + few-shot examples. The ``anthropic`` SDK is
  imported lazily so importing this module never requires it.

The Anthropic API key is read from ``ANTHROPIC_API_KEY`` and is never hardcoded.
"""

from __future__ import annotations

import copy
import json
import os
from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
from typing import Any

from .models import ConfidenceSignals

# Default extraction model. Spec-sheet extraction is structured parsing, not deep
# reasoning, so a mid/cheap tier is the right default — Opus is ~15x the cost per token
# for little accuracy gain here. Sonnet balances quality and cost; for high-volume bulk
# ingest, override to Haiku ("claude-haiku-4-5-20251001") via the CLI ``--model`` flag.
DEFAULT_MODEL = "claude-sonnet-4-6"


# --- few-shot examples ------------------------------------------------------------

# Curated, small, high-quality reference docs loaded from the repo ``examples/``.
# Two diverse devices (a video/control HDBaseT extender and an IT/PoE switch) exercise
# connector/link/signals, count, poe, and multiple domains between them; one bundle
# covers the kit/assembly shape. Given to Haiku as a cached system block so it sees a
# worked example and emits far fewer schema-invalid drafts (cuts the escalation rate).
_DEVICE_EXAMPLE_FILES = (
    "extron-dtp2-t-211.odio.json",
    "netgear-m4250-poe.odio.json",
)
_BUNDLE_EXAMPLE_FILES = (("bundles", "crestron-uc-cx100-t-wm.odio.json"),)


def _examples_dir() -> Path:
    """Locate the repo ``examples/`` dir relative to this package.

    The package lives at ``<repo>/genie/odio_genie``; the examples are a frozen repo
    input at ``<repo>/examples`` (same resolution pattern as the schema lookup in
    pipeline.py — walk up from here looking for the directory).
    """
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "examples"
        if candidate.is_dir():
            return candidate
    # Fall back to the conventional location two levels up (genie/odio_genie -> repo).
    return here.parents[2] / "examples"


def _load_example(*parts: str) -> dict[str, Any]:
    path = _examples_dir().joinpath(*parts)
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=4)
def _cached_examples(kind: str) -> tuple[dict[str, Any], ...]:
    if kind == "bundle":
        return tuple(_load_example(*parts) for parts in _BUNDLE_EXAMPLE_FILES)
    return tuple(_load_example(name) for name in _DEVICE_EXAMPLE_FILES)


def default_examples(kind: str = "device") -> list[dict[str, Any]]:
    """Return the curated few-shot reference ODIO docs for ``kind``.

    ``kind="device"`` -> 2 compact, diverse device docs; ``kind="bundle"`` -> 1 bundle
    doc. Returns fresh deep copies so callers can mutate freely. Used as the default
    ``examples=`` for real extraction (overridable via ``--no-fewshot``).
    """
    return [copy.deepcopy(ex) for ex in _cached_examples(kind)]


# --- pricing (USD per million tokens; approximate / configurable) -----------------

# Rates are intentionally approximate and easy to tweak; the authoritative cost is
# always the Anthropic Console. Batch requests are billed at -50% (see ``estimate_cost``).
# Each entry: input / output / cache-read / cache-write (5-min ephemeral) per 1M tokens.
PRICING_USD_PER_MTOK: dict[str, dict[str, float]] = {
    "claude-haiku-4-5-20251001": {
        "input": 1.0,
        "output": 5.0,
        "cache_read": 0.10,
        "cache_write": 1.25,
    },
    "claude-sonnet-4-6": {
        "input": 3.0,
        "output": 15.0,
        "cache_read": 0.30,
        "cache_write": 3.75,
    },
    "claude-opus-4-8": {
        "input": 15.0,
        "output": 75.0,
        "cache_read": 1.50,
        "cache_write": 18.75,
    },
}


def usage_dict(usage: Any) -> dict[str, int]:
    """Normalize an Anthropic ``message.usage`` (object or dict) into a plain dict.

    Captures the four token counters used for cost. Missing fields default to 0 so an
    older/partial usage payload never crashes downstream cost math.
    """

    def _get(name: str) -> int:
        if usage is None:
            return 0
        if isinstance(usage, dict):
            value = usage.get(name)
        else:
            value = getattr(usage, name, None)
        return int(value) if value is not None else 0

    return {
        "input_tokens": _get("input_tokens"),
        "output_tokens": _get("output_tokens"),
        "cache_creation_input_tokens": _get("cache_creation_input_tokens"),
        "cache_read_input_tokens": _get("cache_read_input_tokens"),
    }


def estimate_cost(
    model: str, usage: dict[str, int] | None, *, batch: bool = False
) -> float | None:
    """Estimate USD cost for one request from its token usage.

    Returns ``None`` for an unknown model (caller treats cost as unavailable rather than
    crashing). ``batch=True`` halves the total to reflect the Batches API -50% discount.
    This is an ESTIMATE; the exact figure is in the Anthropic Console.
    """
    rates = PRICING_USD_PER_MTOK.get(model)
    if rates is None or not usage:
        return None
    cost = (
        usage.get("input_tokens", 0) * rates["input"]
        + usage.get("output_tokens", 0) * rates["output"]
        + usage.get("cache_read_input_tokens", 0) * rates["cache_read"]
        + usage.get("cache_creation_input_tokens", 0) * rates["cache_write"]
    ) / 1_000_000.0
    if batch:
        cost *= 0.5
    return round(cost, 6)


class Extractor(ABC):
    """Abstract extraction back-end: text in, candidate ODIO ``dict`` out."""

    @abstractmethod
    def extract(self, text: str) -> dict[str, Any]:
        """Return a candidate ODIO document parsed from ``text``."""
        raise NotImplementedError

    def signals(self) -> ConfidenceSignals:
        """Per-field confidence signals produced during the last extraction.

        Default: no explicit signals (the scorer's heuristics take over).
        """
        return ConfidenceSignals()


# Deterministic candidate returned by MockExtractor. This is a deliberately minimal
# but *schema-valid* device (Acme HDMI->HDBaseT extender) so tests never touch a
# network or any optional dependency.
_MOCK_CANDIDATE: dict[str, Any] = {
    "$schema": "https://opendeviceio.org/schema/v0.1/device.schema.json",
    "odioVersion": "0.1.0",
    "id": "acme/ext-100@a",
    "device": {
        "manufacturer": "Acme",
        "model": "EXT-100",
        "revision": "A",
        "category": "av/extender/transmitter",
    },
    "ports": [
        {
            "id": "hdmi-in",
            "label": "HDMI INPUT",
            "direction": "input",
            "connector": "hdmi-type-a",
            "link": {"type": "hdmi", "standard": "hdmi-2.0"},
            "location": {"face": "rear", "group": "inputs", "order": 1},
            "signals": [
                {
                    "domain": "video",
                    "transport": "hdmi",
                    "maxResolution": "3840x2160",
                    "maxRefreshHz": 60,
                    "hdcp": "2.2",
                },
                {"domain": "audio", "transport": "lpcm", "maxChannelsPerCircuit": 8},
            ],
        },
        {
            "id": "hdbaset-out",
            "label": "HDBT OUTPUT",
            "direction": "output",
            "connector": "rj45",
            "link": {"type": "twisted-pair", "standard": "hdbaset"},
            "location": {"face": "rear", "group": "outputs", "order": 1},
            "signals": [
                {
                    "domain": "video",
                    "transport": "hdbaset",
                    "direction": "output",
                    "maxResolution": "3840x2160",
                    "maxRefreshHz": 60,
                },
                {"domain": "control", "transport": "rs-232", "direction": "bidirectional"},
            ],
        },
    ],
    "power": {
        "inputs": [{"type": "dc", "nominalVoltage": 12, "connector": "barrel-dc"}],
        "consumptionWatts": {"typical": 8, "max": 12},
    },
    "physical": {
        "dimensionsMm": {"width": 198, "height": 26, "depth": 102},
        "rackUnits": 0.5,
        "rackMountable": True,
        "rackWidth": "half",
        "mounting": ["surface", "rack"],
    },
    "standards": [
        {"category": "safety", "name": "UL 62368-1"},
        {"category": "emc", "name": "FCC Part 15 Class A"},
    ],
}


# Deterministic bundle candidate returned by MockExtractor when asked for a kit. A
# deliberately small but *schema-valid* bundle: one orderable part number whose
# components[] contains a device and a factory-terminated cable.
_MOCK_BUNDLE_CANDIDATE: dict[str, Any] = {
    "$schema": "https://opendeviceio.org/schema/v0.1/bundle.schema.json",
    "odioVersion": "0.1.0",
    "kind": "bundle",
    "id": "acme/kit-100",
    "bundle": {
        "manufacturer": "Acme",
        "model": "KIT-100",
        "category": "av/conferencing/kit",
        "description": "Acme extender kit: one transmitter plus a factory-terminated cable.",
    },
    "components": [
        {
            "type": "device",
            "designator": "Transmitter",
            "device": {
                "manufacturer": "Acme",
                "model": "EXT-100",
                "category": "av/extender/transmitter",
            },
            "ports": [
                {
                    "id": "hdmi-in",
                    "label": "HDMI INPUT",
                    "direction": "input",
                    "connector": "hdmi-type-a",
                    "link": {"type": "hdmi", "standard": "hdmi-2.0"},
                    "signals": [
                        {"domain": "video", "transport": "hdmi", "maxResolution": "3840x2160"}
                    ],
                }
            ],
        },
        {
            "type": "cable",
            "designator": "HDMI patch",
            "quantity": 1,
            "cable": {
                "manufacturer": "Acme",
                "model": "CBL-HD-2",
                "factoryTerminated": True,
                "lengthMeters": 0.6,
                "lengthLabel": "2 ft (0.6 m)",
                "carries": [{"domain": "video", "transport": "hdmi"}],
                "ends": [
                    {"connector": "hdmi-type-a", "gender": "male"},
                    {"connector": "hdmi-type-a", "gender": "male"},
                ],
            },
        },
        {
            "type": "accessory",
            "name": "Mounting hardware",
            "description": "Bracket and screws (no I/O).",
        },
    ],
}


class MockExtractor(Extractor):
    """Deterministic extractor returning a fixed, schema-valid candidate.

    Optionally accepts a ``candidate`` to return verbatim, and ``signals`` to report,
    so tests can exercise the scorer with arbitrary inputs. ``text`` is ignored. Pass
    ``kind="bundle"`` to return the built-in valid bundle candidate instead of the
    device candidate (an explicit ``candidate`` always wins).
    """

    def __init__(
        self,
        candidate: dict[str, Any] | None = None,
        signals: ConfidenceSignals | None = None,
        *,
        kind: str = "device",
    ) -> None:
        if candidate is not None:
            self._candidate = candidate
        elif kind == "bundle":
            self._candidate = _MOCK_BUNDLE_CANDIDATE
        else:
            self._candidate = _MOCK_CANDIDATE
        self._signals = signals or ConfidenceSignals(
            field_confidence={
                # The mock pretends it was unsure about the max power figure.
                "power.consumptionWatts.max": 0.4,
            },
            notes={
                "power.consumptionWatts.max": "Max draw inferred from typical; verify on datasheet.",
            },
        )

    def extract(self, text: str) -> dict[str, Any]:  # noqa: ARG002 - text intentionally ignored
        # Return a deep copy so callers can mutate the result without corrupting the
        # shared template.
        return copy.deepcopy(self._candidate)

    def signals(self) -> ConfidenceSignals:
        return self._signals


# --- Claude tool-use prompt scaffolding -------------------------------------------

_SYSTEM_PROMPT = (
    "You are Genie, an expert AV/IT systems engineer that converts hardware device "
    "datasheets into OpenDeviceIO (ODIO) documents. You read the supplied datasheet "
    "text and emit ONE device object that conforms exactly to the ODIO v0.1 JSON "
    "Schema provided below. Rules: model only externally observable I/O; one entry "
    "per connector (use `count` for identical repeated connectors); put the physical "
    "jack in `connector`, the transmission layer in `link`, and each logical flow in "
    "`signals[]` keyed by `domain`. Use the controlled vocabularies; when a value is "
    "not listed use the relevant `*Other` free-text field with the parent set to "
    "'other'. Never invent specifications: if the datasheet does not state a value, "
    "omit the field. "
    "If the device is a NETWORK switch/router, set `network` (osiLayers, e.g. [2] for an "
    "L2 switch or [2,3] for L2+/multilayer; managed/unmanaged; routing). "
    "If the device is a MODULAR CHASSIS/FRAME that accepts plug-in cards, set `slots[]` "
    "(one per card slot: id, accepts[] of card slotType, role, powerBudgetW) and keep the "
    "frame's own fixed ports. If the device IS a plug-in card/module, set the `card` block "
    "(slotType it fits, slotSpan, role) and describe the card's own ports normally. "
    "For every field you are uncertain about, record its JSON path and "
    "a 0..1 confidence in the tool call's `_confidence` map so a human can review it."
)


_BUNDLE_SYSTEM_PROMPT = (
    "You are Genie, an expert AV/IT systems engineer that converts hardware KIT / "
    "ASSEMBLY datasheets into OpenDeviceIO (ODIO) bundle documents. You read the "
    "supplied datasheet text and emit ONE bundle object that conforms exactly to the "
    "ODIO v0.1 bundle JSON Schema provided below. A bundle is one orderable part number "
    "(`bundle.model`) whose `components[]` lists every contained item: each component "
    "is typed `device`, `bundle` (a nested sub-assembly), `cable`, or `accessory`. "
    "Model each contained device as a full ODIO device (device identity + ports[], "
    "modelling only externally observable I/O exactly as for a standalone device). "
    "Nest sub-assemblies as `type: bundle` components with their own `components[]`. "
    "Describe factory-terminated cables as `type: cable` with typed `ends[]` and length; "
    "list non-I/O items (brackets, mounting hardware, power packs) as `type: accessory`. "
    "Set `quantity` when a kit ships more than one of an item. Set top-level "
    "`kind: \"bundle\"`. Use the controlled vocabularies; when a value is not listed use "
    "the relevant `*Other` free-text field. Never invent specifications: if the "
    "datasheet does not state a value, omit the field. For every field you are uncertain "
    "about, record its JSON path and a 0..1 confidence in the tool call's `_confidence` "
    "map so a human can review it."
)


def _tool_schema(
    document_schema: dict[str, Any], *, key: str = "device_document"
) -> dict[str, Any]:
    """Build the tool-use input schema: the ODIO schema plus a confidence sidecar.

    Anthropic tool ``input_schema`` is a JSON Schema. We wrap the canonical document
    schema (device or bundle) in an envelope so the model returns both the document and
    its self-reported confidence in one structured call. ``key`` is the property name
    holding the emitted document.
    """
    doc_props = copy.deepcopy(document_schema)
    return {
        "type": "object",
        "properties": {
            key: doc_props,
            "_confidence": {
                "type": "object",
                "description": (
                    "Map of JSON path -> confidence (0..1) for fields you were unsure "
                    "about, plus optional notes."
                ),
                "additionalProperties": {"type": "number"},
            },
            "_notes": {
                "type": "object",
                "additionalProperties": {"type": "string"},
            },
        },
        "required": [key],
    }


class ClaudeExtractor(Extractor):
    """Anthropic-backed extractor using schema-shaped tool-use + prompt caching.

    The ``anthropic`` SDK is imported lazily inside :meth:`extract`, so constructing or
    importing this class does not require the ``[llm]`` extra. The schema and few-shot
    examples are sent as cached prompt blocks for cost and consistency.
    """

    def __init__(
        self,
        schema: dict[str, Any],
        *,
        kind: str = "device",
        model: str = DEFAULT_MODEL,
        examples: list[dict[str, Any]] | None = None,
        max_tokens: int = 8192,
        api_key: str | None = None,
    ) -> None:
        self.schema = schema
        self.kind = kind
        self.model = model
        self.examples = examples or []
        self.max_tokens = max_tokens
        self._api_key = api_key
        self._last_signals = ConfidenceSignals()
        # Token usage from the most recent ``extract`` (None until the first call).
        self.last_usage: dict[str, int] | None = None

    @property
    def _is_bundle(self) -> bool:
        return self.kind == "bundle"

    @property
    def _document_key(self) -> str:
        return "bundle_document" if self._is_bundle else "device_document"

    def _client(self) -> Any:
        try:
            import anthropic  # noqa: PLC0415 - lazy by design
        except ModuleNotFoundError as exc:  # pragma: no cover - exercised via CLI test
            from .pipeline import MissingExtraError

            raise MissingExtraError(
                "The 'anthropic' package is required for ClaudeExtractor. "
                "Install it with:  pip install 'odio-genie[llm]'"
            ) from exc

        api_key = self._api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            from .pipeline import GenieError

            raise GenieError(
                "ANTHROPIC_API_KEY is not set. Export it before running LLM extraction."
            )
        return anthropic.Anthropic(api_key=api_key)

    def _system_blocks(self) -> list[dict[str, Any]]:
        """System prompt + cached schema + cached few-shot examples.

        The schema and examples are large and identical across requests, so they are
        marked with ``cache_control`` to hit Anthropic's prompt cache.
        """
        prompt = _BUNDLE_SYSTEM_PROMPT if self._is_bundle else _SYSTEM_PROMPT
        label = "ODIO v0.1 bundle JSON Schema:\n" if self._is_bundle else "ODIO v0.1 JSON Schema:\n"
        blocks: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        blocks.append(
            {
                "type": "text",
                "text": label + json.dumps(self.schema),
                "cache_control": {"type": "ephemeral"},
            }
        )
        if self.examples:
            example_text = "\n\n".join(
                json.dumps(ex, indent=2) for ex in self.examples
            )
            blocks.append(
                {
                    "type": "text",
                    "text": "Few-shot reference ODIO documents:\n" + example_text,
                    "cache_control": {"type": "ephemeral"},
                }
            )
        return blocks

    def extract(self, text: str) -> dict[str, Any]:
        client = self._client()
        key = self._document_key
        doc_word = "bundle" if self._is_bundle else "device"
        tool = {
            "name": "emit_odio_document",
            "description": f"Emit the extracted ODIO {doc_word} document plus confidence.",
            "input_schema": _tool_schema(self.schema, key=key),
        }
        response = client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            system=self._system_blocks(),
            tools=[tool],
            tool_choice={"type": "tool", "name": "emit_odio_document"},
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Extract an ODIO {doc_word} document from this datasheet "
                        "text:\n\n" + text
                    ),
                }
            ],
        )

        self.last_usage = usage_dict(getattr(response, "usage", None))
        tool_input = self._first_tool_use(response)
        document = tool_input.get(key, {})
        # Coerce _confidence robustly: the model occasionally drops a textual
        # rationale where a number belongs; keep it as a note rather than raising.
        raw_conf = tool_input.get("_confidence") or {}
        field_confidence: dict[str, float] = {}
        spilled: dict[str, str] = {}
        if isinstance(raw_conf, dict):
            for k, v in raw_conf.items():
                try:
                    field_confidence[k] = float(v)
                except (TypeError, ValueError):
                    spilled[k] = str(v)
        notes = dict(tool_input.get("_notes") or {})
        notes.update(spilled)
        self._last_signals = ConfidenceSignals(field_confidence=field_confidence, notes=notes)
        return document

    @staticmethod
    def _first_tool_use(response: Any) -> dict[str, Any]:
        for block in getattr(response, "content", []) or []:
            if getattr(block, "type", None) == "tool_use":
                return dict(block.input)
        from .pipeline import GenieError

        raise GenieError("Claude response did not contain a tool_use block.")

    def signals(self) -> ConfidenceSignals:
        return self._last_signals
