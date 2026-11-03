import src from './soft.wgsl?raw'
import { INK, type Frame, type Look, type Renderer } from '../types'

const SAMPLES = 4

type BufKey = 'pts' | 'bodies' | 'fill' | 'strip'

/**
 * WebGPU renderer for the Rust soft bodies. One instance per canvas.
 * Rust writes particles + per-body data each frame; we upload them as storage
 * buffers and re-upload the index buffers only when the topology generation changes.
 */
export class SoftGPU implements Renderer {
  readonly kind = 'webgpu' as const
  private ctx: GPUCanvasContext
  private uniforms: GPUBuffer
  private bufs: Record<BufKey, GPUBuffer>
  private caps: Record<BufKey, number> = { pts: 0, bodies: 0, fill: 0, strip: 0 }
  private bgl: GPUBindGroupLayout
  private group!: GPUBindGroup
  private pipes: Record<'shadowFill' | 'shadowRim' | 'outline' | 'fill' | 'rim', GPURenderPipeline>
  private msaa?: GPUTexture
  private data = new Float32Array(16)
  private gen = -1
  private dirtyGroup = true
  private cleared = false

  /** Compiles and validates the shader; throws so the caller can fall back to Canvas2D. */
  static async create(device: GPUDevice, canvas: HTMLCanvasElement, format: GPUTextureFormat): Promise<SoftGPU> {
    device.pushErrorScope('validation')
    const module = device.createShaderModule({ label: 'soft.wgsl', code: src })
    const info = await module.getCompilationInfo()
    let failed = false
    for (const m of info.messages) {
      const line = `soft.wgsl:${m.lineNum}:${m.linePos} ${m.type}: ${m.message}`
      if (m.type === 'error') {
        failed = true
        console.error(line)
      } else console.warn(line)
    }
    let r: SoftGPU | null = null
    let ctorErr: unknown = null
    if (!failed) {
      try {
        r = new SoftGPU(device, canvas, format, module)
      } catch (e) {
        ctorErr = e
      }
    }
    const err = await device.popErrorScope()
    if (err) console.error('WebGPU validation:', err.message)
    if (failed || err || ctorErr || !r) throw ctorErr ?? new Error(err?.message ?? 'soft.wgsl failed to compile')
    return r
  }

