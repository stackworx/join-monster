declare module 'generatorics' {
  interface Generatorics {
    baseNAll(opts: string): Mininym;
  }

  export interface Mininym {
    next(): {
      value: string[];
    };
  }

  const _default: Generatorics;
  export default _default;
}
