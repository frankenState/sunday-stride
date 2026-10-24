import { useMemo } from 'react';

const VERSION = 5;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 108;
const ECC_CODEWORDS = 26;

function gfMultiply(left: number, right: number) {
  let result = 0;
  for (let bit = 7; bit >= 0; bit--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    if ((right >>> bit) & 1) result ^= left;
  }
  return result;
}

function errorCorrection(data: number[]) {
  let generator = [1];
  let root = 1;
  for (let i = 0; i < ECC_CODEWORDS; i++) {
    const next = Array(generator.length + 1).fill(0) as number[];
    generator.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= gfMultiply(coefficient, root);
    });
    generator = next;
    root = gfMultiply(root, 2);
  }
  const remainder = [...data, ...Array(ECC_CODEWORDS).fill(0)] as number[];
  for (let index = 0; index < data.length; index++) {
    const factor = remainder[index];
    if (factor) generator.forEach((coefficient, offset) => { remainder[index + offset] ^= gfMultiply(coefficient, factor); });
  }
  return remainder.slice(data.length);
}

function encodedCodewords(text: string) {
  const bytes = Array.from(text, (character) => character.charCodeAt(0));
  if (bytes.some((byte) => byte > 0x7f)) throw new Error('The share link must contain only ASCII characters.');
  if (bytes.length > 106) throw new Error('The share link is too long to encode as a QR code.');
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let bit = length - 1; bit >= 0; bit--) bits.push((value >>> bit) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, 8);
  bytes.forEach((byte) => append(byte, 8));
  for (let i = 0; i < Math.min(4, DATA_CODEWORDS * 8 - bits.length); i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  let pad = 0;
  while (data.length < DATA_CODEWORDS) data.push(pad++ % 2 === 0 ? 0xec : 0x11);
  return [...data, ...errorCorrection(data)];
}

function formatBits(mask: number) {
  const data = (0b01 << 3) | mask;
  let remainder = data << 10;
  for (let bit = 14; bit >= 10; bit--) if ((remainder >>> bit) & 1) remainder ^= 0x537 << (bit - 10);
  return ((data << 10) | remainder) ^ 0x5412;
}

function qrMatrix(text: string) {
  const modules = Array.from({ length: SIZE }, () => Array(SIZE).fill(false) as boolean[]);
  const reserved = Array.from({ length: SIZE }, () => Array(SIZE).fill(false) as boolean[]);
  const setFunction = (x: number, y: number, dark: boolean) => {
    if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) { modules[y][x] = dark; reserved[y][x] = true; }
  };
  const finder = (left: number, top: number) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const distance = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      setFunction(left + dx, top + dy, distance !== 2 && distance !== 4);
    }
  };
  finder(0, 0);
  finder(SIZE - 7, 0);
  finder(0, SIZE - 7);
  for (let index = 8; index < SIZE - 8; index++) {
    setFunction(index, 6, index % 2 === 0);
    setFunction(6, index, index % 2 === 0);
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    setFunction(SIZE - 7 + dx, SIZE - 7 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const reserveFormat = (x: number, y: number) => setFunction(x, y, false);
  for (let i = 0; i <= 5; i++) reserveFormat(8, i);
  reserveFormat(8, 7); reserveFormat(8, 8); reserveFormat(7, 8);
  for (let i = 9; i < 15; i++) reserveFormat(14 - i, 8);
  for (let i = 0; i < 8; i++) reserveFormat(SIZE - 1 - i, 8);
  for (let i = 8; i < 15; i++) reserveFormat(8, SIZE - 15 + i);
  setFunction(8, SIZE - 8, true);

  const codewords = encodedCodewords(text);
  let bitIndex = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < SIZE; vertical++) {
      const y = ((right + 1) & 2) === 0 ? SIZE - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        if (!reserved[y][x]) {
          const value = bitIndex < codewords.length * 8 ? ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1 : false;
          modules[y][x] = value !== ((x + y) % 2 === 0);
          bitIndex++;
        }
      }
    }
  }
  const bits = formatBits(0);
  for (let i = 0; i <= 5; i++) modules[i][8] = ((bits >>> i) & 1) !== 0;
  modules[7][8] = ((bits >>> 6) & 1) !== 0;
  modules[8][8] = ((bits >>> 7) & 1) !== 0;
  modules[8][7] = ((bits >>> 8) & 1) !== 0;
  for (let i = 9; i < 15; i++) modules[8][14 - i] = ((bits >>> i) & 1) !== 0;
  for (let i = 0; i < 8; i++) modules[8][SIZE - 1 - i] = ((bits >>> i) & 1) !== 0;
  for (let i = 8; i < 15; i++) modules[SIZE - 15 + i][8] = ((bits >>> i) & 1) !== 0;
  modules[SIZE - 8][8] = true;
  return modules;
}

export function QrCode({ value, size = 240 }: { value: string; size?: number }) {
  const matrix = useMemo(() => qrMatrix(value), [value]);
  const path = matrix.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + 4},${y + 4}h1v1h-1z`] : [])).join('');
  const viewSize = SIZE + 8;
  return <svg role="img" aria-label="QR code for leaderboard link" viewBox={`0 0 ${viewSize} ${viewSize}`} width={size} height={size} shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
    <rect width={viewSize} height={viewSize} fill="white" />
    <path d={path} fill="#101828" />
  </svg>;
}
