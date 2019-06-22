declare module 'generatorics' {
  interface Generator {
    next(): string[];
  }

  interface Generatorics {
    baseNAll(values: string | string[]): Generator;
  }

  const _default: Generatorics;
  export default _default;
}
