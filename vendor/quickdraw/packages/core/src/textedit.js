// The text surface: what you type into on the board. A contenteditable
// that shows the text as it will be drawn — bold, italic, underline,
// strike, code, highlight and links styled live — while the document keeps
// its plain text plus marks. The DOM is rendered from that model and read
// back after every edit, so whatever markup the browser invents (divs on
// Enter, spans, pasted HTML) is normalized straight away.
//
// It wears a textarea's coat — value, selectionStart/End, setSelectionRange,
// focus, select, style, addEventListener — so the editor (and its tests)
// drive it the same way. Dependency-free ESM.

import { runsIn, normalizeMarks, mapMarks } from './shapes.js'
import { FONTS } from './palette.js'

const STYLE_OF = (st, hlColor) => {
  const s = []
  if (st.b) s.push('font-weight:700')
  if (st.i) s.push('font-style:italic')
  const deco = [st.u || st.href ? 'underline' : '', st.s ? 'line-through' : ''].filter(Boolean).join(' ')
  if (deco) s.push(`text-decoration:${deco}`)
  if (st.code) s.push(`font-family:${FONTS.mono}`)
  if (st.hl) s.push(`background:${hlColor}`)
  return s.join(';')
}
// the style an element (ours, or one the browser or a paste produced) implies
const styleOfNode = (el, acc) => {
  const st = { ...acc }
  if (el.dataset?.mk) Object.assign(st, JSON.parse(el.dataset.mk))
  const tag = el.tagName
  if (tag === 'B' || tag === 'STRONG') st.b = true
  if (tag === 'I' || tag === 'EM') st.i = true
  if (tag === 'U') st.u = true
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') st.s = true
  if (tag === 'CODE') st.code = true
  if (tag === 'MARK') st.hl = true
  if (tag === 'A' && el.getAttribute('href')) st.href = el.getAttribute('href')
  const cs = el.style
  if (cs) {
    if (cs.fontWeight === '700' || cs.fontWeight === 'bold') st.b = true
    if (cs.fontStyle === 'italic') st.i = true
  }
  return st
}
const BLOCK = new Set(['DIV', 'P', 'LI', 'BR'])

