import simSrc from './fluid.wgsl?raw'
import compSrc from './composite.wgsl?raw'
import type { Light, Palette, RGB } from '../palette'

// ── shared renderer contract (WebGPU fluid + Canvas2D fallback) ──────────────
export interface SplatIn {
  x: number // viewport uv, 0..1, y down
  y: number
  vx?: number // CSS px / s
  vy?: number
  radial?: number // outward speed, CSS px / s
  r: number // radius as a fraction of viewport height
  color: RGB
  amount: number // ink density added at the centre
}

/** a liquid-glass rounded rect, in CSS px (viewport space) */
export interface GlassShape {
  cx: number
  cy: number
  hw: number
  hh: number
  radius: number
  alpha: number
  bevel: number
  refract: number
}

export interface FrameInput {
  dt: number
  time: number
  pal: Palette
  light: Light
  shapes: GlassShape[]
  scrollDelta: number // CSS px scrolled since last frame
  scrollY: number
  reveal: number // headline write-on progress
  textRate: number
  calm: boolean // reduced motion
}

export interface Grid {
  vw: number
  vh: number
  dw: number
  dh: number
}

export interface Renderer {
  readonly kind: 'webgpu' | 'canvas2d'
  readonly canvas: HTMLCanvasElement
  readonly grid: Grid
  /** returns true when the simulation grid was (re)allocated */
  resize(w: number, h: number, dpr: number): boolean
  splat(s: SplatIn): void
  frame(f: FrameInput): void
  setMask(data: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): void
}

// ── WebGPU stable fluids ─────────────────────────────────────────────────────
const KERNELS = ['vforces', 'curl', 'vort', 'div', 'pdecay', 'jacobi', 'grad', 'vadvect', 'dadvect', 'dforces', 'shade'] as const
type Kernel = (typeof KERNELS)[number]
const USES_MASK: Kernel[] = ['vforces', 'dforces']

export const KERNEL_COUNT = KERNELS.length
const MAX_SPLATS = 32
const MAX_GLASS = 6
const SIM_FLOATS = 28 + MAX_SPLATS * 12 // 1648 bytes, see SimU in fluid.wgsl
const REN_FLOATS = 28 + MAX_GLASS * 8 // 304 bytes, see RU in composite.wgsl
const MAX_VEL_DIM = 480

function splitSource(src: string) {
  const parts = src.split(/^\/\/ @@(\w+).*$/m)
  const out: Record<string, string> = {}
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1]
  return out
}

async function compileLog(module: GPUShaderModule, label: string) {
  const errors: string[] = []
  try {
    const info = await module.getCompilationInfo()
    for (const m of info.messages) {
      const line = `[meridian] ${label}:${m.lineNum}:${m.linePos} ${m.type}: ${m.message}`
      if (m.type === 'error') {
        console.error(line)
        errors.push(line)
      } else console.warn(line)
    }
  } catch (err) {
    console.warn(`[meridian] getCompilationInfo unavailable for ${label}`, err)
  }
  return errors
}

interface Buffers {
  velA: GPUBuffer
  velB: GPUBuffer
  curl: GPUBuffer
  div: GPUBuffer
  pA: GPUBuffer
  pB: GPUBuffer
  dyeA: GPUBuffer
  dyeB: GPUBuffer
  disp: GPUBuffer
  mask: GPUTexture
}

export class Fluid implements Renderer {
  readonly kind = 'webgpu'
  readonly grid: Grid = { vw: 0, vh: 0, dw: 0, dh: 0 }
  private ctx: GPUCanvasContext
  private simU: GPUBuffer
  private renU: GPUBuffer
  private sim = new Float32Array(SIM_FLOATS)
  private ren = new Float32Array(REN_FLOATS)
  private pipes = {} as Record<Kernel, GPUComputePipeline>
  private renderPipe!: GPURenderPipeline
  private buf?: Buffers
  private groups = {} as Record<Kernel | 'jacobiB', GPUBindGroup>
  private renderGroup!: GPUBindGroup
  private queue: SplatIn[] = []
  private css = { w: 1, h: 1 }
  private dpr = 1

