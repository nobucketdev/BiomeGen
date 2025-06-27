// A global variable to store the biome data constants
let BIOME_CONSTANTS = {};
let BIOME_COLORS_MAP = {}; // To map ID to color array

// Dimensions of the noise maps and canvases
const WIDTH = 500;
const HEIGHT = 250;
const TOTAL_WIDTH = WIDTH * 2 + 100;
const TOTAL_HEIGHT = HEIGHT * 2 + 140;

// UI elements
const seedInput = document.getElementById('seedInput');
const generateBtn = document.getElementById('generateBtn');
const findInput = document.getElementById('findInput');
const findBtn = document.getElementById('findBtn');
const clearBtn = document.getElementById('clearBtn');
const tooltipDiv = document.getElementById('tooltip');

// Canvas contexts for drawing
const canvasIds = ['land', 'temp', 'humidity', 'height', 'biome'];
const canvases = {};
const contexts = {};
for (const id of canvasIds) {
    canvases[id] = document.getElementById(`${id}Canvas`);
    contexts[id] = canvases[id].getContext('2d');
}

let maps = {};
let currentSeed = 0;
let foundTiles = [];
let searchBiomeName = null;
let animationFrameId = null;

/**
 * Generates a normalized map from Perlin noise.
 * @param {number} seed
 * @param {number} scale
 * @param {number} octaves
 * @param {number} persistence
 * @returns {Float32Array}
 */
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
            if (val < minVal) minVal = val;
            if (val > maxVal) maxVal = val;
        }
    }

    if (maxVal - minVal === 0) {
        return new Float32Array(WIDTH * HEIGHT).fill(0.5);
    }
    
    // Normalize to 0-1 range
    const normalizedData = data.map(val => (val - minVal) / (maxVal - minVal));
    return normalizedData;
}

/**
 * Main function to generate all maps and biomes.
 * @param {number} seed
 */
function regenerate(seed) {
    currentSeed = seed;
    console.log(`Generating maps with seed: ${seed}`);
    
    // Generate all four noise maps
    maps.land = generateMap(seed + 1, 48);
    maps.temp = generateMap(seed + 2, 64);
    maps.humidity = generateMap(seed + 3, 64);
    maps.height = generateMap(seed + 4, 20);

    // Generate the biome map
    maps.biome = generateBiomeMapFast(maps.land, maps.temp, maps.humidity, maps.height, WIDTH, HEIGHT);
    
    // Clear found tiles and search name on regeneration
    foundTiles = [];
    searchBiomeName = null;

    redrawMaps();
}

/**
 * Draws a grayscale map on a canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Float32Array} data
 */
function drawGrayscaleMap(ctx, data) {
    const imageData = ctx.createImageData(WIDTH, HEIGHT);
    const pixels = imageData.data;
    for (let i = 0; i < data.length; i++) {
        const val = data[i] * 255;
        const index = i * 4;
        pixels[index] = val;
        pixels[index + 1] = val;
        pixels[index + 2] = val;
        pixels[index + 3] = 255; // Alpha
    }
    ctx.putImageData(imageData, 0, 0);
}

/**
 * Draws the colored biome map on a canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} biomeMap
 */
function drawBiomeMap(ctx, biomeMap) {
    const imageData = ctx.createImageData(WIDTH, HEIGHT);
    const pixels = imageData.data;
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const biomeId = biomeMap[y][x];
            const color = BIOME_COLORS[biomeId] || [255, 0, 255]; // Default to magenta for unknown biomes
            const index = (y * WIDTH + x) * 4;
            pixels[index] = color[0];
            pixels[index + 1] = color[1];
            pixels[index + 2] = color[2];
            pixels[index + 3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);
}

/**
 * Redraws all canvases.
 */
function redrawMaps() {
    drawGrayscaleMap(contexts.land, maps.land);
    drawGrayscaleMap(contexts.temp, maps.temp);
    drawGrayscaleMap(contexts.humidity, maps.humidity);
    drawGrayscaleMap(contexts.height, maps.height);
    drawBiomeMap(contexts.biome, maps.biome);
}

/**
 * Main animation loop for rendering.
 * @param {number} time
 */
function animate(time) {
    // Clear highlight layer
    contexts.biome.clearRect(0, 0, WIDTH, HEIGHT);
    drawBiomeMap(contexts.biome, maps.biome); // Redraw the base biome map

    // Draw highlights for found biomes
    if (foundTiles.length > 0) {
        const alpha = Math.floor((Math.sin(time / 200) + 1) / 2 * 180 + 50); // Glow effect
        contexts.biome.fillStyle = `rgba(255, 255, 255, ${alpha / 255})`;
        for (const { x, y } of foundTiles) {
            contexts.biome.fillRect(x, y, 1, 1);
        }
    }

    // Update tooltip
    const mousePos = { x: -1, y: -1 };
    const biomeCanvasRect = canvases.biome.getBoundingClientRect();
    canvases.biome.addEventListener('mousemove', (e) => {
        mousePos.x = Math.floor(e.clientX - biomeCanvasRect.left);
        mousePos.y = Math.floor(e.clientY - biomeCanvasRect.top);
    });

    if (mousePos.x >= 0 && mousePos.x < WIDTH && mousePos.y >= 0 && mousePos.y < HEIGHT) {
        const x = mousePos.x;
        const y = mousePos.y;
        
        if (maps.biome) {
            const biomeId = maps.biome[y][x];
            const biomeName = BIOME_NAMES[biomeId] || "unknown";
            const tempVal = maps.temp[y * WIDTH + x];
            const humidVal = maps.humidity[y * WIDTH + x];
            const heightVal = maps.height[y * WIDTH + x];

            tooltipDiv.style.display = 'block';
            tooltipDiv.textContent = `${biomeName} | T:${tempVal.toFixed(2)} H:${humidVal.toFixed(2)} Z:${heightVal.toFixed(2)}`;
            tooltipDiv.style.left = `${e.clientX + 10}px`;
            tooltipDiv.style.top = `${e.clientY + 10}px`;
        }
    } else {
        tooltipDiv.style.display = 'none';
    }

    animationFrameId = requestAnimationFrame(animate);
}

/**
 * Initializes the application.
 */
async function init() {
    await loadBiomeData(); // Load biome data from JSON first
    seedInput.value = Math.floor(Math.random() * 100000);
    regenerate(parseInt(seedInput.value));
    
    // Set up event listeners
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

    // Start the animation loop
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    animate(0);
}

// Start the application
document.addEventListener('DOMContentLoaded', init);
