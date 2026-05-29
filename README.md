# AV-IO Genie

An open-source format for describing device input/output (I/O) data, plus tooling to author and consume it.

> **Status: pre-design.** The specification, schema, and tooling are being designed.
> See [`docs/DESIGN.md`](docs/DESIGN.md) once it lands.

## What problem this solves

AV / control-systems designers (using CAD tools like **AVCAD**, **D-Tools**, and similar)
have no universal, machine-readable source of truth for a device's connectors, signals,
power, and control characteristics. Today that data lives in PDF spec sheets and has to be
re-keyed by hand into every design tool's product database.

This project defines:

1. **A file format** that manufacturers can ship alongside their support documents,
   describing a device's I/O, parametric data, and applicable standards.
2. **Tooling** to author, validate, and consume those files.
3. **A bootstrap importer** ("Genie") that parses existing spec sheets into draft files.

## License

TBD (see design memo).
