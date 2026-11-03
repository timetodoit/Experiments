// Kinetic editorial type: split headings into per-character spans (words are
// kept unbreakable) so CSS can stagger them in; scroll progress is exposed to
// CSS as --p on each section.

export function splitChars(root: HTMLElement) {
  const label = root.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  let i = 0
  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment()
        for (const part of (child.textContent ?? '').split(/(\s+)/)) {
          if (!part) continue
          if (/^\s+$/.test(part)) {
            frag.append(document.createTextNode(' '))
            continue
          }
          const w = document.createElement('span')
          w.className = 'w'
          for (const ch of part) {
            const s = document.createElement('span')
            s.className = 'ch'
            s.textContent = ch
            s.style.setProperty('--i', String(i++))
            w.append(s)
          }
          frag.append(w)
        }
        child.replaceWith(frag)
      } else if (child.nodeType === Node.ELEMENT_NODE) walk(child)
    }
  }
  walk(root)
  root.setAttribute('aria-label', label)
  for (const s of root.querySelectorAll('.w')) s.setAttribute('aria-hidden', 'true')
}

export function scrollProgress(sections: HTMLElement[], vh: number) {
  for (const s of sections) {
    const r = s.getBoundingClientRect()
    if (r.bottom < -vh || r.top > vh * 2) continue
    const p = (r.top + r.height / 2 - vh / 2) / vh
    s.style.setProperty('--p', p.toFixed(4))
  }
}
