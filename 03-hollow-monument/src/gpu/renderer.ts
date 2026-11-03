import cloudSrc from './cloud.wgsl?raw'
import postSrc from './post.wgsl?raw'
import type { FrameState, PointRenderer } from '../frame'

const [COMMON, REST] = cloudSrc.split('// @@COMPUTE')
const [COMPUTE, RENDER] = REST.split('// @@RENDER')

const HDR: GPUTextureFormat = 'rgba16float'
const STATE_FLOATS = 12 // S { pos, vel, nrm } — 48 bytes
const TARGET_FLOATS = 8 // T { p, n } — 32 bytes

/** Compile a module and surface every message; throws on errors. */
async function compile(device: GPUDevice, label: string, code: string) {
  const m = device.createShaderModule({ label, code })
  const info = await m.getCompilationInfo()
  let failed = false
  for (const msg of info.messages) {
    const line = `[${label}] ${msg.type} ${msg.lineNum}:${msg.linePos} — ${msg.message}`
    if (msg.type === 'error') {
      console.error(line)
      failed = true
    } else console.warn(line)
  }
  if (failed) throw new Error(`WGSL compile failed: ${label}`)
  return m
}

async function scoped<T>(device: GPUDevice, label: string, make: () => T): Promise<T> {
  device.pushErrorScope('validation')
  const out = make()
  const err = await device.popErrorScope()
  if (err) {
    console.error(`[${label}] ${err.message}`)
    throw new Error(`${label}: ${err.message}`)
  }
  return out
}

/**
 * WebGPU path: compute-animated point state (storage buffer) + four target
 * clouds uploaded straight from Rust linear memory, drawn as instanced quads
 * into an HDR target and finished with a bloom/grain post chain.
 */
export class GpuView implements PointRenderer {
  readonly kind = 'webgpu' as const
  readonly count: number
  private ctx!: GPUCanvasContext
  private uniforms!: GPUBuffer
  private postUniforms!: GPUBuffer
  private u = new Float32Array(64) // 256 bytes, 52 used (offsets documented in cloud.wgsl)
  private pu = new Float32Array(16) // 64 bytes
  private computePipe!: GPUComputePipeline
  private pointPipe!: GPURenderPipeline
  private downPipe!: GPURenderPipeline
  private blurHPipe!: GPURenderPipeline
  private blurVPipe!: GPURenderPipeline
  private compPipe!: GPURenderPipeline
  private computeGroup!: GPUBindGroup
  private pointGroup!: GPUBindGroup
  private sampler!: GPUSampler
  private targets: { hdr: GPUTexture; a: GPUTexture; b: GPUTexture; groups: GPUBindGroup[] } | null = null
  private dpr = 1
  lost = false

  private constructor(
    private device: GPUDevice,
    readonly canvas: HTMLCanvasElement,
    private format: GPUTextureFormat,
    count: number,
  ) {
    this.count = count
  }

  static async create(device: GPUDevice, canvas: HTMLCanvasElement, format: GPUTextureFormat, clouds: Float32Array[]) {
    const count = clouds[0].length / TARGET_FLOATS
    const v = new GpuView(device, canvas, format, count)
    await v.init(clouds)
    return v
  }

