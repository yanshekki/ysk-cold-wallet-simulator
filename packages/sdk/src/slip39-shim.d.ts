declare module 'slip39' {
  interface Slip39Node {
    mnemonic: string;
    mnemonics: string[];
    fromPath(path: string): Slip39Node;
  }

  interface Slip39Static {
    fromArray(
      masterSecret: number[] | Uint8Array,
      options?: {
        passphrase?: string;
        threshold?: number;
        groups?: (number | string)[][];
        iterationExponent?: number;
        extendableBackupFlag?: number;
        title?: string;
      },
    ): Slip39Node;
    recoverSecret(shares: string[], passphrase?: string): number[] | Uint8Array;
    validateMnemonic(mnemonic: string): boolean;
  }

  const Slip39: Slip39Static;
  export default Slip39;
}
