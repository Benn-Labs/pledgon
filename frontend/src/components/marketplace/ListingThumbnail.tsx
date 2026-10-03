"use client";

import { useState } from "react";

/**
 * A listing's thumbnail with a graceful fallback: the seller-supplied URL when
 * it exists and actually loads, otherwise a neutral placeholder — so a card or
 * header never collapses, or shows the browser's broken-image glyph, when a
 * URL is missing, unreachable or blocked. Keyed on the URL by the caller so a
 * changed URL gets a fresh chance to load.
 */
export function ListingThumbnail({ url, className = "" }: { url?: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  const showImage = Boolean(url) && failedUrl !== url;

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-provided URL
      <img
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`object-cover bg-ink-800 ${className}`}
        onError={() => setFailedUrl(url)}
      />
    );
  }
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-ink-800 to-ink-900 ${className}`}>
      <svg className="h-8 w-8 text-ink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 10h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    </div>
  );
}
