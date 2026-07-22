declare module "utif2" {
  interface IFD {
    width?: number;
    height?: number;
    data?: Uint8Array;
    [key: string]: unknown;
  }
  export function decode(buffer: Buffer | ArrayBuffer | Uint8Array): IFD[];
  export function decodeImage(buffer: Buffer | ArrayBuffer | Uint8Array, ifd: IFD): void;
}
