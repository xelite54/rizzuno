import "node:test"
// Node 24 supports this documented API, but @types/node 24.13.x still omits it.
// https://nodejs.org/docs/latest-v24.x/api/test.html#mockmodulespecifier-options
// Remove when upstream definitions include exports. This adds the real shape;
// it does not suppress type checking or change mock behavior.
declare module "node:test" {
  interface MockModuleOptions {
    exports?: Record<string, unknown>
  }
}
