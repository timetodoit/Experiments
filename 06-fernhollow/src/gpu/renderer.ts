import sceneSrc from './scene.wgsl?raw'
import postSrc from './post.wgsl?raw'
import type { TerrainMesh } from '../terrain'

export interface SceneAssets {
  terrain: TerrainMesh
  flowers: Float32Array // 12 floats per instance
  leaves: Float32Array // 8 floats per instance
  rays: Float32Array // 8 floats per instance
  dustCount: number
}

export interface FrameData {
  time: number
  viewProj: Float32Array
  view: Float32Array
  camPos: number[]
  right: number[]
  up: number[]
  fwd: number[]
  aspect: number
  tanHalf: number
  dpr: number
  mouse: [number, number, number, number] // device px (y up), strength, radius px
  disperse: number
  intro: number
  speed: number
  wind: number
  reduced: number
  push: number
  calm: number
  fog: [number, number, number, number]
  exposure: number
  bloom: number
  grain: number
  vignette: number
  chroma: number
}

const HDR: GPUTextureFormat = 'rgba16float'
const DEPTH: GPUTextureFormat = 'depth24plus'
const U_FLOATS = 68 // 272 bytes, see struct U
const CU_FLOATS = 12

async function check(device: GPUDevice, module: GPUShaderModule, label: string) {
  const info = await module.getCompilationInfo()
  const errs = info.messages.filter((m) => m.type === 'error')
  if (errs.length) {
    const msg = errs.map((m) => `${label}:${m.lineNum}:${m.linePos} ${m.message}`).join('\n')
    throw new Error(msg)
  }
  void device
}

export class GPURenderer {
  private ctx: GPUCanvasContext
  private format: GPUTextureFormat
  private u = new Float32Array(U_FLOATS)
  private cu = new Float32Array(CU_FLOATS)
  private uBuf: GPUBuffer
  private cuBuf: GPUBuffer
  private sampler: GPUSampler
  private pipes!: {
    sky: GPURenderPipeline
    terrain: GPURenderPipeline
    leaf: GPURenderPipeline
    ray: GPURenderPipeline
    flower: GPURenderPipeline
    dust: GPURenderPipeline
    downFirst: GPURenderPipeline
    down: GPURenderPipeline
    up: GPURenderPipeline
    composite: GPURenderPipeline
  }
  private sceneGroups!: Map<GPURenderPipeline, GPUBindGroup>
  private bufs!: {
    tv: GPUBuffer
    ti: GPUBuffer
    flowers: GPUBuffer
    leaves: GPUBuffer
    rays: GPUBuffer
  }
  private counts = { indices: 0, flowers: 0, leaves: 0, rays: 0, dust: 0 }
  private targets?: {
    hdr: GPUTexture
    depth: GPUTexture
    hdrView: GPUTextureView
    depthView: GPUTextureView
    mips: GPUTexture[]
    mipViews: GPUTextureView[]
    downGroups: GPUBindGroup[]
    upGroups: GPUBindGroup[]
    compGroup: GPUBindGroup
  }
  private size = { w: 1, h: 1 }

  static async create(device: GPUDevice, canvas: HTMLCanvasElement, assets: SceneAssets) {
    const r = new GPURenderer(device, canvas)
    await r.build(assets)
    return r
  }

