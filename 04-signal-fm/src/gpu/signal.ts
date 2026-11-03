// ─────────────────────────────────────────────────────────────────────────────
//  SIGNAL FM · gpu/signal.ts — the WebGPU renderer
//
//   pass 1  scene.wgsl  fs_scene    → sceneTex  rgba16float  (cols·2 × rows·2)
//   pass 2  ascii.wgsl  fs_cells    → cellTex   rgba16float  (cols × rows)
//   pass 3  ascii.wgsl  fs_present  → canvas                 (device px)
//
//  Four scene pipelines share one module; SCENE is a pipeline-overridable
//  constant so each pipeline only carries its own SDF.
// ─────────────────────────────────────────────────────────────────────────────

import common from './common.wgsl?raw'
import sceneSrc from './scene.wgsl?raw'
import asciiSrc from './ascii.wgsl?raw'
import { buildAtlas, cellHeight, GLYPH_COUNT } from '../glyphs'
import type { FrameState, Renderer } from '../renderer'

const SUB = 2 // scene texels per cell, per axis

async function compile(device: GPUDevice, label: string, code: string) {
  const module = device.createShaderModule({ label, code })
  const info = await module.getCompilationInfo()
  let failed = false
  for (const m of info.messages) {
    const line = `[${label}] ${m.type} ${m.lineNum}:${m.linePos} — ${m.message}`
    if (m.type === 'error') {
      console.error(line)
      failed = true
    } else console.warn(line)
  }
  if (failed) throw new Error(`WGSL compilation failed: ${label}`)
  return module
}

async function guarded<T>(device: GPUDevice, label: string, make: () => T): Promise<T> {
  device.pushErrorScope('validation')
  const out = make()
  const err = await device.popErrorScope()
  if (err) {
    console.error(`[${label}] ${err.message}`)
    throw new Error(`Pipeline creation failed: ${label}`)
  }
  return out
}

export class SignalGPU implements Renderer {
  readonly kind = 'webgpu'
  cols = 1
  rows = 1
  cellW = 1
  cellH = 1
  private ctx: GPUCanvasContext
  private ubuf: GPUBuffer
  private data = new Float32Array(40) // 160 bytes, see common.wgsl
  private scenePipes: GPURenderPipeline[] = []
  private cellPipe!: GPURenderPipeline
  private presentPipe!: GPURenderPipeline
  private bglScene!: GPUBindGroupLayout
  private bglCell!: GPUBindGroupLayout
  private bglPresent!: GPUBindGroupLayout
  private sceneGroup!: GPUBindGroup
  private cellGroup!: GPUBindGroup
  private presentGroup!: GPUBindGroup
  private sceneTex?: GPUTexture
  private cellTex?: GPUTexture
  private atlasTex?: GPUTexture
  private atlasKey = ''
  private pulse = [0.5, 0.5, -100, -100]

  private constructor(
    private device: GPUDevice,
    readonly canvas: HTMLCanvasElement,
    private format: GPUTextureFormat,
  ) {
    this.ctx = canvas.getContext('webgpu') as GPUCanvasContext
    this.ctx.configure({ device, format, alphaMode: 'opaque' })
    this.ubuf = device.createBuffer({ label: 'uniforms', size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  }

  static async create(device: GPUDevice, canvas: HTMLCanvasElement, format: GPUTextureFormat) {
    const r = new SignalGPU(device, canvas, format)
    await r.init()
    return r
  }

  private async init() {
    const d = this.device
    const sceneMod = await compile(d, 'scene.wgsl', common + sceneSrc)
    const asciiMod = await compile(d, 'ascii.wgsl', common + asciiSrc)
    const vis = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
    const ubo: GPUBindGroupLayoutEntry = { binding: 0, visibility: vis, buffer: { type: 'uniform' } }
    const tex = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'unfilterable-float' },
    })
    this.bglScene = d.createBindGroupLayout({ label: 'bgl.scene', entries: [ubo] })
    this.bglCell = d.createBindGroupLayout({ label: 'bgl.cell', entries: [ubo, tex(1)] })
    this.bglPresent = d.createBindGroupLayout({ label: 'bgl.present', entries: [ubo, tex(2), tex(3)] })

    const pipe = (label: string, module: GPUShaderModule, entry: string, layout: GPUBindGroupLayout, fmt: GPUTextureFormat, constants?: Record<string, number>) =>
      guarded(d, label, () =>
        d.createRenderPipeline({
          label,
          layout: d.createPipelineLayout({ bindGroupLayouts: [layout] }),
          vertex: { module, entryPoint: 'vs_full' },
          fragment: { module, entryPoint: entry, targets: [{ format: fmt }], constants },
          primitive: { topology: 'triangle-list' },
        }),
      )

