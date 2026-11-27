import Link from "next/link";
import { DATA_LICENSE, DATA_TERMS_PATH } from "@/lib/data-license";

/**
 * Shown wherever a manufacturer can publish to the registry. Published records
 * are redistributed to downstream integrations under the registry data
 * license, so publishers need to know that (and have the right to grant it)
 * before they publish.
 */
export function PublishLicenseNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-slate-500 ${className}`}>
      By publishing, you confirm you are authorized to publish this data for
      the brand, and you make the published record available under{" "}
      <Link href={DATA_TERMS_PATH} className="underline">
        {DATA_LICENSE.short}
      </Link>{" "}
      as described in the registry data license. Design and catalog software
      vendors may store and display it with attribution. Don&apos;t include
      product images or content you don&apos;t have the rights to.
    </p>
  );
}
