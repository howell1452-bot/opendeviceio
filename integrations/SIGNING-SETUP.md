# Signing setup — step by step

This is the hands-on companion to [`RELEASING.md`](./RELEASING.md). It walks you
through (A) getting a **first green build with no signing** to prove the plugins
compile, then (B) standing up **Azure Trusted Signing** and wiring the six GitHub
secrets, then (C) cutting the **signed** release, and (D) the **InDesign / Adobe
Exchange** path (which is *not* Authenticode).

Everything the repo can do is already wired in `.github/workflows/release-plugins.yml`.
The steps below are the parts only you can do (they need your Azure tenant, your
identity, and a human testing the installers in AutoCAD/Visio/InDesign).

---

## A. First: a green build with NO signing (do this before buying anything)

This proves the C# compiles against the NuGet host assemblies (AutoCAD.NET,
Visio interop) and that the artifacts package — without spending a cent on a cert.
The sign steps auto-skip when no Azure secrets are present.

1. Push the current branch so the workflow file is on GitHub.
2. GitHub → **Actions** → **Release plugins** → **Run workflow** (this is the
   `workflow_dispatch` trigger). Leave the version as `0.1.0` → **Run**.
3. Wait for the three jobs (`autocad`, `visio`, `indesign`) to go green. The
   `release` job is skipped on a manual run — that's expected (it only runs on a
   `plugins-v*` tag).
4. Open the run and download the **artifacts** at the bottom:
   - `autocad` → `OdioImport-autocad.zip` + `OdioImport-autocad.msi`
   - `visio` → `OdioToVisio.zip` + `OdioToVisio.msi`
   - `indesign` → `opendeviceio.ccx`

**If a build is red**, it's almost always one of:
- **NuGet version mismatch** — `AutoCAD.NET` `23.0.0` targets the AutoCAD 2019 API
  (loads in 2018–2024). If you need a different release, change the `<Version>` in
  [`autocad/OdioImport.csproj`](./autocad/OdioImport.csproj) per the table in its
  README. Same idea for `Microsoft.Office.Interop.Visio` in
  [`visio/OdioToVisio.csproj`](./visio/OdioToVisio.csproj).
- **A compile error in the scaffold** — these add-ins were written but not compiled
  in this repo. Fix what the log points at and push again. (COM cell names/units in
  the Visio app and the `page.place(...)` call in InDesign are the usual suspects,
  but those surface at *run* time, not build time.)

Only once this is green is it worth setting up signing.

---

## B. Azure Trusted Signing (Windows: AutoCAD + Visio)

~$10/month, cloud-based, no hardware token, and it's a publicly-trusted cert so
Windows SmartScreen stops warning. The workflow already calls
`azure/trusted-signing-action@v0` with client-secret auth — you just provide the
account and a service principal.

> Region note: Trusted Signing is available in **East US, West US 3, West Central
> US, North Europe, West Europe**. Create the account in one of those.

### B1. Create the Trusted Signing account + certificate profile

In the **Azure portal**:

1. In the search bar, open **Trusted Signing Accounts** → **Create**.
   - Subscription / Resource group: your choice.
   - Region: one of the supported ones above.
   - SKU: **Basic** (≈ $9.99/mo) is plenty for this volume.
   - Note the account **name** → this is `TRUSTED_SIGNING_ACCOUNT`.
2. After it deploys, open the account → **Overview** and copy the **Account URI /
   endpoint** (looks like `https://eus.codesigning.azure.net` for East US,
   `https://wus3.codesigning.azure.net` for West US 3, `https://weu.codesigning.azure.net`
   for West Europe, etc.) → this is `TRUSTED_SIGNING_ENDPOINT`.
3. **Identity validation**: in the account, open **Identity validations** → **New**.
   - **Organization** (recommended for a published brand) requires business details
     and takes ~1–5 business days to approve. **Individual** is faster but the
     publisher shows as a person.
   - The approved identity becomes the certificate's subject (the "publisher" users
     see). You can't create a Public-Trust profile until this says **Completed**.
4. **Certificate profile**: account → **Certificate profiles** → **Create**.
   - Type: **Public Trust**.
   - Link the completed identity validation.
   - Note the profile **name** → this is `TRUSTED_SIGNING_PROFILE`.

