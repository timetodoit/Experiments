import src from './sheet.wgsl?raw'
import { Camera, type SheetView } from '../camera'

const SAMPLES = 4

/** WebGPU renderer for the Rust cloth. Owns camera + picking rays. */
export class SheetRenderer implements SheetView {
  cam = new Camera()
  private ctx: GPUCanvasContext
  private uniforms: GPUBuffer
  private vbuf: GPUBuffer
  private ibuf: GPUBuffer
  private sheetPipe: GPURenderPipeline
  private shadowPipe: GPURenderPipeline
  private sheetGroup!: GPUBindGroup
  private shadowGroup: GPUBindGroup
  private msaa?: GPUTexture
  private depth?: GPUTexture
  private data = new Float32Array(32)
  private indexCount = 0
  dpr = 1
  xray = 0

  constructor(
    private device: GPUDevice,
    readonly canvas: HTMLCanvasElement,
    private format: GPUTextureFormat,
    vertexFloats: number,
    maxIndices: number,
    texture: GPUTexture,
  ) {
    this.ctx = canvas.getContext('webgpu')!
    this.ctx.configure({ device, format, alphaMode: 'premultiplied' })
    this.uniforms = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.vbuf = device.createBuffer({ size: vertexFloats * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    this.ibuf = device.createBuffer({ size: maxIndices * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })

    const module = device.createShaderModule({ label: 'sheet', code: src })
    const buffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: 32,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x2' },
        ],
      },
    ]
    const depthStencil: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
    this.sheetPipe = device.createRenderPipeline({
      label: 'sheet',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_sheet', buffers },
      fragment: { module, entryPoint: 'fs_sheet', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil,
      multisample: { count: SAMPLES },
    })
    this.shadowPipe = device.createRenderPipeline({
      label: 'sheet.shadow',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_shadow', buffers },
      fragment: {
        module,
        entryPoint: 'fs_shadow',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: SAMPLES },
    })

    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      maxAnisotropy: 8,
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    this.sheetGroup = device.createBindGroup({
      layout: this.sheetPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: sampler },
      ],
    })
    this.shadowGroup = device.createBindGroup({
      layout: this.shadowPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniforms } }],
    })
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr
    const pw = Math.max(1, Math.floor(w * dpr))
    const ph = Math.max(1, Math.floor(h * dpr))
    this.canvas.width = pw
    this.canvas.height = ph
    this.msaa?.destroy()
    this.depth?.destroy()
    this.msaa = this.device.createTexture({
      size: [pw, ph],
      format: this.format,
      sampleCount: SAMPLES,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.depth = this.device.createTexture({
      size: [pw, ph],
      format: 'depth24plus',
      sampleCount: SAMPLES,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.cam.resize(w, h)
  }

  upload(verts: Float32Array, indices: Uint32Array | null, indexCount: number) {
    this.device.queue.writeBuffer(this.vbuf, 0, verts.buffer, verts.byteOffset, verts.byteLength)
    if (indices) this.device.queue.writeBuffer(this.ibuf, 0, indices.buffer, indices.byteOffset, indices.byteLength)
    this.indexCount = indexCount
  }

  frame(time: number) {
    if (!this.msaa || !this.depth) return
    const d = this.data
    d.set(this.cam.viewProj, 0)
    d.set([...this.cam.eye, 1], 16)
    d.set([-0.45, 0.7, 0.9, 0], 20)
    d.set([0.16, -0.1, -0.7, 0.16], 24)
    d.set([time, this.xray, 0, 0], 28)
    this.device.queue.writeBuffer(this.uniforms, 0, d)

    const enc = this.device.createCommandEncoder()
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
      depthStencilAttachment: {
        view: this.depth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    })
    pass.setVertexBuffer(0, this.vbuf)
    pass.setIndexBuffer(this.ibuf, 'uint32')
    if (this.xray < 0.5) {
      pass.setPipeline(this.shadowPipe)
      pass.setBindGroup(0, this.shadowGroup)
      pass.drawIndexed(this.indexCount)
    }
    pass.setPipeline(this.sheetPipe)
    pass.setBindGroup(0, this.sheetGroup)
    pass.drawIndexed(this.indexCount)
    pass.end()
    this.device.queue.submit([enc.finish()])
  }
}

/** Upload a canvas as a mipmapped-ish texture (single level; anisotropic sampling does the rest). */
export function canvasTexture(device: GPUDevice, source: HTMLCanvasElement): GPUTexture {
  const tex = device.createTexture({
    size: [source.width, source.height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture({ source }, { texture: tex }, [source.width, source.height])
  return tex
}
