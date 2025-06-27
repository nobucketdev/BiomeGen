// Constants
const WIDTH = 500;
const HEIGHT = 250;

// Global variables
let BIOME_CONSTANTS = {};
let BIOME_NAMES = {};
let BIOME_COLORS = {};
let maps = {};
let currentSeed = 0;
let foundTiles = [];
let searchBiomeName = null;
let animationFrameId = null;
let canvases = {};
let contexts = {};
let tooltipDiv;

// Setup on DOM load
document.addEventListener('DOMContentLoaded', init);

async function init() {
    // Link UI
    const seedInput = document.getElementById('seedInput');
    const generateBtn = document.getElementById('generateBtn');
    const findInput = document.getElementById('findInput');
    const findBtn = document.getElementById('findBtn');
    const clearBtn = document.getElementById('clearBtn');
    tooltipDiv = document.getElementById('tooltip');

    // Prepare canvases
    const canvasIds = ['land', 'temp', 'humidity', 'height', 'biome'];
    canvases = {};
    contexts = {};
    for (const id of canvasIds) {
        const canvas = document.getElementById(`${id}Canvas`);
        canvases[id] = canvas;
        contexts[id] = canvas.getContext('2d');
    }

    await loadBiomeData(); // this should define BIOME_NAMES and BIOME_COLORS

    // Init first seed
    seedInput.value = Math.floor(Math.random() * 100000);
    regenerate(parseInt(seedInput.value));

    generateBtn.addEventListener('click', () => {
        regenerate(parseInt(seedInput.value));
    });

    findBtn.addEventListener('click', () => {
        const inputName = findInput.value.toLowerCase();
        const matched = Object.entries(BIOME_NAMES).filter(([id, name]) => name.toLowerCase().includes(inputName));

        if (matched.length === 1) {
            const [id, name] = matched[0];
            searchBiomeName = name;
            foundTiles = [];
            for (let y = 0; y < HEIGHT; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (maps.biome[y][x] == id) {
                        foundTiles.push({ x, y });
                    }
                }
            }
            console.log(`Found ${foundTiles.length} tiles for biome: ${name}`);
        } else if (matched.length > 1) {
            console.log("Multiple matches found. Please be more specific.");
            console.log(matched.map(([id, name]) => name).join(', '));
        } else {
            console.log("Biome not found.");
            foundTiles = [];
        }
    });

    clearBtn.addEventListener('click', () => {
        foundTiles = [];
        searchBiomeName = null;
        console.log("Highlight cleared.");
    });

    canvases.biome.addEventListener('mousemove', (e) => {
        const rect = canvases.biome.getBoundingClientRect();
        const x = Math.floor(e.clientX - rect.left);
        const y = Math.floor(e.clientY - rect.top);
        if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) {
            const biomeId = maps.biome[y][x];
            const biomeName = BIOME_NAMES[biomeId] || "unknown";
            const temp = maps.temp[y * WIDTH + x];
            const humid = maps.humidity[y * WIDTH + x];
            const height = maps.height[y * WIDTH + x];
            tooltipDiv.style.display = 'block';
            tooltipDiv.style.left = `${e.clientX + 10}px`;
            tooltipDiv.style.top = `${e.clientY + 10}px`;
            tooltipDiv.textContent = `${biomeName} | T:${temp.toFixed(2)} H:${humid.toFixed(2)} Z:${height.toFixed(2)}`;
        } else {
            tooltipDiv.style.display = 'none';
        }
    });

    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animate(0);
}

function regenerate(seed) {
    currentSeed = seed;
    console.log(`Generating maps with seed: ${seed}`);
    maps.land = generateMap(seed + 1, 48);
    maps.temp = generateMap(seed + 2, 64);
    maps.humidity = generateMap(seed + 3, 64);
    maps.height = generateMap(seed + 4, 20);

    maps.biome = generateBiomeMapFast(maps.land, maps.temp, maps.humidity, maps.height, WIDTH, HEIGHT);

    foundTiles = [];
    searchBiomeName = null;

    redrawMaps();
}

function generateMap(seed, scale = 64, octaves = 4, persistence = 0.5) {
    const perm = generatePermutation(seed);
    const data = new Float32Array(WIDTH * HEIGHT);
    let minVal = Infinity;
    let maxVal = -Infinity;

    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const nx = x / scale;
            const ny = y / scale;
            const val = octaveNoise(nx, ny, perm, octaves, persistence);
            data[y * WIDTH + x] = val;
            minVal = Math.min(minVal, val);
            maxVal = Math.max(maxVal, val);
        }
    }

    const range = maxVal - minVal;
    return range === 0
        ? new Float32Array(WIDTH * HEIGHT).fill(0.5)
        : data.map(val => (val - minVal) / range);
}

function drawGrayscaleMap(ctx, data) {
    const img = ctx.createImageData(WIDTH, HEIGHT);
    for (let i = 0; i < data.length; i++) {
        const v = data[i] * 255;
        const idx = i * 4;
        img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = v;
        img.data[idx + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
}

function drawBiomeMap(ctx, biomeMap) {
    const img = ctx.createImageData(WIDTH, HEIGHT);
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const id = biomeMap[y][x];
            const [r, g, b] = BIOME_COLORS[id] || [255, 0, 255]; // magenta for error
            const idx = (y * WIDTH + x) * 4;
            img.data[idx] = r;
            img.data[idx + 1] = g;
            img.data[idx + 2] = b;
            img.data[idx + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

function redrawMaps() {
    drawGrayscaleMap(contexts.land, maps.land);
    drawGrayscaleMap(contexts.temp, maps.temp);
    drawGrayscaleMap(contexts.humidity, maps.humidity);
    drawGrayscaleMap(contexts.height, maps.height);
    drawBiomeMap(contexts.biome, maps.biome);
}

function animate(time) {
    contexts.biome.clearRect(0, 0, WIDTH, HEIGHT);
    drawBiomeMap(contexts.biome, maps.biome);

    if (foundTiles.length > 0) {
        const alpha = Math.floor((Math.sin(time / 200) + 1) / 2 * 180 + 50);
        contexts.biome.fillStyle = `rgba(255, 255, 255, ${alpha / 255})`;
        for (const { x, y } of foundTiles) {
            contexts.biome.fillRect(x, y, 1, 1);
        }
    }

    animationFrameId = requestAnimationFrame(animate);
}
