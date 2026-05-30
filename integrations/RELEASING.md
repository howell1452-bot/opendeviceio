# Releasing the design-tool plugins (signed, downloadable)

The lightweight "build it yourself" form isn't viable for most users, so the goal is
**signed installers people download and double-click**. This documents the pipeline and
the one-time setup. The CI is in `.github/workflows/release-plugins.yml`.

> **Doing this for the first time?** Follow the step-by-step, copy-pasteable
> [`SIGNING-SETUP.md`](./SIGNING-SETUP.md): an unsigned proof-of-build first, then
> Azure Trusted Signing, then the signed tag, then Adobe Exchange for InDesign.
> This file is the overview/reference; that file is the checklist.

## What's automated vs. what only you can provide

Automated (GitHub Actions, Windows + Linux runners):
- Build the AutoCAD add-in and Visio app, package the AutoCAD auto-load `.bundle`, and
  package the InDesign UXP `.ccx`.
- **Authenticode-sign** the Windows binaries when signing secrets are present.
- Publish all artifacts to a **GitHub Release** on a `plugins-v*` tag.

Only you can provide (CI/this repo cannot):
1. **A code-signing identity.** Without it, Windows shows SmartScreen / "unknown
   publisher" warnings — the exact thing that blocks the 90%.
2. **A first green build.** The C# projects must compile against your target AutoCAD /
   Visio versions (the scaffolds are untested in this repo). Fix compile errors the first
   run surfaces.
3. **Testing in the actual apps.** CI can't run AutoCAD / Visio / InDesign.

## Signing options (Windows: AutoCAD + Visio)

Since 2023 the CA/Browser Forum requires OV/EV code-signing keys to live on hardware or
in the cloud (you usually can't export a plain `.pfx` for a new cert), so the practical
choices are:

- **Azure Trusted Signing (recommended).** ~$10/month, cloud-based, no HSM, first-class
  GitHub Action (`azure/trusted-signing-action`, already wired in the workflow). After
  identity validation you get a publicly-trusted cert. Set these repo **secrets**:
  `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `TRUSTED_SIGNING_ENDPOINT`,
  `TRUSTED_SIGNING_ACCOUNT`, `TRUSTED_SIGNING_PROFILE`.
- **EV via cloud HSM** (DigiCert KeyLocker, SSL.com eSigner): best SmartScreen reputation
  from day one; more cost/setup. Swap the sign step for the vendor's action.
- **OV `.pfx` in a secret**: only if your CA still issues exportable OV certs (rare now).

InDesign is **not** Authenticode — distribute the `.ccx` via **Adobe Exchange** (free;
Adobe reviews and signs on submission) or sideload it through the Creative Cloud desktop
app. Marketplace listing is the path that gives users a trusted one-click install.

## Cut a release

1. Configure the signing secrets above (one time).
2. Tag and push: `git tag plugins-v0.1.0 && git push origin plugins-v0.1.0`.
3. The workflow builds, signs, and creates the GitHub Release with the three downloads.
4. The website `/tools` page links users to the Releases page.

## Recommended hardening before a public release

- AutoCAD: ship a WiX **MSI** (in addition to the `.bundle`) for a familiar installer.
- Visio: promote the console preview to a proper **VSTO/COM add-in** (ribbon button) with
  an MSI that registers it; the current build draws via COM but isn't a packaged add-in.
- InDesign: submit to Adobe Exchange for the trusted one-click install.
