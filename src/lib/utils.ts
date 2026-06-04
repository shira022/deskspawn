import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import i18n from "@/lib/i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convert a sidecar HTTP error response into a localized error message.
 * - If the response includes a recognized `errorCode`, looks up the translation.
 * - Falls back to the raw `error` field or a generic fallback string.
 */
export function parseSidecarError(data: { error?: string; errorCode?: string }): string {
  const errorCode = data.errorCode;
  if (errorCode) {
    const key = `sidecarError.${errorCode}`;
    if (i18n.exists(key)) {
      return i18n.t(key);
    }
  }
  return data.error || i18n.t('common.errorOccurred');
}