  private async init(clouds: Float32Array[]) {
    const d = this.device
    const ctx = this.canvas.getContext('webgpu')
    if (!ctx) throw new Error('webgpu canvas context unavailable')
    this.ctx = ctx
    this.ctx.configure({ device: d, format: this.format, alphaMode: 'opaque' })
    d.lost.then((info) => {
      this.lost = true
      console.warn('WebGPU device lost:', info.message)
    })

    this.uniforms = d.createBuffer({ label: 'u', size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.postUniforms = d.createBuffer({ label: 'pu', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

    // live state starts exactly on the monument, at rest ("free" = −1)
    const n = this.count
    const init = new Float32Array(n * STATE_FLOATS)
    const c0 = clouds[0]
    for (let i = 0; i < n; i++) {
      const s = i * STATE_FLOATS
      const t = i * TARGET_FLOATS
      init[s] = c0[t]
      init[s + 1] = c0[t + 1]
      init[s + 2] = c0[t + 2]
      init[s + 3] = c0[t + 3]
      init[s + 7] = -1
      init[s + 8] = c0[t + 4]
      init[s + 9] = c0[t + 5]
      init[s + 10] = c0[t + 6]
      init[s + 11] = c0[t + 7]
    }
    const state = d.createBuffer({ label: 'state', size: init.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    d.queue.writeBuffer(state, 0, init)

    // targets: zero-copy views over Rust memory go straight to the queue
    const targetBufs = clouds.map((c, k) => {
      const b = d.createBuffer({ label: `cloud${k}`, size: c.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
      d.queue.writeBuffer(b, 0, c.buffer, c.byteOffset, c.byteLength)
      return b
    })

    const computeModule = await compile(d, 'cloud.compute', COMMON + COMPUTE)
    const renderModule = await compile(d, 'cloud.render', COMMON + RENDER)
    const postModule = await compile(d, 'post', postSrc)

    this.computePipe = await scoped(d, 'pipeline.compute', () =>
      d.createComputePipeline({ label: 'cloud.compute', layout: 'auto', compute: { module: computeModule, entryPoint: 'cs_main' } }),
    )
    this.pointPipe = await scoped(d, 'pipeline.points', () =>
      d.createRenderPipeline({
        label: 'cloud.points',
        layout: 'auto',
        vertex: { module: renderModule, entryPoint: 'vs_point' },
        fragment: {
          module: renderModule,
          entryPoint: 'fs_point',
          targets: [
            {
              format: HDR,
              blend: {
                color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              },
            },
          ],
        },
        primitive: { topology: 'triangle-list' },
      }),
    )
    const fullscreen = (label: string, entry: string, format: GPUTextureFormat) =>
      scoped(d, `pipeline.${label}`, () =>
        d.createRenderPipeline({
          label,
          layout: 'auto',
          vertex: { module: postModule, entryPoint: 'vs_full' },
          fragment: { module: postModule, entryPoint: entry, targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        }),
      )
    this.downPipe = await fullscreen('down', 'fs_down', HDR)
    this.blurHPipe = await fullscreen('blurH', 'fs_blur_h', HDR)
    this.blurVPipe = await fullscreen('blurV', 'fs_blur_v', HDR)
    this.compPipe = await fullscreen('comp', 'fs_comp', this.format)

    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })

    this.computeGroup = await scoped(d, 'group.compute', () =>
      d.createBindGroup({
        layout: this.computePipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniforms } },
          { binding: 1, resource: { buffer: state } },
          ...targetBufs.map((b, k) => ({ binding: 2 + k, resource: { buffer: b } })),
        ],
      }),
    )
    this.pointGroup = await scoped(d, 'group.points', () =>
      d.createBindGroup({
        layout: this.pointPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniforms } },
          { binding: 1, resource: { buffer: state } },
        ],
      }),
    )
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.floor(w * dpr))
    this.canvas.height = Math.max(1, Math.floor(h * dpr))
  }

