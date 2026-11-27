# Category vocabulary

A controlled taxonomy for `device.category` and `bundle.category`, plus a map from the
categories already in the registry onto it.

| File | What it is |
| --- | --- |
| `categories.json` | The controlled paths, each with a short human label (115 in v0.1.0). |
| `category-map.json` | Every category seen in the production registry when the taxonomy was drawn up (968, from 2,591 rows), with its controlled target, the row `count` observed, and `review: true` (plus a `note`) where the mapping is a judgment call. Its `rules` section holds the canonicalization rules used for categories that are not in the map. |

## Advisory under v0.1

Schema v0.1 only constrains a category's shape (`^[a-z0-9]+(?:/[a-z0-9-]+)*$`), and
published schema versions are frozen (see `GOVERNANCE.md`). This taxonomy is therefore
**advisory**: a document whose category is not listed here is still valid. The tools
that write categories normalize them so that the registry's category facet stays clean:

- `normalizeCategory()` in `@opendeviceio/sdk` (`packages/ts-sdk/src/category.ts`),
  used by `tools/seed-registry.mjs` on ingest.
- `normalize_category()` in Genie (`genie/odio_genie/category.py`), applied to every
  draft in `assemble()`.
- `tools/rewrite-categories.mjs`, a one-off that rewrites existing registry rows
  (prints SQL by default; `--preview` prints a read-only check).

Both normalizers read these two files and behave the same way:

1. A category in the map returns its target, and a controlled path returns itself.
2. Any other category is tidied: lowercased, with separators cleaned up. Each segment
   then goes through the shared synonyms (`mounting` and `mount-kit` become `mount`,
   `accessories` becomes `accessory`, `multi-channel` becomes `multichannel`, and so on)
   and is made singular when the singular form is a known segment. Leading `audio/`
   and `video/` become `av/`, and leading `building/` and `hvac/` become `control/`.
   If the result is mapped or controlled, it is returned.
   Dropping a legacy leading domain can also give a controlled path, as when
   `av/control/keypad` becomes `control/keypad`.
3. Otherwise the tidied path is returned as is. An unknown but valid category is never
   moved to a "nearest" controlled path.

## Structure

Top-level domains are `av` (audio, video and conferencing), `control`, `lighting`,
`shading`, `security`, `power`, `it`, `software`, `service`, `cable` and `accessory`.
Paths have one to three levels. A parent such as `av/microphone` is itself a valid
category, used when the subtype is unknown. A category describes what a device *is*.
Its capabilities, such as being networked, using PoE or being multichannel, are
recorded in its ports and signals. For example, `av/amplifier/network` maps to
`av/amplifier/power`.

## Proposing changes

Additions and renames follow the **RFC-in-PR** process in `CONTRIBUTING.md`
("Adding to the vocabularies"). In the PR:

1. Edit `categories.json`, and edit `category-map.json` if existing categories should
   move. Give the term, its parent, why it is broadly useful (not one vendor's product
   line), and at least one real device that uses it.
2. Run `npm run gen-types -w @opendeviceio/sdk` to regenerate
   `packages/ts-sdk/src/category-vocab.ts`. The SDK tests fail if it is out of date.
3. Run the SDK tests (`npm run test -w @opendeviceio/sdk`) and Genie's (`pytest` in
   `genie/`). Both check that every map target is controlled and that no two
   controlled paths are near-duplicates.

New entries are additive and ship in a MINOR release. Moving or removing a path
changes how existing data is classified, so say so in the PR and plan a registry
rewrite (`tools/rewrite-categories.mjs`).

## Toward v0.2

Once the taxonomy has settled, an RFC may propose making `category` an enum (or an
enum with an `other` escape hatch, as other vocabularies have) in schema **v0.2**.
v0.1 stays as it is.

# Brand names and record id prefixes

A registry id looks like `<brand-slug>/<model-slug>[@<variant>]`. The prefix is always the
brand slug of the manufacturer. To get it, take the canonical brand name and slug it the way
the database does (`private.brand_slug`, stored as `organizations.slug`):

- accents stripped
- lowercase
- `&` becomes `and`
- every other run of characters outside a–z and 0–9 becomes `-`

For example, "QSC Audio Products, LLC" is QSC, so its prefix is `qsc`; "Stem Audio" gives `stem-audio`.

- **`manufacturers.json`**: curated aliases, mapping the comparison key of a name variant to
  the canonical brand name.
  - Used by the SDK's `normalizeManufacturer` and `expectedIdPrefix`, and by Genie.
  - Add an alias only when the mechanical key can't unify the variants. A wrong merge hides a
    real, distinct brand.
- **`id-prefixes.json`**: prefixes that were retired by a rename migration, each with its
  current prefix. Only add an entry together with the migration and its redirects.

What happens to an id under the wrong prefix:

- **Machine importers** (Genie, `tools/seed-registry.mjs`) rewrite it to the brand slug and log the change.
- **The website's publish and submission routes** reject it, with the corrected id in the error.
- **The database** rejects it as well (`id_prefix_mismatch`, `0013_record_id_cleanup.sql`).
- **`scripts/check-id-prefixes.mjs`** checks the test database in CI, and checks the live registry daily.
