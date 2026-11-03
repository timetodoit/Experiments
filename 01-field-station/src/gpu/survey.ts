import src from './survey.wgsl?raw'

/** Everything the survey shader needs from the page each frame (map space). */
export interface SurveyState {
  time: number
  dt: number
  mouse: [number, number]
  mouseVel: [number, number]
  lens: [number, number]
  press: number
  zoom: number
  rects: [number, number, number, number][] // 3 rects, map-space offsets from lens
  scan: number
  intro: number
}

const [COMMON, REST] = src.split('// @@COMPUTE')
const [COMPUTE, RENDER] = REST.split('// @@RENDER')

export class Survey {
  readonly count: number
  private ctx: GPUCanvasContext
  private uniforms: GPUBuffer
  private data = new Float32Array(60)
  private computePipe!: GPUComputePipeline
  private terrainPipe!: GPURenderPipeline
  private particlePipe!: GPURenderPipeline
  private computeGroup!: GPUBindGroup
  private renderGroup!: GPUBindGroup
  private terrainGroup!: GPUBindGroup
  private shocks: number[] = new Array(32).fill(-100)
  private shockIdx = 0
  width = 1
  height = 1
  dpr = 1

  constructor(
    private device: GPUDevice,
    readonly canvas: HTMLCanvasElement,
    format: GPUTextureFormat,
    count: number,
  ) {
    this.count = count
    this.ctx = canvas.getContext('webgpu')!
    this.ctx.configure({ device, format, alphaMode: 'opaque' })
    this.uniforms = device.createBuffer({ size: 240, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

    // seed particles uniformly; they respawn in-shader afterwards
    const init = new Float32Array(count * 8)
    for (let i = 0; i < count; i++) {
      init[i * 8 + 0] = (Math.random() - 0.5) * 1.8
      init[i * 8 + 1] = Math.random() - 0.5
      init[i * 8 + 4] = Math.random() * 2
      init[i * 8 + 5] = Math.random() * 1000
    }
    const particles = device.createBuffer({
      size: init.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(particles, 0, init)

    const computeModule = device.createShaderModule({ label: 'survey.compute', code: COMMON + COMPUTE })
    const renderModule = device.createShaderModule({ label: 'survey.render', code: COMMON + RENDER })

    this.computePipe = device.createComputePipeline({
      label: 'pollen',
      layout: 'auto',
      compute: { module: computeModule, entryPoint: 'cs_particles' },
    })
    this.terrainPipe = device.createRenderPipeline({
      label: 'terrain',
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs_full' },
      fragment: { module: renderModule, entryPoint: 'fs_terrain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })
    this.particlePipe = device.createRenderPipeline({
      label: 'pollen.draw',
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs_particle' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_particle',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    })

    this.computeGroup = device.createBindGroup({
      layout: this.computePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: { buffer: particles } },
      ],
    })
    this.terrainGroup = device.createBindGroup({
      layout: this.terrainPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniforms } }],
    })
    this.renderGroup = device.createBindGroup({
      layout: this.particlePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: { buffer: particles } },
      ],
    })
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr
    this.width = w
    this.height = h
    this.canvas.width = Math.max(1, Math.floor(w * dpr))
    this.canvas.height = Math.max(1, Math.floor(h * dpr))
  }

  /** Seismic pulse at a map-space point. */
  shock(x: number, y: number, time: number, strength = 1) {
    const i = this.shockIdx++ % 8
    this.shocks.splice(i * 4, 4, x, y, time, strength)
  }

  frame(s: SurveyState) {
    const d = this.data
    d[0] = this.canvas.width
    d[1] = this.canvas.height
    d[2] = s.time
    d[3] = s.dt
    d[4] = s.mouse[0]
    d[5] = s.mouse[1]
    d[6] = s.mouseVel[0]
    d[7] = s.mouseVel[1]
    d[8] = s.lens[0]
    d[9] = s.lens[1]
    d[10] = s.press
    d[11] = s.zoom
    for (let r = 0; r < 3; r++) d.set(s.rects[r], 12 + r * 4)
    d[24] = this.dpr
    d[25] = s.scan
    d[26] = this.count
    d[27] = s.intro
    d.set(this.shocks, 28)
    this.device.queue.writeBuffer(this.uniforms, 0, d)

    const enc = this.device.createCommandEncoder()
    const cp = enc.beginComputePass()
    cp.setPipeline(this.computePipe)
    cp.setBindGroup(0, this.computeGroup)
    cp.dispatchWorkgroups(Math.ceil(this.count / 256))
    cp.end()

    const rp = enc.beginRenderPass({
      colorAttachments: [
        { view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
      ],
    })
    rp.setPipeline(this.terrainPipe)
    rp.setBindGroup(0, this.terrainGroup)
    rp.draw(3)
    rp.setPipeline(this.particlePipe)
    rp.setBindGroup(0, this.renderGroup)
    rp.draw(6, this.count)
    rp.end()
    this.device.queue.submit([enc.finish()])
  }
}
