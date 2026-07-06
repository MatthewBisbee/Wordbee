export function createRandomId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createGameId(date: string) {
  return `${date}-${createRandomId()}`
}