export class TextSurface {
  constructor({ hlColor = '#fbe5c0' } = {}) {
    const el = document.createElement('div')
    el.className = 'qd-text-edit'
    el.contentEditable = 'true'
    el.spellcheck = false
    el.setAttribute('role', 'textbox')
    el.setAttribute('aria-multiline', 'true')
    this.el = el
    this.hlColor = hlColor
    this._text = ''
    this._marks = []
    this._composing = false
    this._undo = []
    this._redo = []
    // keys the surface owns: Enter (a newline, not a div), undo/redo (the
    // browser's would fight the re-render), paste (plain text, at the caret)
    el.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey
      if (e.key === 'Enter' && !meta) { e.preventDefault(); this.insertText('\n'); return }
      if (meta && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? this._redoStep() : this._undoStep()
      }
    })
    el.addEventListener('paste', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const t = e.clipboardData?.getData('text/plain') || ''
      if (t) this.insertText(t.replace(/\r\n?/g, '\n'))
    })
    el.addEventListener('compositionstart', () => { this._composing = true })
    el.addEventListener('compositionend', () => { this._composing = false; this._afterInput() })
    // the browser edited the DOM: read it back, normalize, tell the editor
    el.addEventListener('input', () => { if (!this._composing) this._afterInput() })
  }

  // ---- the model ------------------------------------------------------------
  get value() { return this._text }
  // setting the text is an edit: the marks follow it as they would typing
  set value(t) { const s = String(t ?? ''); this.render(s, mapMarks(this._marks, this._text, s) || []) }
  get marks() { return this._marks }
  // text and marks read from the DOM, as it is right now
  read() {
    let text = ''
    const marks = []
    const walk = (node, st, first) => {
      if (node.nodeType === 3) {
        const from = text.length
        text += node.nodeValue
        // the run's style, then its place: a stale from/to riding in the style must not win
        if (Object.keys(st).length && node.nodeValue.length) marks.push({ ...st, from, to: text.length })
        return
      }
      if (node.nodeType !== 1) return
      if (node.tagName === 'BR') {
        // the trailing <br> is the caret's landing pad, not a newline; any
        // other one (the browser's) is a line break
        if (node !== this.el.lastChild) text += '\n'
        return
      }
      const block = BLOCK.has(node.tagName) && node !== this.el
      if (block && text.length && !text.endsWith('\n') && !first) text += '\n'
      const st2 = styleOfNode(node, st)
      node.childNodes.forEach((c, i) => walk(c, st2, i === 0))
    }
    this.el.childNodes.forEach((c, i) => walk(c, {}, i === 0))
    return { text, marks: normalizeMarks(marks) }
  }
  // draw the model into the DOM, keeping the selection where it was
  render(text, marks, sel) {
    const keep = sel || this.selection()
    this._text = String(text ?? '')
    this._marks = normalizeMarks(marks)
    const frag = document.createDocumentFragment()
    for (const [s, e, st] of runsIn(this._marks, 0, this._text.length)) {
      const str = this._text.slice(s, e)
      if (!Object.keys(st).length) { frag.appendChild(document.createTextNode(str)); continue }
      const span = document.createElement('span')
      const { from: _f, to: _t, ...style } = st // the style alone: its place is where it sits in the DOM
      span.dataset.mk = JSON.stringify(style)
      span.setAttribute('style', STYLE_OF(st, this.hlColor))
      span.textContent = str
      frag.appendChild(span)
    }
    // a final <br> gives an empty last line (or an empty box) a place for the caret
    frag.appendChild(document.createElement('br'))
    this.el.replaceChildren(frag)
    if (keep) this.setSelectionRange(keep[0], keep[1])
  }

  // ---- selection, as text offsets ------------------------------------------------
  selection() {
    const sel = this.el.ownerDocument.getSelection?.()
    if (!sel || !sel.rangeCount || !this.el.contains(sel.anchorNode)) return this._lastSel || [this._text.length, this._text.length]
    const r = sel.getRangeAt(0)
    const off = (node, o) => {
      const pre = r.cloneRange()
      pre.selectNodeContents(this.el)
      pre.setEnd(node, o)
      return pre.toString().length
    }
    const a = off(r.startContainer, r.startOffset), b = off(r.endContainer, r.endOffset)
    return (this._lastSel = [Math.min(a, b), Math.max(a, b)])
  }
  get selectionStart() { return this.selection()[0] }
  get selectionEnd() { return this.selection()[1] }
  setSelectionRange(s, e = s) {
    const doc = this.el.ownerDocument
    const sel = doc.getSelection?.()
    if (!sel) { this._lastSel = [s, e]; return }
    const find = (pos) => {
      let n = 0
      const walker = doc.createTreeWalker(this.el, 4) // text nodes
      let node = walker.nextNode(), last = null
      while (node) {
        const len = node.nodeValue.length
        if (pos <= n + len) return [node, pos - n]
        n += len
        last = node
        node = walker.nextNode()
      }
      return last ? [last, last.nodeValue.length] : [this.el, 0]
    }
    const len = this._text.length
    const [an, ao] = find(Math.max(0, Math.min(s, len)))
    const [bn, bo] = find(Math.max(0, Math.min(e, len)))
    const r = doc.createRange()
    try {
      r.setStart(an, ao)
      r.setEnd(bn, bo)
      sel.removeAllRanges()
      sel.addRange(r)
    } catch {}
    this._lastSel = [s, e]
  }
  select() { this.setSelectionRange(0, this._text.length) }
  focus() { this.el.focus({ preventScroll: true }) }
  remove() { this.el.remove() }

  // ---- edits the surface makes itself ----------------------------------------
  // replace the selection with text (typed newline, paste): the marks around
  // the spot carry on into it, like typing there would
  insertText(t) {
    const [s, e] = this.selection()
    this._pushUndo()
    const before = this._text.slice(0, s), after = this._text.slice(e)
    const shifted = this._marks
      .map((m) => ({ ...m, from: m.from < s ? m.from : m.from >= e ? m.from - (e - s) + t.length : s, to: m.to <= s ? m.to : m.to >= e ? m.to - (e - s) + t.length : s }))
      .filter((m) => m.to > m.from)
    this.render(before + t + after, shifted, [s + t.length, s + t.length])
    this._fire()
  }
  _afterInput() {
    const { text, marks: read } = this.read()
    const sel = this.selection()
    this._pushUndo()
    // Typed text takes the style of what came before it: the model's rule
    // (a run extends when you type at its end). The browser may have put the
    // new characters just outside the run's span, which would read as plain;
    // when it styled them itself (a rich paste, its own bold), that stands.
    let marks = read
    if (text.length > this._text.length) {
      let a = 0
      while (a < this._text.length && a < text.length && this._text[a] === text[a]) a++
      const b = a + (text.length - this._text.length)
      const styledInside = read.some((m) => m.from < b && m.to > a)
      if (!styledInside) marks = mapMarks(this._marks, this._text, text) || []
    }
    this.render(text, marks, sel)
    this._fire()
  }
  // 'qdinput': the model changed (typing, a newline, a paste, undo) — what
  // the editor listens for; the browser's own 'input' is only the trigger
  _fire() { this.el.dispatchEvent(new Event('qdinput', { bubbles: false })) }
  _pushUndo() {
    this._undo.push({ text: this._text, marks: this._marks, sel: this._lastSel || [0, 0] })
    if (this._undo.length > 200) this._undo.shift()
    this._redo.length = 0
  }
  _undoStep() {
    const s = this._undo.pop()
    if (!s) return
    this._redo.push({ text: this._text, marks: this._marks, sel: this.selection() })
    this.render(s.text, s.marks, s.sel)
    this._fire()
  }
  _redoStep() {
    const s = this._redo.pop()
    if (!s) return
    this._undo.push({ text: this._text, marks: this._marks, sel: this.selection() })
    this.render(s.text, s.marks, s.sel)
    this._fire()
  }

  // ---- the textarea coat ---------------------------------------------------------
  get style() { return this.el.style }
  set spellcheck(v) { this.el.spellcheck = v }
  addEventListener(...a) { this.el.addEventListener(...a) }
  removeEventListener(...a) { this.el.removeEventListener(...a) }
  dispatchEvent(e) { return this.el.dispatchEvent(e) }
  getBoundingClientRect() { return this.el.getBoundingClientRect() }
  contains(n) { return this.el.contains(n) }
}