  private constructor(
    private device: GPUDevice,
    readonly canvas: HTMLCanvasElement,
  ) {
    const ctx = canvas.getContext('webgpu')
    if (!ctx) throw new Error('webgpu context unavailable')
    this.ctx = ctx
    this.format = navigator.gpu.getPreferredCanvasFormat()
    ctx.configure({ device, format: this.format, alphaMode: 'opaque' })
    this.uBuf = device.createBuffer({ label: 'scene.u', size: U_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.cuBuf = device.createBuffer({ label: 'post.cu', size: CU_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
  }

  private upload(data: Float32Array | Uint32Array, usage: number, label: string) {
    const buf = this.device.createBuffer({ label, size: Math.max(16, data.byteLength), usage: usage | GPUBufferUsage.COPY_DST })
    this.device.queue.writeBuffer(buf, 0, data.buffer, data.byteOffset, data.byteLength)
    return buf
  }

  private async build(a: SceneAssets) {
    const d = this.device
    const scene = d.createShaderModule({ label: 'scene', code: sceneSrc })
    const post = d.createShaderModule({ label: 'post', code: postSrc })
    await check(d, scene, 'scene.wgsl')
    await check(d, post, 'post.wgsl')

    const V = GPUBufferUsage.VERTEX
    this.bufs = {
      tv: this.upload(a.terrain.vertices, V, 'terrain.v'),
      ti: this.upload(a.terrain.indices, GPUBufferUsage.INDEX, 'terrain.i'),
      flowers: this.upload(a.flowers, V, 'flowers'),
      leaves: this.upload(a.leaves, V, 'leaves'),
      rays: this.upload(a.rays, V, 'rays'),
    }
    this.counts = {
      indices: a.terrain.indices.length,
      flowers: a.flowers.length / 12,
      leaves: a.leaves.length / 8,
      rays: a.rays.length / 8,
      dust: a.dustCount,
    }

    const premul: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    }
    const additive: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    }
    const depth = (write: boolean, compare: GPUCompareFunction = 'less'): GPUDepthStencilState => ({
      format: DEPTH,
      depthWriteEnabled: write,
      depthCompare: compare,
    })
    const inst = (stride: number, n: number): GPUVertexBufferLayout => ({
      arrayStride: stride,
      stepMode: 'instance',
      attributes: Array.from({ length: n }, (_, i) => ({ shaderLocation: i, offset: i * 16, format: 'float32x4' as GPUVertexFormat })),
    })
    const scenePipe = async (
      label: string,
      vs: string,
      fs: string,
      buffers: GPUVertexBufferLayout[],
      blend: GPUBlendState | undefined,
      ds: GPUDepthStencilState,
      topology: GPUPrimitiveTopology = 'triangle-list',
    ) =>
      d.createRenderPipelineAsync({
        label,
        layout: 'auto',
        vertex: { module: scene, entryPoint: vs, buffers },
        fragment: { module: scene, entryPoint: fs, targets: [{ format: HDR, blend }] },
        primitive: { topology, cullMode: 'none' },
        depthStencil: ds,
      })
    const postPipe = (label: string, fs: string, format: GPUTextureFormat, blend?: GPUBlendState) =>
      d.createRenderPipelineAsync({
        label,
        layout: 'auto',
        vertex: { module: post, entryPoint: 'vs_full' },
        fragment: { module: post, entryPoint: fs, targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
      })

    const [sky, terrain, leaf, ray, flower, dust, downFirst, down, up, composite] = await Promise.all([
      scenePipe('sky', 'vs_sky', 'fs_sky', [], undefined, depth(false, 'always')),
      scenePipe(
        'terrain',
        'vs_terrain',
        'fs_terrain',
        [
          {
            arrayStride: 32,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x2' },
            ],
          },
        ],
        undefined,
        depth(true),
      ),
      scenePipe('leaf', 'vs_leaf', 'fs_leaf', [inst(32, 2)], premul, depth(true)),
      scenePipe('ray', 'vs_ray', 'fs_ray', [inst(32, 2)], additive, depth(false)),
      scenePipe('flower', 'vs_flower', 'fs_flower', [inst(48, 3)], premul, depth(false)),
      scenePipe('dust', 'vs_dust', 'fs_dust', [], additive, depth(false)),
      postPipe('bloom.downFirst', 'fs_down_first', HDR),
      postPipe('bloom.down', 'fs_down', HDR),
      postPipe('bloom.up', 'fs_up', HDR, additive),
      postPipe('composite', 'fs_composite', this.format),
    ])
    this.pipes = { sky, terrain, leaf, ray, flower, dust, downFirst, down, up, composite }
    this.sceneGroups = new Map()
    for (const p of [sky, terrain, leaf, ray, flower, dust]) {
      this.sceneGroups.set(
        p,
        d.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uBuf } }] }),
      )
    }
  }

  resize(w: number, h: number) {
    w = Math.max(2, Math.floor(w))
    h = Math.max(2, Math.floor(h))
    if (this.targets && w === this.size.w && h === this.size.h) return
    this.size = { w, h }
    this.canvas.width = w
    this.canvas.height = h
    const d = this.device
    if (this.targets) {
      this.targets.hdr.destroy()
      this.targets.depth.destroy()
      for (const m of this.targets.mips) m.destroy()
    }
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    const hdr = d.createTexture({ label: 'hdr', size: [w, h], format: HDR, usage })
    const depth = d.createTexture({ label: 'depth', size: [w, h], format: DEPTH, usage: GPUTextureUsage.RENDER_ATTACHMENT })
    const mips: GPUTexture[] = []
    let mw = Math.max(1, w >> 1)
    let mh = Math.max(1, h >> 1)
    for (let i = 0; i < 7 && Math.min(mw, mh) >= 6; i++) {
      mips.push(d.createTexture({ label: `bloom${i}`, size: [mw, mh], format: HDR, usage }))
      mw = Math.max(1, mw >> 1)
      mh = Math.max(1, mh >> 1)
    }
    const hdrView = hdr.createView()
    const mipViews = mips.map((m) => m.createView())
    const group = (p: GPURenderPipeline, view: GPUTextureView) =>
      d.createBindGroup({
        layout: p.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: this.sampler },
        ],
      })
    const downGroups = mipViews.map((_, i) => (i === 0 ? group(this.pipes.downFirst, hdrView) : group(this.pipes.down, mipViews[i - 1])))
    const upGroups = mipViews.map((v) => group(this.pipes.up, v))
    const compGroup = d.createBindGroup({
      layout: this.pipes.composite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: hdrView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: mipViews[0] },
        { binding: 3, resource: { buffer: this.cuBuf } },
      ],
    })
    this.targets = { hdr, depth, hdrView, depthView: depth.createView(), mips, mipViews, downGroups, upGroups, compGroup }
  }

  render(f: FrameData) {
    const t = this.targets
    if (!t) return
    const d = this.device
    const u = this.u
    u.set(f.viewProj, 0)
    u.set(f.view, 16)
    u.set([f.camPos[0], f.camPos[1], f.camPos[2], f.time], 32)
    u.set([f.right[0], f.right[1], f.right[2], f.aspect], 36)
    u.set([f.up[0], f.up[1], f.up[2], f.tanHalf], 40)
    u.set([f.fwd[0], f.fwd[1], f.fwd[2], f.dpr], 44)
    u.set([this.size.w, this.size.h, 1 / this.size.w, 1 / this.size.h], 48)
    u.set(f.mouse, 52)
    u.set([f.disperse, f.intro, f.speed, (this.size.h * 0.5) / f.tanHalf], 56)
    u.set(f.fog, 60)
    u.set([f.wind, f.reduced, f.push, f.calm], 64)
    d.queue.writeBuffer(this.uBuf, 0, u)
    const cu = this.cu
    cu.set([this.size.w, this.size.h, 1 / this.size.w, 1 / this.size.h], 0)
    cu.set([f.time, f.exposure, f.bloom, f.grain], 4)
    cu.set([f.vignette, f.chroma, f.speed, f.disperse], 8)
    d.queue.writeBuffer(this.cuBuf, 0, cu)

    const enc = d.createCommandEncoder({ label: 'frame' })
    const pass = enc.beginRenderPass({
      label: 'scene',
      colorAttachments: [{ view: t.hdrView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      depthStencilAttachment: { view: t.depthView, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
    })
    const P = this.pipes
    const G = this.sceneGroups
    const use = (p: GPURenderPipeline) => {
      pass.setPipeline(p)
      pass.setBindGroup(0, G.get(p)!)
    }
    use(P.sky)
    pass.draw(3)
    use(P.terrain)
    pass.setVertexBuffer(0, this.bufs.tv)
    pass.setIndexBuffer(this.bufs.ti, 'uint32')
    pass.drawIndexed(this.counts.indices)
    use(P.leaf)
    pass.setVertexBuffer(0, this.bufs.leaves)
    pass.draw(6, this.counts.leaves)
    use(P.ray)
    pass.setVertexBuffer(0, this.bufs.rays)
    pass.draw(6, this.counts.rays)
    use(P.flower)
    pass.setVertexBuffer(0, this.bufs.flowers)
    pass.draw(6, this.counts.flowers)
    use(P.dust)
    pass.draw(6, this.counts.dust)
    pass.end()

    // bloom: down the chain…
    for (let i = 0; i < t.mips.length; i++) {
      const p = enc.beginRenderPass({
        label: `down${i}`,
        colorAttachments: [{ view: t.mipViews[i], loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      })
      p.setPipeline(i === 0 ? P.downFirst : P.down)
      p.setBindGroup(0, t.downGroups[i])
      p.draw(3)
      p.end()
    }
    // …and back up, accumulating additively
    for (let i = t.mips.length - 1; i > 0; i--) {
      const p = enc.beginRenderPass({
        label: `up${i}`,
        colorAttachments: [{ view: t.mipViews[i - 1], loadOp: 'load', storeOp: 'store' }],
      })
      p.setPipeline(P.up)
      p.setBindGroup(0, t.upGroups[i])
      p.draw(3)
      p.end()
    }

    const out = enc.beginRenderPass({
      label: 'composite',
      colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    })
    out.setPipeline(P.composite)
    out.setBindGroup(0, t.compGroup)
    out.draw(3)
    out.end()
    d.queue.submit([enc.finish()])
  }

  destroy() {
    this.targets?.hdr.destroy()
    this.targets?.depth.destroy()
    this.targets?.mips.forEach((m) => m.destroy())
    for (const b of Object.values(this.bufs)) b.destroy()
    this.ctx.unconfigure()
  }
}
