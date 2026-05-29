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
from typing import Any

from .models import ConfidenceSignals

# A current Claude model id. Override per-call via the CLI ``--model`` flag.
DEFAULT_MODEL = "claude-opus-4-8"


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


class MockExtractor(Extractor):
    """Deterministic extractor returning a fixed, schema-valid candidate.

    Optionally accepts a ``candidate`` to return verbatim, and ``signals`` to report,
    so tests can exercise the scorer with arbitrary inputs. ``text`` is ignored.
    """

    def __init__(
        self,
        candidate: dict[str, Any] | None = None,
        signals: ConfidenceSignals | None = None,
    ) -> None:
        self._candidate = candidate if candidate is not None else _MOCK_CANDIDATE
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
    "omit the field. For every field you are uncertain about, record its JSON path and "
    "a 0..1 confidence in the tool call's `_confidence` map so a human can review it."
)


def _tool_schema(device_schema: dict[str, Any]) -> dict[str, Any]:
    """Build the tool-use input schema: the device schema plus a confidence sidecar.

    Anthropic tool ``input_schema`` is a JSON Schema. We wrap the canonical device
    schema in an envelope so the model returns both the document and its self-reported
    confidence in one structured call.
    """
    device_props = copy.deepcopy(device_schema)
    return {
        "type": "object",
        "properties": {
            "device_document": device_props,
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
        "required": ["device_document"],
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
        model: str = DEFAULT_MODEL,
        examples: list[dict[str, Any]] | None = None,
        max_tokens: int = 8192,
        api_key: str | None = None,
    ) -> None:
        self.schema = schema
        self.model = model
        self.examples = examples or []
        self.max_tokens = max_tokens
        self._api_key = api_key
        self._last_signals = ConfidenceSignals()

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
        blocks: list[dict[str, Any]] = [{"type": "text", "text": _SYSTEM_PROMPT}]
        blocks.append(
            {
                "type": "text",
                "text": "ODIO v0.1 JSON Schema:\n" + json.dumps(self.schema),
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
        tool = {
            "name": "emit_odio_document",
            "description": "Emit the extracted ODIO device document plus confidence.",
            "input_schema": _tool_schema(self.schema),
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
                        "Extract an ODIO device document from this datasheet text:\n\n"
                        + text
                    ),
                }
            ],
        )

        tool_input = self._first_tool_use(response)
        document = tool_input.get("device_document", {})
        self._last_signals = ConfidenceSignals(
            field_confidence={
                k: float(v) for k, v in (tool_input.get("_confidence") or {}).items()
            },
            notes=dict(tool_input.get("_notes") or {}),
        )
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