  private constructor(
    private device: GPUDevice,
    readonly canvas: HTMLCanvasElement,
    private format: GPUTextureFormat,
    module: GPUShaderModule,
  ) {
    const ctx = canvas.getContext('webgpu')
    if (!ctx) throw new Error('webgpu context unavailable')
    this.ctx = ctx
    this.ctx.configure({ device, format, alphaMode: 'premultiplied' })
    this.uniforms = device.createBuffer({ label: 'soft.uniforms', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.bufs = {
      pts: this.makeBuf('pts', 64 * 1024),
      bodies: this.makeBuf('bodies', 8 * 1024),
      fill: this.makeBuf('fill', 64 * 1024),
      strip: this.makeBuf('strip', 128 * 1024),
    }

    this.bgl = device.createBindGroupLayout({
      label: 'soft.bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    })
    const layout = device.createPipelineLayout({ label: 'soft.layout', bindGroupLayouts: [this.bgl] })

    const over: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    }
    // shadows use MAX so overlapping letters don't double-darken the paper
    const max: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
    }
    const pipe = (label: string, vs: string, fs: string, blend: GPUBlendState) =>
      device.createRenderPipeline({
        label: `soft.${label}`,
        layout,
        vertex: { module, entryPoint: vs },
        fragment: { module, entryPoint: fs, targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        multisample: { count: SAMPLES },
      })
    this.pipes = {
      shadowFill: pipe('shadowFill', 'vs_shadow_fill', 'fs_shadow', max),
      shadowRim: pipe('shadowRim', 'vs_shadow_rim', 'fs_shadow', max),
      outline: pipe('outline', 'vs_outline', 'fs_outline', over),
      fill: pipe('fill', 'vs_fill', 'fs_fill', over),
      rim: pipe('rim', 'vs_rim', 'fs_rim', over),
    }
  }

  private makeBuf(key: BufKey, bytes: number) {
    const usage =
      key === 'fill' || key === 'strip'
        ? GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
        : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    this.caps[key] = bytes
    return this.device.createBuffer({ label: `soft.${key}`, size: bytes, usage })
  }

  /** Grow a buffer (power-of-two-ish) when the world outgrows it. */
  private ensure(key: BufKey, bytes: number) {
    if (bytes <= this.caps[key]) return false
    let cap = this.caps[key]
    while (cap < bytes) cap *= 2
    this.bufs[key].destroy()
    this.bufs[key] = this.makeBuf(key, cap)
    if (key === 'pts' || key === 'bodies') this.dirtyGroup = true
    return true
  }

  resize(w: number, h: number, dpr: number) {
    const pw = Math.max(1, Math.floor(w * dpr))
    const ph = Math.max(1, Math.floor(h * dpr))
    this.canvas.width = pw
    this.canvas.height = ph
    this.msaa?.destroy()
    this.msaa = this.device.createTexture({
      size: [pw, ph],
      format: this.format,
      sampleCount: SAMPLES,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.data[0] = w
    this.data[1] = h
    this.data[3] = dpr
    this.cleared = false
  }

  draw(f: Frame, look: Look, time: number) {
    if (!this.msaa) return
    const { device } = this
    const empty = f.nPts === 0 || f.nBodies === 0
    if (empty && this.cleared) return
    this.cleared = empty

    if (!empty) {
      this.ensure('pts', f.pts.byteLength)
      this.ensure('bodies', f.bodies.byteLength)
      const grewF = this.ensure('fill', Math.max(4, f.fill.byteLength))
      const grewS = this.ensure('strip', Math.max(4, f.strip.byteLength))
      if (this.dirtyGroup) {
        this.group = device.createBindGroup({
          label: 'soft.group',
          layout: this.bgl,
          entries: [
            { binding: 0, resource: { buffer: this.uniforms } },
            { binding: 1, resource: { buffer: this.bufs.pts } },
            { binding: 2, resource: { buffer: this.bufs.bodies } },
          ],
        })
        this.dirtyGroup = false
      }
      const q = device.queue
      q.writeBuffer(this.bufs.pts, 0, f.pts.buffer, f.pts.byteOffset, f.pts.byteLength)
      q.writeBuffer(this.bufs.bodies, 0, f.bodies.buffer, f.bodies.byteOffset, f.bodies.byteLength)
      if (f.generation !== this.gen || grewF || grewS) {
        if (f.fill.byteLength) q.writeBuffer(this.bufs.fill, 0, f.fill.buffer, f.fill.byteOffset, f.fill.byteLength)
        if (f.strip.byteLength) q.writeBuffer(this.bufs.strip, 0, f.strip.buffer, f.strip.byteOffset, f.strip.byteLength)
        this.gen = f.generation
      }
      const d = this.data
      d[2] = time
      d.set([look.outline, look.rim, look.feather, look.shadowAlpha], 4)
      d.set([look.shadowX, look.shadowY, look.halftone, 1.6], 8)
      d.set([INK[0], INK[1], INK[2], 1], 12)
      q.writeBuffer(this.uniforms, 0, d)
    }

    const enc = device.createCommandEncoder({ label: 'soft.frame' })
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.msaa.createView(),
          resolveTarget: this.ctx.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'discard',
          clearValue: [0, 0, 0, 0],
        },
      ],
    })
    if (!empty) {
      const nf = f.fill.length
      const ns = f.strip.length
      pass.setBindGroup(0, this.group)
      if (nf) {
        pass.setIndexBuffer(this.bufs.fill, 'uint32')
        pass.setPipeline(this.pipes.shadowFill)
        pass.drawIndexed(nf)
      }
      if (ns) {
        pass.setIndexBuffer(this.bufs.strip, 'uint32')
        pass.setPipeline(this.pipes.shadowRim)
        pass.drawIndexed(ns)
        pass.setPipeline(this.pipes.outline)
        pass.drawIndexed(ns)
      }
      if (nf) {
        pass.setIndexBuffer(this.bufs.fill, 'uint32')
        pass.setPipeline(this.pipes.fill)
        pass.drawIndexed(nf)
      }
      if (ns) {
        pass.setIndexBuffer(this.bufs.strip, 'uint32')
        pass.setPipeline(this.pipes.rim)
        pass.drawIndexed(ns)
      }
    }
    pass.end()
    device.queue.submit([enc.finish()])
  }
}
