import * as THREE from 'three'
import { gl } from './core/WebGL'
import { Assets, loadAssets } from './utils/assetLoader'
import { controls } from './utils/OrbitControls'
import Heap from 'heap-js'
import GUI from 'lil-gui'

type ImageFragment = {
  avgColor: THREE.Color
  score: number
}

export class TCanvas {
  private imageDatas: { [key in string]: ImageData } = {}
  private selectedImageData!: ImageData
  private imageFragments = new THREE.Group()
  private imageFragmentsHeap!: Heap<THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>
  private imageFragmentGeometry = new THREE.BoxGeometry()
  private imageFragmentMaterial = new THREE.MeshStandardMaterial()

  private lights = new THREE.Group()

  private readyAnimation = true

  private assets: Assets = {
    image1: { path: 'images/image1.jpg' },
    image2: { path: 'images/image2.jpg' },
    image3: { path: 'images/image3.jpg' },
  }

  constructor(private container: HTMLElement) {
    loadAssets(this.assets).then(() => {
      this.init()
      this.createLights()
      this.createObjects()
      this.addGui()
      gl.requestAnimationFrame(this.anime)
    })
  }

  private init() {
    gl.setup(this.container)
    gl.scene.background = new THREE.Color('#000')
    gl.camera.position.z = 2.5

    // gl.setStats(this.container)

    this.createImageDatas()
    this.selectedImageData = this.imageDatas['image1']

    const colorScoreComparator = (a: THREE.Mesh, b: THREE.Mesh) => b.userData.score - a.userData.score
    this.imageFragmentsHeap = new Heap<THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>(colorScoreComparator)
  }

  private createImageDatas() {
    Object.keys(this.assets).forEach((key) => {
      const texture = this.assets[key].data as THREE.Texture
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.canvas.width = texture.source.data.width
      ctx.canvas.height = texture.source.data.height
      ctx.drawImage(texture.source.data, 0, 0)
      this.imageDatas[key] = ctx.getImageData(0, 0, texture.source.data.width, texture.source.data.height)
    })
  }

  private calcImageFragment(startWidth: number, startHeight: number, endWidth: number, endHeight: number): ImageFragment {
    const avgColor = { r: 0, g: 0, b: 0 }

    let n = 0
    const sh = Math.ceil(startHeight)
    const eh = Math.ceil(endHeight)
    const sw = Math.ceil(startWidth)
    const ew = Math.ceil(endWidth)

    for (let row = sh; row < eh; row++) {
      for (let col = sw; col < ew; col++) {
        const ri = row * this.selectedImageData.width * 4
        const ci = col * 4
        avgColor.r += this.selectedImageData.data[ri + (ci + 0)] / 255
        avgColor.g += this.selectedImageData.data[ri + (ci + 1)] / 255
        avgColor.b += this.selectedImageData.data[ri + (ci + 2)] / 255
        n++
      }
    }
    avgColor.r /= n
    avgColor.g /= n
    avgColor.b /= n

    const error = { r: 0, g: 0, b: 0 }

    for (let row = sh; row < eh; row++) {
      for (let col = sw; col < ew; col++) {
        const ri = row * this.selectedImageData.width * 4
        const ci = col * 4
        error.r += (this.selectedImageData.data[ri + (ci + 0)] / 255 - avgColor.r) ** 2
        error.g += (this.selectedImageData.data[ri + (ci + 1)] / 255 - avgColor.g) ** 2
        error.b += (this.selectedImageData.data[ri + (ci + 2)] / 255 - avgColor.b) ** 2
      }
    }

    error.r = (error.r / n) ** 0.5
    error.g = (error.g / n) ** 0.5
    error.b = (error.b / n) ** 0.5
    const score = error.r + error.g + error.b

    return {
      avgColor: new THREE.Color(avgColor.r, avgColor.g, avgColor.b),
      score,
    }
  }

