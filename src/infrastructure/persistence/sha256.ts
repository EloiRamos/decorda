/* eslint-disable no-bitwise */
const INITIAL_HASH = [
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
] as const;

const ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, distance: number): number {
  return (value >>> distance) | (value << (32 - distance));
}

function encodeUtf8(input: string): Uint8Array {
  const bytes: number[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const code_unit = input.charCodeAt(index);
    let code_point = code_unit;

    if (code_unit >= 0xd800 && code_unit <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code_point =
          0x10000 + ((code_unit - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        code_point = 0xfffd;
      }
    } else if (code_unit >= 0xdc00 && code_unit <= 0xdfff) {
      code_point = 0xfffd;
    }

    if (code_point <= 0x7f) {
      bytes.push(code_point);
    } else if (code_point <= 0x7ff) {
      bytes.push(0xc0 | (code_point >>> 6));
      bytes.push(0x80 | (code_point & 0x3f));
    } else if (code_point <= 0xffff) {
      bytes.push(0xe0 | (code_point >>> 12));
      bytes.push(0x80 | ((code_point >>> 6) & 0x3f));
      bytes.push(0x80 | (code_point & 0x3f));
    } else {
      bytes.push(0xf0 | (code_point >>> 18));
      bytes.push(0x80 | ((code_point >>> 12) & 0x3f));
      bytes.push(0x80 | ((code_point >>> 6) & 0x3f));
      bytes.push(0x80 | (code_point & 0x3f));
    }
  }

  return Uint8Array.from(bytes);
}

function sha256(bytes: Uint8Array): Uint8Array {
  const padded_length = Math.ceil((bytes.length + 9) / 64) * 64;
  const message = new Uint8Array(padded_length);
  message.set(bytes);
  message[bytes.length] = 0x80;

  const bit_length_high = Math.floor(bytes.length / 0x20000000) >>> 0;
  const bit_length_low = (bytes.length << 3) >>> 0;
  const length_offset = padded_length - 8;
  message[length_offset] = bit_length_high >>> 24;
  message[length_offset + 1] = bit_length_high >>> 16;
  message[length_offset + 2] = bit_length_high >>> 8;
  message[length_offset + 3] = bit_length_high;
  message[length_offset + 4] = bit_length_low >>> 24;
  message[length_offset + 5] = bit_length_low >>> 16;
  message[length_offset + 6] = bit_length_low >>> 8;
  message[length_offset + 7] = bit_length_low;

  const hash: number[] = [...INITIAL_HASH];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const word_offset = offset + index * 4;
      words[index] =
        ((message[word_offset] << 24) |
          (message[word_offset + 1] << 16) |
          (message[word_offset + 2] << 8) |
          message[word_offset + 3]) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous_15 = words[index - 15];
      const previous_2 = words[index - 2];
      const sigma0 =
        rotateRight(previous_15, 7) ^
        rotateRight(previous_15, 18) ^
        (previous_15 >>> 3);
      const sigma1 =
        rotateRight(previous_2, 17) ^
        rotateRight(previous_2, 19) ^
        (previous_2 >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 =
        (h + sum1 + choose + ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  hash.forEach((word, index) => {
    const offset = index * 4;
    digest[offset] = word >>> 24;
    digest[offset + 1] = word >>> 16;
    digest[offset + 2] = word >>> 8;
    digest[offset + 3] = word;
  });
  return digest;
}

export function sha256HexUtf8(input: string): string {
  return Array.from(sha256(encodeUtf8(input)), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
