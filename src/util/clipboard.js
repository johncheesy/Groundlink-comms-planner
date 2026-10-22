/**
 * Copy text to the clipboard. Resolves true when it worked, false when the
 * API is missing or permission was denied — never rejects (review F23), so
 * callers only say "Copied" when it really was.
 */
export async function copyText(text) {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    return false;
  }
}