    for (let i = 0; i < 4; i++) this.scenePipes.push(await pipe(`scene.${i}`, sceneMod, 'fs_scene', this.bglScene, 'rgba16float', { SCENE: i }))
    this.cellPipe = await pipe('cells', asciiMod, 'fs_cells', this.bglCell, 'rgba16float')
    this.presentPipe = await pipe('present', asciiMod, 'fs_present', this.bglPresent, this.format)
    this.sceneGroup = d.createBindGroup({ layout: this.bglScene, entries: [{ binding: 0, resource: { buffer: this.ubuf } }] })
  }

  resize(w: number, h: number, dpr: number, cellCss: number) {
    const W = Math.max(1, Math.floor(w * dpr))
    const H = Math.max(1, Math.floor(h * dpr))
    this.canvas.width = W
    this.canvas.height = H
    this.canvas.style.width = `${W / dpr}px`
    this.canvas.style.height = `${H / dpr}px`
    this.cellW = Math.max(6, Math.round(cellCss * dpr))
    this.cellH = cellHeight(this.cellW)
    this.cols = Math.ceil(W / this.cellW)
    this.rows = Math.ceil(H / this.cellH)

    const d = this.device
    this.sceneTex?.destroy()
    this.cellTex?.destroy()
    const rt = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    this.sceneTex = d.createTexture({ label: 'scene', size: [this.cols * SUB, this.rows * SUB], format: 'rgba16float', usage: rt })
    this.cellTex = d.createTexture({ label: 'cells', size: [this.cols, this.rows], format: 'rgba16float', usage: rt })

    const key = `${this.cellW}x${this.cellH}`
    if (key !== this.atlasKey) {
      this.atlasKey = key
      this.atlasTex?.destroy()
      const src = buildAtlas(this.cellW, this.cellH)
      this.atlasTex = d.createTexture({
        label: 'atlas',
        size: [src.width, src.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      d.queue.copyExternalImageToTexture({ source: src }, { texture: this.atlasTex }, [src.width, src.height])
    }

    this.cellGroup = d.createBindGroup({
      layout: this.bglCell,
      entries: [
        { binding: 0, resource: { buffer: this.ubuf } },
        { binding: 1, resource: this.sceneTex.createView() },
      ],
    })
    this.presentGroup = d.createBindGroup({
      layout: this.bglPresent,
      entries: [
        { binding: 0, resource: { buffer: this.ubuf } },
        { binding: 2, resource: this.cellTex.createView() },
        { binding: 3, resource: this.atlasTex!.createView() },
      ],
    })
  }

  firePulse(x: number, y: number, rtime: number, stime: number) {
    this.pulse = [x, y, rtime, stime]
  }

  frame(s: FrameState) {
    const u = this.data
    u[0] = this.canvas.width
    u[1] = this.canvas.height
    u[2] = this.cols
    u[3] = this.rows
    u[4] = this.cellW
    u[5] = this.cellH
    u[6] = s.time
    u[7] = s.rtime
    u.set(s.bands, 8) // 32
    u[12] = s.mouse[0] // 48
    u[13] = s.mouse[1]
    u[14] = s.signal // 56
    u[15] = s.glitch // 60
    u[16] = s.motion // 64
    u[17] = s.slow // 68
    u[18] = GLYPH_COUNT // 72
    u[19] = s.beat // 76
    u.set(this.pulse, 20) // 80
    u.set(s.ink, 24) // 96
    u[27] = 1
    u.set(s.paper, 28) // 112
    u[31] = 1
    u.set(s.accent, 32) // 128
    u[35] = 1
    u[36] = s.hold[0] // 144
    u[37] = s.hold[1]
    u[38] = s.hold[2]
    u[39] = 0
    this.device.queue.writeBuffer(this.ubuf, 0, u)

    const enc = this.device.createCommandEncoder({ label: 'frame' })
    const pass = (view: GPUTextureView, pipe: GPURenderPipeline, group: GPUBindGroup) => {
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      })
      rp.setPipeline(pipe)
      rp.setBindGroup(0, group)
      rp.draw(3)
      rp.end()
    }
    pass(this.sceneTex!.createView(), this.scenePipes[s.scene] ?? this.scenePipes[0], this.sceneGroup)
    pass(this.cellTex!.createView(), this.cellPipe, this.cellGroup)
    pass(this.ctx.getCurrentTexture().createView(), this.presentPipe, this.presentGroup)
    this.device.queue.submit([enc.finish()])
  }
}