### B2. Create a service principal for GitHub to sign with

GitHub Actions authenticates as an Entra ID app using a client secret.

Using the **Azure CLI** (easiest):

```bash
# 1. Create the app + service principal. Copy the appId and password it prints.
az ad sp create-for-rbac --name "odio-trusted-signing-ci"
#   -> { "appId": "<AZURE_CLIENT_ID>", "password": "<AZURE_CLIENT_SECRET>",
#        "tenant": "<AZURE_TENANT_ID>" }

# 2. Grant it permission to sign with your account. Scope it to the Trusted
#    Signing account resource id (Portal: account -> Properties -> Resource ID,
#    or `az resource show`).
az role assignment create \
  --assignee "<AZURE_CLIENT_ID>" \
  --role "Trusted Signing Certificate Profile Signer" \
  --scope "/subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.CodeSigning/codeSigningAccounts/<ACCOUNT_NAME>"
```

(Portal equivalent: the account → **Access control (IAM)** → **Add role
assignment** → role **Trusted Signing Certificate Profile Signer** → assign to the
`odio-trusted-signing-ci` app.)

### B3. Put the six values into GitHub secrets

GitHub → repo **Settings** → **Secrets and variables** → **Actions** → **New
repository secret**, once per value:

| Secret | Where it came from |
| --- | --- |
| `AZURE_TENANT_ID` | `tenant` from `create-for-rbac` (your Entra directory id) |
| `AZURE_CLIENT_ID` | `appId` from `create-for-rbac` |
| `AZURE_CLIENT_SECRET` | `password` from `create-for-rbac` |
| `TRUSTED_SIGNING_ENDPOINT` | account Overview endpoint (e.g. `https://eus.codesigning.azure.net`) |
| `TRUSTED_SIGNING_ACCOUNT` | Trusted Signing account name |
| `TRUSTED_SIGNING_PROFILE` | certificate profile name |

> The workflow gates every sign step on `env.AZURE_CLIENT_ID != ''`. With these set
> it signs; with them unset it still builds (unsigned). Nothing else to toggle.

---

## C. Cut the signed release

```bash
git tag plugins-v0.1.0
git push origin plugins-v0.1.0
```

The push triggers the workflow on the tag: it builds, **signs** the AutoCAD
`.dll`/`.bundle`/`.msi` and the Visio `.exe`/`.dll`/`.msi`, packages the InDesign
`.ccx`, and the `release` job publishes them all to a **GitHub Release**
(`plugins-v0.1.0`) with auto-generated notes.

Verify a signature locally (PowerShell):

```powershell
Get-AuthenticodeSignature .\OdioImport.dll | Format-List Status, SignerCertificate
# Status should be 'Valid' and the cert subject should be your validated identity.
```

The website `/tools` page already points users to the Releases page for the
downloads.

---

## D. InDesign (Adobe, not Authenticode)

UXP plugins aren't Authenticode-signed; Adobe signs on its side.

- **Quick path (now):** ship the `opendeviceio.ccx` from the GitHub Release. Users
  double-click it and the Creative Cloud desktop app installs it. (Self-distributed
  `.ccx` may warn that it's from outside the Marketplace.)
- **Trusted one-click (recommended):** submit the plugin to **Adobe Exchange**
  (free developer account at <https://developer.adobe.com/console>, then the Exchange
  producer portal). Adobe reviews and **signs** it; users install from the
  Marketplace with no warning. This is the InDesign equivalent of code signing.

---

## Quick reference — what only you can do

1. Run the unsigned `workflow_dispatch` build; fix any compile errors (§A).
2. Create the Azure Trusted Signing account + identity validation + profile (§B1).
3. Create the CI service principal and grant the signer role (§B2).
4. Add the six GitHub secrets (§B3).
5. `git tag plugins-v0.1.0 && git push origin plugins-v0.1.0` for the signed release (§C).
6. Install + smoke-test each artifact in real AutoCAD / Visio / InDesign.
7. (InDesign) submit the `.ccx` to Adobe Exchange for trusted install (§D).