  private createLights() {
    gl.scene.add(this.lights)

    const ambientLight = new THREE.AmbientLight('#fff', 0.2)
    this.lights.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight('#fff', 0.5)
    directionalLight.position.set(2, 2, 2)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.set(2048, 2048)
    const edge = 1.5
    directionalLight.shadow.camera = new THREE.OrthographicCamera(-edge, edge, edge, -edge, 0.01, 5)
    this.lights.add(directionalLight)

    // gl.scene.add(new THREE.CameraHelper(directionalLight.shadow.camera))
  }

  private createImageFragments(sw: number, sh: number, ew: number, eh: number) {
    const eW = sw + (ew - sw) / 2
    const eH = sh + (eh - sh) / 2

    const sessors = [
      { sw: sw, sh: sh, ew: eW, eh: eH },
      { sw: eW, sh: sh, ew: ew, eh: eH },
      { sw: sw, sh: eH, ew: eW, eh: eh },
      { sw: eW, sh: eH, ew: ew, eh: eh },
    ]

    const scaleW = (ew - sw) / this.selectedImageData.width
    const scaleH = (eh - sh) / this.selectedImageData.height
    const area = scaleW * scaleH

    sessors.forEach((sessor) => {
      const data = this.calcImageFragment(sessor.sw, sessor.sh, sessor.ew, sessor.eh)
      const lightness = ((data.avgColor.r + data.avgColor.g + data.avgColor.b) / 3) * 0.1

      const mesh = new THREE.Mesh(this.imageFragmentGeometry, this.imageFragmentMaterial.clone())
      mesh.material.color.set(data.avgColor)
      mesh.material.color.convertSRGBToLinear()
      mesh.receiveShadow = true
      mesh.castShadow = true
      mesh.position.set(
        (sessor.sw / this.selectedImageData.width) * 2 - (1 - scaleW) / 2,
        -(sessor.sh / this.selectedImageData.height) * 2 + (1 - scaleH) / 2,
        lightness / 2,
      )
      mesh.scale.set(scaleW - 0.002, scaleH - 0.002, lightness)
      mesh.userData = { score: data.score * area ** 0.5, ...sessor }
      this.imageFragments.add(mesh)

      this.imageFragmentsHeap.push(mesh)
    })
  }

  private createObjects() {
    gl.scene.add(this.imageFragments)
    this.imageFragments.position.set(-0.5, 0.5, 0)

    this.createImageFragments(0, 0, this.selectedImageData.width, this.selectedImageData.height)
  }

  private addGui() {
    const updateImage = (key: string) => {
      this.readyAnimation = false

      this.selectedImageData = this.imageDatas[key]
      this.imageFragments.children.forEach((child) => {
        const mesh = child as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
        mesh.material.dispose()
        this.imageFragments.remove(mesh)
      })
      gl.scene.remove(this.imageFragments)
      this.imageFragmentsHeap.clear()
      this.imageFragments = new THREE.Group()
      this.createObjects()

      this.readyAnimation = true
    }

    const obj = {
      image1: () => updateImage('image1'),
      image2: () => updateImage('image2'),
      image3: () => updateImage('image3'),
    }

    const gui = new GUI()
    gui.add(obj, 'image1')
    gui.add(obj, 'image2')
    gui.add(obj, 'image3')
  }

  // ----------------------------------
  // animation
  private count = 0

  private anime = () => {
    if (this.imageFragments.children.length < 2000 && this.readyAnimation) {
      if (this.count % 2 === 0) {
        const maxScoreImageFragment = this.imageFragmentsHeap.pop()
        if (maxScoreImageFragment) {
          this.imageFragments.remove(maxScoreImageFragment)
          const { sw, sh, ew, eh } = maxScoreImageFragment.userData
          this.createImageFragments(sw, sh, ew, eh)
          maxScoreImageFragment.material.dispose()
        }

        this.count = 0
      }
      this.count++
    }

    controls.update()

    this.lights.quaternion.copy(gl.camera.quaternion)

    gl.render()
  }

  // ----------------------------------
  // dispose
  dispose() {
    gl.dispose()
  }
}
