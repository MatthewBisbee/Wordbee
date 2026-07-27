import { useEffect, useRef } from 'react'

// Auto-refresh the client when a new build is deployed.
//
// Vite fingerprints the entry bundle, so the module `script` src (and stylesheet
// href) in index.html change on every deploy whose output differs. We snapshot
// that signature from the loaded document, then re-check the server's current
// index.html on a slow interval and whenever the app comes back into view. If
// the signature changed, a newer version is live and we reload once — so pushing
// an update is itself the trigger, with no manual refresh.
//
// Two rules keep that from interrupting play:
//
//  - Only a hidden→visible transition reloads. A plain window `focus` (clicking
//    back into an already-visible tab) never does, and neither does the interval
//    on its own — it just arms the reload for the next time the app is
//    backgrounded and reopened, when nothing is mid-keystroke.
//  - Only fingerprinted same-origin /assets/ URLs count toward the signature, so
//    a stylesheet injected by a browser extension (or anything else rewriting
//    the live DOM) cannot masquerade as a new deploy and reload on every return.
//
// In dev the entry is /src/main.tsx (unhashed), so the signature never changes
// and this stays inert; Vite HMR handles dev updates instead.

const CHECK_INTERVAL_MS = 10 * 60 * 1000
const BUILD_ASSET_PATTERN = /^\/assets\//

function readEntrySignature(doc: Document): string {
  const scripts = Array.from(doc.querySelectorAll('script[type="module"][src]')).map(
    (element) => element.getAttribute('src') ?? '',
  )
  const styles = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]')).map(
    (element) => element.getAttribute('href') ?? '',
  )
  // Sorted so a difference in tag order is not mistaken for a new build.
  return [...scripts, ...styles]
    .filter((path) => BUILD_ASSET_PATTERN.test(path))
    .sort()
    .join('|')
}

export function useDeployRefresh() {
  const currentSignatureRef = useRef('')
  const updatePendingRef = useRef(false)
  const reloadingRef = useRef(false)
  const inFlightRef = useRef(false)

  useEffect(() => {
    // Only meaningful for a fingerprinted production build; dev uses Vite HMR.
    if (!import.meta.env.PROD) return
    currentSignatureRef.current = readEntrySignature(document)
    // No fingerprinted entry to compare against → stay inert.
    if (!currentSignatureRef.current) return
    let cancelled = false

    // Resolves to true once a different build is live on the server.
    const checkForUpdate = async () => {
      if (updatePendingRef.current) return true
      if (reloadingRef.current || inFlightRef.current) return false
      inFlightRef.current = true
      try {
        const response = await fetch(`/index.html?_=${Date.now()}`, { cache: 'no-store' })
        if (!response.ok) return false
        const html = await response.text()
        const latest = readEntrySignature(new DOMParser().parseFromString(html, 'text/html'))
        // An empty signature means the response was not our app shell (a captive
        // portal, an error page, a proxy rewriting the markup) — never reload on it.
        if (cancelled || !latest || latest === currentSignatureRef.current) return false
        updatePendingRef.current = true
        return true
      } catch {
        // Offline or index.html unreachable — just try again on the next trigger.
        return false
      } finally {
        inFlightRef.current = false
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      void checkForUpdate().then((hasUpdate) => {
        if (!hasUpdate || cancelled || reloadingRef.current) return
        // Safe to reload here: the app was backgrounded, so the player is not
        // part-way through a guess or a Strands drag.
        reloadingRef.current = true
        window.location.reload()
      })
    }

    // The interval only arms the reload; it never interrupts an active session.
    const interval = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])
}
