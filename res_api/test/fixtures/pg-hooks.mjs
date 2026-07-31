// 模块解析钩子：把 'postgres' 换成 test/fixtures/fake-postgres.mjs。
// 只在测试进程里通过 --import pg-preload.mjs 注册，生产路径一行不改。
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'postgres') {
    return nextResolve(new URL('./fake-postgres.mjs', import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}
