import type { App } from './types'
import { mapMixin } from './mixin'
import { importHtml } from './html-loader'
import { lifecycleCheck, reverse } from './util'

/**
 * load → bootstrap → mount → umount
 **/
export enum Status {
  // 未加载
  NOT_LOADED = 'NOT_LOADED',
  // 加载中
  LOADING = 'LOADING',
  // 加载完成 / 尚未启动
  NOT_BOOTSTRAPPED = 'NOT_BOOTSTRAPPED',
  // 启动中
  BOOTSTRAPPING = 'BOOTSTRAPPING',
  // 启动完成 / 尚未装载
  NOT_MOUNTED = 'NOT_MOUNTED',
  // 装载中
  MOUNTING = 'MOUNTING',
  // 装载完成
  MOUNTED = 'MOUNTED',
  UPDATING = 'UPDATING',
  UPDATED = 'UPDATED',
  // 卸载中
  UNMOUNTING = 'UNMOUNTING'
}

let started = false
const apps: any = new Set()

export function register(name: string, url: string, match: any): void {
  apps.add({
    name,
    url,
    match,
    status: Status.NOT_LOADED
  })
}

// 开始、启动
export function start(): void {
  started = true
  reroute()
}

function reroute(): Promise<void> {
  const { loads, mounts, unmounts } = getAppChanges()

  //
  return started ? perform() : init()

  // 初始化
  async function init(): Promise<void> {
    await Promise.all(loads.map(runLoad))
  }

  // 执行，运转
  async function perform(): Promise<void> {
    unmounts.map(runUnmount)

    loads.map(async (app) => {
      app = await runLoad(app)
      app = await runBootstrap(app)
      return runMount(app)
    })

    mounts.map(async (app) => {
      app = await runBootstrap(app)
      return runMount(app)
    })
  }
}

/**
 * 获取 apps 的变化，输出 loads/mounts/unmounts
 * 遍历 apps，根据 url 调整 loads/mounts/unmounts 生命周期下 app 的状态
 */
function getAppChanges(): {
  unmounts: App[]
  loads: App[]
  mounts: App[]
} {
  const unmounts: App[] = []
  const loads: App[] = []
  const mounts: App[] = []

  apps.forEach((app: any) => {
    // 判断 app 是否活跃
    const isActive: boolean = app.match(window.location)
    switch (app.status) {
      case Status.NOT_LOADED:
      case Status.LOADING:
        isActive && loads.push(app)
        break
      case Status.NOT_BOOTSTRAPPED:
      case Status.BOOTSTRAPPING:
      case Status.NOT_MOUNTED:
        isActive && mounts.push(app)
        break
      case Status.MOUNTED:
        !isActive && unmounts.push(app)
    }
  })
  return { unmounts, loads, mounts }
}

function compose(
  fns: ((app: App) => Promise<any>)[]
): (app: App) => Promise<void> {
  fns = Array.isArray(fns) ? fns : [fns]
  return (app: App): Promise<void> =>
    fns.reduce((p, fn) => p.then(() => fn(app)), Promise.resolve())
}

async function runLoad(app: App): Promise<any> {
  if (app.loaded) return app.loaded
  app.loaded = Promise.resolve().then(async () => {
    app.status = Status.LOADING
    let mixinLife = mapMixin()
    app.host = await loadShadowDOM(app)
    const { lifecycle: selfLife, bodyNode, styleNodes } = await importHtml(app)
    lifecycleCheck(selfLife)
    app.host?.appendChild(bodyNode.content.cloneNode(true))
    for (const k of reverse(styleNodes))
      app.host!.insertBefore(k, app.host!.firstChild)
    app.status = Status.NOT_BOOTSTRAPPED
    app.bootstrap = compose(mixinLife.bootstrap.concat(selfLife.bootstrap))
    app.mount = compose(mixinLife.mount.concat(selfLife.mount))
    app.unmount = compose(mixinLife.unmount.concat(selfLife.unmount))
    delete app.loaded
    return app
  })
  return app.loaded
}

function loadShadowDOM(app: App): Promise<DocumentFragment> {
  return new Promise((resolve, reject) => {
    class Berial extends HTMLElement {
      static get tag(): string {
        return app.name
      }
      constructor() {
        super()
        resolve(this.attachShadow({ mode: 'open' }))
      }
    }
    const hasDef = window.customElements.get(app.name)
    if (!hasDef) {
      customElements.define(app.name, Berial)
    }
  })
}

// 卸载子应用
async function runUnmount(app: App): Promise<App> {
  // 如果 app 未挂载则退出，只有已挂载的 app 才能卸载。
  if (app.status != Status.MOUNTED) {
    return app
  }
  // 标记 app 状态为 正在卸载
  app.status = Status.UNMOUNTING
  // 执行卸载
  await app.unmount(app)
  // 标记 app 状态为 NOT_MOUNTED
  app.status = Status.NOT_MOUNTED
  // 返回 app 状态
  return app
}

async function runBootstrap(app: App): Promise<App> {
  if (app.status !== Status.NOT_BOOTSTRAPPED) {
    return app
  }
  app.status = Status.BOOTSTRAPPING
  await app.bootstrap(app)
  app.status = Status.NOT_MOUNTED
  return app
}

async function runMount(app: App): Promise<App> {
  if (app.status !== Status.NOT_MOUNTED) {
    return app
  }
  app.status = Status.MOUNTING
  await app.mount(app)
  app.status = Status.MOUNTED
  return app
}

const captured = {
  hashchange: [],
  popstate: []
} as any

window.addEventListener('hashchange', reroute)
window.addEventListener('popstate', reroute)
const oldAEL = window.addEventListener
const oldREL = window.removeEventListener

window.addEventListener = function (name: any, fn: any): void {
  if (
    (name === 'hashchange' || name === 'popstate') &&
    !captured[name].some((l: any) => l == fn)
  ) {
    captured[name].push(fn)
    return
  }
  return oldAEL.apply(this, arguments as any)
}

window.removeEventListener = function (name: any, fn: any): void {
  if (name === 'hashchange' || name === 'popstate') {
    captured[name] = captured[name].filter((l: any) => l !== fn)
    return
  }
  return oldREL.apply(this, arguments as any)
}

function polyfillHistory(fn: any): () => void {
  return function (): void {
    const before = window.location.href
    fn.apply(window.history, arguments)
    const after = window.location.href
    if (before !== after) {
      new PopStateEvent('popstate')
      reroute()
    }
  }
}

window.history.pushState = polyfillHistory(window.history.pushState)
window.history.replaceState = polyfillHistory(window.history.replaceState)