  static async create(device: GPUDevice, canvas: HTMLCanvasElement, format: GPUTextureFormat, jacobi: number) {
    const f = new Fluid(device, canvas, format, jacobi)
    await f.build(format)
    return f
  }

  private constructor(
    private device: GPUDevice,
    readonly canvas: HTMLCanvasElement,
    format: GPUTextureFormat,
    readonly jacobi: number,
  ) {
    const ctx = canvas.getContext('webgpu')
    if (!ctx) throw new Error('webgpu canvas context unavailable')
    this.ctx = ctx
    this.ctx.configure({ device, format, alphaMode: 'opaque' })
    this.simU = device.createBuffer({ label: 'simU', size: SIM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.renU = device.createBuffer({ label: 'renU', size: REN_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  }

  private async build(format: GPUTextureFormat) {
    const d = this.device
    const errors: string[] = []
    const parts = splitSource(simSrc)

    for (const k of KERNELS) {
      const code = parts.COMMON + (USES_MASK.includes(k) ? parts.MASK : '') + parts[k]
      const module = d.createShaderModule({ label: `fluid.${k}`, code })
      errors.push(...(await compileLog(module, `fluid.${k}`)))
      d.pushErrorScope('validation')
      this.pipes[k] = d.createComputePipeline({ label: `fluid.${k}`, layout: 'auto', compute: { module, entryPoint: `cs_${k}` } })
      const err = await d.popErrorScope()
      if (err) {
        console.error(`[meridian] pipeline fluid.${k}: ${err.message}`)
        errors.push(err.message)
      }
    }

    const module = d.createShaderModule({ label: 'composite', code: compSrc })
    errors.push(...(await compileLog(module, 'composite')))
    d.pushErrorScope('validation')
    this.renderPipe = d.createRenderPipeline({
      label: 'composite',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_full' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })
    const err = await d.popErrorScope()
    if (err) {
      console.error(`[meridian] pipeline composite: ${err.message}`)
      errors.push(err.message)
    }
    if (errors.length) throw new Error(`WGSL validation failed (${errors.length} error(s)) — see console`)
  }

  get bytes() {
    const V = this.grid.vw * this.grid.vh
    const D = this.grid.dw * this.grid.dh
    return V * (8 * 2 + 4 * 4) + D * (16 * 3 + 4)
  }

  resize(w: number, h: number, dpr: number) {
    this.css = { w: Math.max(1, w), h: Math.max(1, h) }
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.floor(w * dpr))
    this.canvas.height = Math.max(1, Math.floor(h * dpr))

    let vw = Math.round(w / 4)
    let vh = Math.round(h / 4)
    const big = Math.max(vw, vh)
    if (big > MAX_VEL_DIM) {
      vw = Math.round((vw * MAX_VEL_DIM) / big)
      vh = Math.round((vh * MAX_VEL_DIM) / big)
    }
    vw = Math.max(24, vw)
    vh = Math.max(24, vh)
    const g = this.grid
    // keep the sim through small height changes (mobile URL bar), realloc otherwise
    if (this.buf && vw === g.vw && Math.abs(vh - g.vh) / g.vh < 0.15) return false
    this.alloc(vw, vh)
    return true
  }

  private alloc(vw: number, vh: number) {
    const d = this.device
    if (this.buf) for (const b of Object.values(this.buf)) b.destroy()
    const dw = vw * 2
    const dh = vh * 2
    Object.assign(this.grid, { vw, vh, dw, dh })
    const V = vw * vh
    const D = dw * dh
    const mk = (size: number, label: string) => d.createBuffer({ label, size, usage: GPUBufferUsage.STORAGE })
    const b: Buffers = {
      velA: mk(V * 8, 'velA'),
      velB: mk(V * 8, 'velB'),
      curl: mk(V * 4, 'curl'),
      div: mk(V * 4, 'div'),
      pA: mk(V * 4, 'pA'),
      pB: mk(V * 4, 'pB'),
      dyeA: mk(D * 16, 'dyeA'),
      dyeB: mk(D * 16, 'dyeB'),
      disp: mk(D * 16, 'disp'),
      mask: d.createTexture({
        label: 'headline-mask',
        size: [dw, dh],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      }),
    }
    this.buf = b
    const maskView = b.mask.createView()
    const B = (x: GPUBuffer): GPUBindingResource => ({ buffer: x })
    const group = (k: Kernel, res: GPUBindingResource[]) =>
      d.createBindGroup({
        label: `fluid.${k}`,
        layout: this.pipes[k].getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.simU } }, ...res.map((resource, i) => ({ binding: i + 1, resource }))],
      })

    d.pushErrorScope('validation')
    this.groups = {
      vforces: group('vforces', [B(b.velB), B(b.velA), maskView]),
      curl: group('curl', [B(b.velA), B(b.curl)]),
      vort: group('vort', [B(b.velA), B(b.curl), B(b.velB)]),
      div: group('div', [B(b.velB), B(b.div)]),
      pdecay: group('pdecay', [B(b.pA)]),
      jacobi: group('jacobi', [B(b.pA), B(b.div), B(b.pB)]),
      jacobiB: group('jacobi', [B(b.pB), B(b.div), B(b.pA)]),
      grad: group('grad', [B(b.velB), B(b.pA), B(b.velA)]),
      vadvect: group('vadvect', [B(b.velA), B(b.velB)]),
      dadvect: group('dadvect', [B(b.dyeA), B(b.velB), B(b.dyeB)]),
      dforces: group('dforces', [B(b.dyeB), B(b.dyeA), maskView]),
      shade: group('shade', [B(b.dyeA), B(b.disp)]),
    }
    this.renderGroup = d.createBindGroup({
      label: 'composite',
      layout: this.renderPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renU } },
        { binding: 1, resource: { buffer: b.disp } },
      ],
    })
    d.popErrorScope().then((e) => e && console.error(`[meridian] bind groups: ${e.message}`))
  }

  setMask(data: Uint8ClampedArray<ArrayBuffer>, w: number, h: number) {
    if (!this.buf || w !== this.grid.dw || h !== this.grid.dh) return
    this.device.queue.writeTexture({ texture: this.buf.mask }, data, { bytesPerRow: w * 4, rowsPerImage: h }, [w, h])
  }

  splat(s: SplatIn) {
    if (this.queue.length < 128) this.queue.push(s)
  }

  frame(f: FrameInput) {
    if (!this.buf) return
    const { vw, vh, dw, dh } = this.grid
    const s = this.sim
    const dt = Math.min(Math.max(f.dt, 1 / 240), 1 / 30)
    const cellsPerPx = vw / this.css.w

    // ── SimU (offsets in floats; bytes = ×4) ──
    s[0] = vw
    s[1] = vh
    s[2] = dw
    s[3] = dh
    s[4] = dt
    s[5] = f.time
    s[6] = f.calm ? 10 : 26 // curl
    s[7] = 0.3 // velocity dissipation
    s[8] = 0.55 // dye dissipation
    const batch = this.queue.splice(0, MAX_SPLATS)
    s[9] = batch.length
    s[10] = f.textRate
    s[11] = f.reveal
    s.set(f.pal.text, 12)
    s[15] = 2.2 // headline target density
    s[16] = 0
    s[17] = f.scrollDelta / this.css.h // 64: shift (uv)
    s[18] = 0
    s[19] = Math.round((f.scrollY * dh) / this.css.h) // 72: mask offset (dye cells)
    s.set(f.pal.inks[0], 20)
    s[23] = 0.16 // 80: inkTint
    s[24] = f.light.x
    s[25] = f.light.y
    s[26] = f.light.i
    s[27] = f.pal.night // 96: light
    for (let k = 0; k < batch.length; k++) {
      const p = batch[k]
      const o = 28 + k * 12 // 112 + k·48
      s[o + 0] = p.x
      s[o + 1] = p.y
      const radial = p.radial ?? 0
      s[o + 2] = radial ? radial * cellsPerPx : (p.vx ?? 0) * cellsPerPx
      s[o + 3] = radial ? 0 : (p.vy ?? 0) * cellsPerPx
      s[o + 4] = p.color[0]
      s[o + 5] = p.color[1]
      s[o + 6] = p.color[2]
      s[o + 7] = p.amount
      s[o + 8] = p.r
      s[o + 9] = radial ? 1 : 0
      s[o + 10] = 0
      s[o + 11] = 0
    }
    this.device.queue.writeBuffer(this.simU, 0, s)

    // ── RU ──
    const r = this.ren
    const dpr = this.dpr
    r[0] = this.canvas.width
    r[1] = this.canvas.height
    r[2] = dw
    r[3] = dh
    r[4] = f.time
    r[5] = dpr
    const shapes = f.shapes.slice(0, MAX_GLASS)
    r[6] = shapes.length
    r[7] = f.pal.grain
    r.set(f.pal.bg, 8)
    r[11] = 1
    r.set(f.pal.bg2, 12)
    r[15] = 1
    r[16] = f.light.x
    r[17] = f.light.y
    r[18] = f.light.i
    r[19] = f.pal.night
    r.set(f.pal.glass, 20)
    r[23] = f.pal.glassAmt
    r.set(f.pal.sun, 24)
    r[27] = 1
    for (let i = 0; i < shapes.length; i++) {
      const g = shapes[i]
      const o = 28 + i * 8 // 112 + i·32
      r[o + 0] = g.cx * dpr
      r[o + 1] = g.cy * dpr
      r[o + 2] = g.hw * dpr
      r[o + 3] = g.hh * dpr
      r[o + 4] = g.radius * dpr
      r[o + 5] = g.alpha
      r[o + 6] = g.bevel * dpr
      r[o + 7] = g.refract * dpr
    }
    this.device.queue.writeBuffer(this.renU, 0, r)

    // ── encode ──
    const enc = this.device.createCommandEncoder({ label: 'meridian.frame' })
    const cp = enc.beginComputePass({ label: 'fluid' })
    const gv = [Math.ceil(vw / 8), Math.ceil(vh / 8)] as const
    const gd = [Math.ceil(dw / 8), Math.ceil(dh / 8)] as const
    const run = (k: Kernel, group: GPUBindGroup, g: readonly [number, number]) => {
      cp.setPipeline(this.pipes[k])
      cp.setBindGroup(0, group)
      cp.dispatchWorkgroups(g[0], g[1])
    }
    const G = this.groups
    run('vforces', G.vforces, gv) // velB → velA (+splats)
    run('curl', G.curl, gv) // velA → curl
    run('vort', G.vort, gv) // velA, curl → velB
    run('div', G.div, gv) // velB → div
    run('pdecay', G.pdecay, gv) // pA *= 0.8
    for (let i = 0; i < this.jacobi; i++) run('jacobi', i % 2 === 0 ? G.jacobi : G.jacobiB, gv) // even count → ends in pA
    run('grad', G.grad, gv) // velB − ∇pA → velA
    run('vadvect', G.vadvect, gv) // velA → velB
    run('dadvect', G.dadvect, gd) // dyeA by velB → dyeB
    run('dforces', G.dforces, gd) // dyeB → dyeA (+splats, headline)
    run('shade', G.shade, gd) // dyeA → disp
    cp.end()

    const rp = enc.beginRenderPass({
      label: 'composite',
      colorAttachments: [
        { view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
      ],
    })
    rp.setPipeline(this.renderPipe)
    rp.setBindGroup(0, this.renderGroup)
    rp.draw(3)
    rp.end()
    this.device.queue.submit([enc.finish()])
  }
}
