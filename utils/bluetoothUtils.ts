
export const ESC_INIT = new Uint8Array([0x1B, 0x40]);
export const ESC_ALIGN_CENTER = new Uint8Array([0x1B, 0x61, 0x01]);
export const ESC_ALIGN_LEFT = new Uint8Array([0x1B, 0x61, 0x00]);
export const ESC_BOLD_ON = new Uint8Array([0x1B, 0x45, 0x01]);
export const ESC_BOLD_OFF = new Uint8Array([0x1B, 0x45, 0x00]);
export const ESC_FEED = new Uint8Array([0x0A]);

// Font sizing commands
export const FONT_SIZE_NORMAL = new Uint8Array([0x1D, 0x21, 0x00]);
export const FONT_SIZE_DOUBLE_HEIGHT = new Uint8Array([0x1D, 0x21, 0x01]);
export const FONT_SIZE_DOUBLE_WIDTH = new Uint8Array([0x1D, 0x21, 0x10]);
export const FONT_SIZE_LARGE = new Uint8Array([0x1D, 0x21, 0x11]);

export function textToBytes(text: string) {
  const encoder = new TextEncoder();
  return encoder.encode(text + '\n');
}

export async function sendDataToPrinter(
  characteristic: any, 
  data: Uint8Array
) {
  const maxChunk = 20; 
  for (let i = 0; i < data.byteLength; i += maxChunk) {
    const chunk = data.slice(i, i + maxChunk);
    await characteristic.writeValue(chunk);
  }
}

export function getSeparator(width: '58mm' | '80mm'): string {
  return width === '58mm' ? '-'.repeat(32) : '-'.repeat(42);
}