  private ensureTargets() {
    const W = this.canvas.width
    const H = this.canvas.height
    if (this.targets && this.targets.hdr.width === W && this.targets.hdr.height === H) return this.targets
    if (this.targets) {
      this.targets.hdr.destroy()
      this.targets.a.destroy()
      this.targets.b.destroy()
    }
    const d = this.device
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    const hdr = d.createTexture({ label: 'hdr', size: [W, H], format: HDR, usage })
    const qw = Math.max(1, Math.ceil(W / 4))
    const qh = Math.max(1, Math.ceil(H / 4))
    const a = d.createTexture({ label: 'bloomA', size: [qw, qh], format: HDR, usage })
    const b = d.createTexture({ label: 'bloomB', size: [qw, qh], format: HDR, usage })
    const hv = hdr.createView()
    const av = a.createView()
    const bv = b.createView()
    const pu = { buffer: this.postUniforms }
    const groups = [
      d.createBindGroup({
        layout: this.downPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: pu },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: hv },
        ],
      }),
      d.createBindGroup({
        layout: this.blurHPipe.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: av },
        ],
      }),
      d.createBindGroup({
        layout: this.blurVPipe.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: bv },
        ],
      }),
      d.createBindGroup({
        layout: this.compPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: pu },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: hv },
          { binding: 3, resource: av },
        ],
      }),
    ]
    this.targets = { hdr, a, b, groups }
    return this.targets
  }

  frame(f: FrameState) {
    if (this.lost) return
    const W = this.canvas.width
    const H = this.canvas.height
    const u = this.u
    const mobileBoost = Math.sqrt(600_000 / this.count)
    // offsets match struct U in cloud.wgsl
    u.set(f.viewProj, 0) //                                   0..15 viewProj
    u[16] = f.eye[0]; u[17] = f.eye[1]; u[18] = f.eye[2] //   camPos.xyz
    u[19] = f.focalCss * this.dpr //                          camPos.w focal px
    u[20] = W; u[21] = H; u[22] = this.dpr //                 res
    u[23] = 0.062 * Math.pow(mobileBoost, 0.75) //            res.w point world radius
    u[24] = f.time; u[25] = f.dt; u[26] = this.count; u[27] = f.reduced ? 1 : 0
    u[28] = f.a; u[29] = f.b; u[30] = f.mix
    u[31] = 0.72 * Math.pow(mobileBoost, 0.6) //              morph.w gain
    u[32] = f.sweepFront; u[33] = f.sweepReveal; u[34] = f.sweepWidth; u[35] = f.sweepStrength
    u.set(f.flash, 36)
    u.set(f.shock, 40)
    u.set(f.sel, 44)
    u[48] = f.intro; u[49] = f.flashStrength; u[50] = 0.0042; u[51] = f.turbulence
    this.device.queue.writeBuffer(this.uniforms, 0, u)

    const p = this.pu
    p[0] = W; p[1] = H; p[2] = this.dpr; p[3] = f.reduced ? 0 : f.time
    p[4] = 0.85; p[5] = 1.25; p[6] = 0.045; p[7] = 0.045 //    bloom, exposure, grain, scanlines
    p[8] = 0.043; p[9] = 0.047; p[10] = 0.055; p[11] = 0.55 // #0b0c0e, vignette
    p[12] = 1; p[13] = 0.55; p[14] = 0.012; p[15] = f.pulse // intro, threshold, aberration, pulse
    this.device.queue.writeBuffer(this.postUniforms, 0, p)

    const t = this.ensureTargets()
    const enc = this.device.createCommandEncoder({ label: 'frame' })
    const cp = enc.beginComputePass({ label: 'simulate' })
    cp.setPipeline(this.computePipe)
    cp.setBindGroup(0, this.computeGroup)
    cp.dispatchWorkgroups(Math.ceil(this.count / 256))
    cp.end()

    const rp = enc.beginRenderPass({
      label: 'points',
      colorAttachments: [{ view: t.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
    })
    rp.setPipeline(this.pointPipe)
    rp.setBindGroup(0, this.pointGroup)
    rp.draw(6, this.count)
    rp.end()

    const pass = (view: GPUTextureView, pipe: GPURenderPipeline, group: GPUBindGroup, label: string) => {
      const r = enc.beginRenderPass({ label, colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })
      r.setPipeline(pipe)
      r.setBindGroup(0, group)
      r.draw(3)
      r.end()
    }
    pass(t.a.createView(), this.downPipe, t.groups[0], 'bloom.down')
    pass(t.b.createView(), this.blurHPipe, t.groups[1], 'bloom.h')
    pass(t.a.createView(), this.blurVPipe, t.groups[2], 'bloom.v')
    pass(this.ctx.getCurrentTexture().createView(), this.compPipe, t.groups[3], 'composite')
    this.device.queue.submit([enc.finish()])
  }
}
