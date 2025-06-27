// A simple seeded random number generator.
// You need to include the seedrandom library from a CDN for this to work.
// <script src="https://cdnjs.cloudflare.com/ajax/libs/seedrandom/3.0.5/seedrandom.min.js"></script>

/**
 * Generates a shuffled permutation array of 256 integers, based on a given seed.
 * @param {number} seed
 * @returns {Int32Array}
 */
function generatePermutation(seed) {
    const rng = new Math.seedrandom(seed);
    const p = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        p[i] = i;
    }
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    const perm = new Int32Array(512);
    perm.set(p);
    perm.set(p, 256);
    return perm;
}

/**
 * Easing function for smooth interpolation.
 * @param {number} t
 * @returns {number}
 */
function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerp(a, b, t) {
    return a + t * (b - a);
}

/**
 * Gradient vector dot product.
 * @param {number} hashVal
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function grad(hashVal, x, y) {
    const h = hashVal & 3;
    const u = h & 1 ? -x : x;
    const v = h & 2 ? -y : y;
    return u + v;
}

/**
 * Generates a single octave of Perlin noise.
 * @param {number} x
 * @param {number} y
 * @param {Int32Array} perm - Permutation table.
 * @returns {number}
 */
function perlinNoise(x, y, perm) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];

    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);

    return (lerp(x1, x2, v) + 1) / 2;
}

/**
 * Generates fractal (octave) Perlin noise.
 * @param {number} x
 * @param {number} y
 * @param {Int32Array} perm - Permutation table.
 * @param {number} octaves
 * @param {number} persistence
 * @returns {number}
 */
function octaveNoise(x, y, perm, octaves = 4, persistence = 0.5) {
    let total = 0.0;
    let frequency = 1.0;
    let amplitude = 1.0;
    let maxAmplitude = 0.0;

    for (let i = 0; i < octaves; i++) {
        total += perlinNoise(x * frequency, y * frequency, perm) * amplitude;
        maxAmplitude += amplitude;
        amplitude *= persistence;
        frequency *= 2;
    }

    return total / maxAmplitude;
}
