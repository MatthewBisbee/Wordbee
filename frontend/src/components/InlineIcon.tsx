export function InlineIcon({ markup }: { markup: string }) {
  return (
    <span
      className="wordbee-inline-icon"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}

export function BackspaceIcon() {
  return (
    <svg aria-hidden="true" className="wordbee-backspace-icon" viewBox="0 0 24 24">
      <path d="M22 3H7c-.7 0-1.2.35-1.6.88L0 12l5.4 8.11c.4.54.9.89 1.6.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Zm0 16H7.1L2.4 12l4.7-7H22v14Zm-11.6-2 3.6-3.6 3.6 3.6 1.4-1.4-3.6-3.6L19 8.4 17.6 7 14 10.6 10.4 7 9 8.4l3.6 3.6L9 15.6l1.4 1.4Z" />
    </svg>
  )
}
