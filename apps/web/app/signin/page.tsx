import type { Metadata } from "next";
import { SignInForm } from "./SignInForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to OpenDeviceIO with a magic link to request manufacturer access and publish verified .odio files for your brand."
};

export default function SignInPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
        Sign in
      </h1>
      <p className="mt-3 text-slate-600">
        Enter your work email and we&apos;ll send you a one-time magic link. No
        password required. Manufacturer reps use this to request access and
        publish verified device files for their brand.
      </p>
      <div className="mt-8">
        <SignInForm />
      </div>
    </div>
  );
}
