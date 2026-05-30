import Link from "next/link";

export default function RegistryNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">
        404
      </p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
        Entry not found
      </h1>
      <p className="mt-3 text-slate-600">
        No registry entry matches that id. It may not be published yet, or the id
        may be mistyped.
      </p>
      <Link
        href="/registry"
        className="mt-6 inline-block rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white transition hover:bg-brand-700"
      >
        Back to the registry
      </Link>
    </div>
  );
}
