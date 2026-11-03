const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%/<>*+='
const running = new WeakMap<HTMLElement, number>()

/** Decode-style text swap: characters resolve left to right out of noise. */
export function scramble(el: HTMLElement, text: string, duration = 520) {
  cancelAnimationFrame(running.get(el) ?? 0)
  const from = el.textContent ?? ''
  const len = Math.max(from.length, text.length)
  const t0 = performance.now()
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / duration)
    let out = ''
    for (let i = 0; i < len; i++) {
      const reveal = i / len < p
      const ch = text[i] ?? ''
      if (reveal) out += ch
      else if (ch === ' ') out += ' '
      else if (i < text.length || Math.random() > p) out += GLYPHS[(Math.random() * GLYPHS.length) | 0]
    }
    el.textContent = out
    if (p < 1) running.set(el, requestAnimationFrame(tick))
    else el.textContent = text
  }
  running.set(el, requestAnimationFrame(tick))
}
