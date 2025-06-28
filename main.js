import * as nj from 'jsnumpy';
const WIDTH = 500;
const HEIGHT = 250;
const CANVAS_WIDTH = WIDTH * 2 + 100;
const CANVAS_HEIGHT = HEIGHT * 2 + 140;

const BIOME_IDS = {};
const BIOME_NAMES = {};
const BIOME_COLORS = {};
const BIOME_RULES = {};
let BASE_BIOMES = [];
let SPREADING_BIOMES = [];
let VARIANT_BIOMES = [];
let COASTLINE_BIOME = null;
let BEACH_BIOME = null;
let CORRUPTED_LAND = -1;

const canvas = document.getElementById('biomeCanvas');
const ctx = canvas.getContext('2d');
const regenerateBtn = document.getElementById('regenerateBtn');
const seedInput = document.getElementById('seedInput');
const findBiomeBtn = document.getElementById('findBiomeBtn');
const clearHighlightBtn = document.getElementById('clearHighlightBtn');
const biomeSearchInput = document.getElementById('biomeSearchInput');
const tooltip = document.getElementById('tooltip');
const highlightStatus = document.getElementById('highlightStatus');

let maps = {};
let foundTiles = [];
let highlightAlpha = 0;
let highlightDirection = 1;
let animationFrameId;
let currentSeed;
let searchBiomeName = null;

// === Perlin Noise Implementation ===
// This part is a direct port from perlin.py, but without numba and numpy optimizations.
// You might want to use a dedicated library like 'simplex-noise' for better performance.
const p = new Uint8Array(512);
let perm;

function generatePermutation(seed) {
    const permTable = [];
    for (let i = 0; i < 256; i++) {
        permTable[i] = i;
    }
    const rng = new Math.seedrandom(seed); // Using a seeded random number generator
    for (let i = 0; i < 255; i++) {
        const j = Math.floor(rng() * (256 - i)) + i;
        [permTable[i], permTable[j]] = [permTable[j], permTable[i]];
    }
    for (let i = 0; i < 256; i++) {
        p[i] = p[i + 256] = permTable[i];
    }
    perm = p;
}

function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
    return a + t * (b - a);
}

function grad(hash, x, y) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function perlinNoise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);

    const u = fade(x);
    const v = fade(y);

    const AA = perm[perm[X] + Y];
    const AB = perm[perm[X] + Y + 1];
    const BA = perm[perm[X + 1] + Y];
    const BB = perm[perm[X + 1] + Y + 1];

    const x1 = lerp(grad(AA, x, y), grad(BA, x - 1, y), u);
    const x2 = lerp(grad(AB, x, y - 1), grad(BB, x - 1, y - 1), u);

    return (lerp(x1, x2, v) + 1) / 2;
}

function octaveNoise(x, y, octaves, persistence) {
    let total = 0;
    let maxVal = 0;
    let amplitude = 1;
    let frequency = 1;

    for (let i = 0; i < octaves; i++) {
        total += perlinNoise(x * frequency, y * frequency) * amplitude;
        maxVal += amplitude;
        amplitude *= persistence;
        frequency *= 2;
    }
    return total / maxVal;
}

// === Biome Data Logic ===
async function loadBiomeData() {
    try {
        const response = await fetch('biomes.json');
        const data = await response.json();
        
        data.biomes.forEach(b => {
            BIOME_IDS[b.name] = b.id;
            BIOME_NAMES[b.id] = b.name;
            BIOME_COLORS[b.id] = b.color;
            BIOME_RULES[b.id] = b.rules;

            if (!b.base) {
                BASE_BIOMES.push(b.id);
            }
            if (b.random_chance) {
                SPREADING_BIOMES.push(b.id);
            }
            if (b.base) {
                VARIANT_BIOMES.push(b.id);
            }
        });

        COASTLINE_BIOME = BIOME_IDS['coastline'];
        BEACH_BIOME = BIOME_IDS['beach'];
        CORRUPTED_LAND = BIOME_IDS['corrupted_land'];

    } catch (error) {
        console.error('Error loading biomes.json:', error);
    }
}

function parseCondition(expr) {
    expr = expr.trim();
    if (expr.includes('..')) {
        const [lo, hi] = expr.split('..').map(parseFloat);
        return v => v >= lo && v <= hi;
    } else if (expr.startsWith('>=')) {
        const val = parseFloat(expr.substring(2));
        return v => v >= val;
    } else if (expr.startsWith('<=')) {
        const val = parseFloat(expr.substring(2));
        return v => v <= val;
    } else if (expr.startsWith('>')) {
        const val = parseFloat(expr.substring(1));
        return v => v > val;
    } else if (expr.startsWith('<')) {
        const val = parseFloat(expr.substring(1));
        return v => v < val;
    }
    return () => true;
}

function isWater(biomeId) {
    return BIOME_NAMES[biomeId] && BIOME_NAMES[biomeId].includes('ocean');
}

function classifyBiomeFast(land, temp, humidity, height) {
    for (const biomeId of BASE_BIOMES) {
        let matched = true;
        const rules = BIOME_RULES[biomeId];
        if (rules) {
            for (const rule of rules) {
                const [key, expr] = Object.entries(rule)[0];
                const condition = parseCondition(expr);
                if (key === 'land' && !condition(land)) matched = false;
                if (key === 'temp' && !condition(temp)) matched = false;
                if (key === 'humidity' && !condition(humidity)) matched = false;
                if (key === 'height' && !condition(height)) matched = false;
                if (!matched) break;
            }
        }
        if (matched) return biomeId;
    }
    return -1; // Should not happen
}

function applyBiomeVariants(biomeMap, waterMap, landMap) {
    const newMap = nj.copy(biomeMap);
    for (let x = 0; x < WIDTH; x++) {
        for (let y = 0; y < HEIGHT; y++) {
            const biomeId = biomeMap.get(x, y);
            const biomeName = BIOME_NAMES[biomeId];

            if (biomeName) {
                // Check for oasis variant
                if (biomeName.includes('temperate_desert')) {
                    const oasisId = BIOME_IDS['desert#oasis'];
                    const oasisRules = BIOME_RULES[oasisId];
                    if (oasisRules) {
                        const waterRule = oasisRules.find(r => r.water);
                        if (waterRule) {
                            const maxDist = parseInt(waterRule.water.split(' ')[1]);
                            if (isWaterWithinDistance(waterMap, x, y, maxDist)) {
                                if (Math.random() < 0.65) {
                                    newMap.set(oasisId, x, y);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return newMap;
}

function isWaterWithinDistance(waterMap, x, y, distance) {
    for (let dx = -distance; dx <= distance; dx++) {
        for (let dy = -distance; dy <= distance; dy++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) {
                if (isWater(waterMap.get(nx, ny))) {
                    return true;
                }
            }
        }
    }
    return false;
}

function calculateDistanceFromLand(landMap) {
    // This is a placeholder for the scipy.ndimage.distance_transform_edt function.
    // This is a complex algorithm that needs a dedicated library or a complex custom implementation.
    // A simple implementation for demonstration purposes can be very slow.
    // I will return a placeholder map for now.
    console.warn("`calculateDistanceFromLand` is a placeholder. You need to implement a distance transform algorithm or use a specialized library.");
    return nj.zeros([WIDTH, HEIGHT]);
}

function generateBiomeMapFast(landMap, tempMap, humidityMap, heightMap) {
    const biomeMap = nj.zeros([WIDTH, HEIGHT], 'int32');
    for (let x = 0; x < WIDTH; x++) {
        for (let y = 0; y < HEIGHT; y++) {
            const biomeId = classifyBiomeFast(
                landMap.get(x, y),
                tempMap.get(x, y),
                humidityMap.get(x, y),
                heightMap.get(x, y)
            );
            biomeMap.set(biomeId, x, y);
        }
    }
    
    // Apply coastline and beach based on land value.
    for (let x = 0; x < WIDTH; x++) {
        for (let y = 0; y < HEIGHT; y++) {
            if (landMap.get(x, y) < 0.2) {
                if (landMap.get(x, y) < 0.1) {
                    // Deep ocean check
                    biomeMap.set(BIOME_IDS['deep_ocean'], x, y);
                } else {
                    biomeMap.set(BIOME_IDS['ocean'], x, y);
                }
                
                // Check for coastline
                let isNearLand = false;
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) {
                            if (landMap.get(nx, ny) >= 0.25) { // Threshold for land
                                isNearLand = true;
                                break;
                            }
                        }
                    }
                    if (isNearLand) break;
                }
                if (isNearLand) {
                    biomeMap.set(COASTLINE_BIOME, x, y);
                }
            }
        }
    }

    // Apply spreading biomes (jungle, mangrove, corrupted land)
    // This needs to be implemented. A simple approach is to iterate and check neighbors.
    // This is a simplified version and needs to be refined to match the Python logic.
    let spreadingMap = nj.copy(biomeMap);
    for (let x = 0; x < WIDTH; x++) {
        for (let y = 0; y < HEIGHT; y++) {
            if (spreadingMap.get(x, y) === BIOME_IDS['jungle#bamboo']) {
                if (Math.random() < 0.2) { // 20% chance to spread
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && biomeMap.get(nx, ny) === BIOME_IDS['jungle']) {
                                spreadingMap.set(BIOME_IDS['jungle#bamboo'], nx, ny);
                            }
                        }
                    }
                }
            }
        }
    }
    biomeMap.assign(spreadingMap);

    // Apply biome variants
    const waterMap = nj.zeros([WIDTH, HEIGHT], 'int32');
    for (let x = 0; x < WIDTH; x++) {
        for (let y = 0; y < HEIGHT; y++) {
            if (isWater(biomeMap.get(x, y))) {
                waterMap.set(1, x, y);
            }
        }
    }
    const landDistanceMap = calculateDistanceFromLand(landMap); // Placeholder
    
    return applyBiomeVariants(biomeMap, waterMap, landDistanceMap);
}


function generateMap(seed, scale = 64, octaves = 4, persistence = 0.5) {
    const data = nj.zeros([WIDTH, HEIGHT], 'float32');
    generatePermutation(seed);
    for (let x = 0; x < WIDTH; x++) {
        for (let y = 0; y < HEIGHT; y++) {
            const nx = x / scale;
            const ny = y / scale;
            data.set(octaveNoise(nx, ny, octaves, persistence), x, y);
        }
    }
    const minVal = nj.min(data);
    const maxVal = nj.max(data);
    if (maxVal - minVal === 0) return nj.zeros([WIDTH, HEIGHT]);
    return nj.divide(nj.subtract(data, minVal), maxVal - minVal);
}

function regenerate(seed) {
    console.log(`Generating maps with seed: ${seed}`);
    const permSeed = seed + 1; // Different seeds for different maps
    maps.land = generateMap(permSeed + 1, 48);
    maps.temp = generateMap(permSeed + 2, 64);
    maps.humidity = generateMap(permSeed + 3, 64);
    maps.height = generateMap(permSeed + 4, 20);
    maps.biome = generateBiomeMapFast(maps.land, maps.temp, maps.humidity, maps.height);
    console.log('Map generation complete.');
}

function drawMap(data, mapX, mapY, title, showValues = true) {
    const mapWidth = WIDTH;
    const mapHeight = HEIGHT;
    const imageData = ctx.createImageData(mapWidth, mapHeight);
    const pixels = imageData.data;
    
    for (let x = 0; x < mapWidth; x++) {
        for (let y = 0; y < mapHeight; y++) {
            const i = (y * mapWidth + x) * 4;
            const value = data.get(x, y);
            const color = showValues ? Math.floor(value * 255) : BIOME_COLORS[value][0];
            pixels[i] = color;
            pixels[i + 1] = color;
            pixels[i + 2] = color;
            pixels[i + 3] = 255;
        }
    }
    ctx.putImageData(imageData, mapX, mapY);
    
    ctx.fillStyle = 'black';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(title, mapX + mapWidth / 2, mapY - 5);
}

function drawBiomeMap(biomeMap) {
    const mapX = 0;
    const mapY = HEIGHT + 40;
    const mapWidth = WIDTH * 2;
    const mapHeight = HEIGHT;
    const imageData = ctx.createImageData(mapWidth, mapHeight);
    const pixels = imageData.data;

    for (let x = 0; x < mapWidth; x++) {
        for (let y = 0; y < mapHeight; y++) {
            const i = (y * mapWidth + x) * 4;
            const biomeId = biomeMap.get(x, y);
            const color = BIOME_COLORS[biomeId];
            if (color) {
                pixels[i] = color[0];
                pixels[i + 1] = color[1];
                pixels[i + 2] = color[2];
                pixels[i + 3] = 255;
            } else {
                pixels[i] = 0;
                pixels[i + 1] = 0;
                pixels[i + 2] = 0;
                pixels[i + 3] = 255;
            }
        }
    }
    ctx.putImageData(imageData, mapX, mapY);
    
    ctx.fillStyle = 'black';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Biome Map', mapX + mapWidth / 2, mapY - 5);
}

function findBiomeTiles(biomeMap, biomeId) {
    const tiles = [];
    for (let x = 0; x < WIDTH * 2; x++) {
        for (let y = 0; y < HEIGHT; y++) {
            if (biomeMap.get(x, y) === biomeId) {
                tiles.push([x, y]);
            }
        }
    }
    return tiles;
}

function drawHighlight(x, y, alpha) {
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(x, y + HEIGHT + 40, 1, 1);
}

function animateHighlight() {
    ctx.clearRect(0, HEIGHT + 40, WIDTH * 2, HEIGHT);
    drawBiomeMap(maps.biome);

    if (foundTiles.length > 0) {
        highlightAlpha += highlightDirection * 0.05;
        if (highlightAlpha >= 1) {
            highlightAlpha = 1;
            highlightDirection = -1;
        } else if (highlightAlpha <= 0) {
            highlightAlpha = 0;
            highlightDirection = 1;
        }
        foundTiles.forEach(tile => drawHighlight(tile[0], tile[1], highlightAlpha));
    }

    animationFrameId = requestAnimationFrame(animateHighlight);
}

function drawAllMaps() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawMap(maps.land, 0, 20, 'Land');
    drawMap(maps.temp, WIDTH + 50, 20, 'Temperature');
    drawMap(maps.humidity, 0, HEIGHT + 60, 'Humidity');
    drawMap(maps.height, WIDTH + 50, HEIGHT + 60, 'Height');
    drawBiomeMap(maps.biome);
}

function mainLoop() {
    drawAllMaps();
    animationFrameId = requestAnimationFrame(mainLoop);
}

async function init() {
    await loadBiomeData();
    seedInput.value = Math.floor(Math.random() * 10000);
    regenerate(parseInt(seedInput.value));
    
    // Draw all maps initially
    drawAllMaps();
    animateHighlight(); // Start the animation loop

    regenerateBtn.addEventListener('click', () => {
        const seed = seedInput.value ? parseInt(seedInput.value) : Math.floor(Math.random() * 10000);
        seedInput.value = seed;
        regenerate(seed);
        foundTiles = [];
        searchBiomeName = null;
        highlightStatus.textContent = '';
        drawAllMaps();
    });

    findBiomeBtn.addEventListener('click', () => {
        const query = biomeSearchInput.value.toLowerCase();
        const matched = Object.entries(BIOME_IDS).filter(([name, id]) => name.includes(query));
        
        if (matched.length > 0) {
            const [matchedName, matchedId] = matched[0];
            searchBiomeName = matchedName;
            foundTiles = findBiomeTiles(maps.biome, matchedId);
            highlightStatus.textContent = `Found ${foundTiles.length} tiles for biome: ${searchBiomeName}`;
        } else {
            foundTiles = [];
            searchBiomeName = null;
            highlightStatus.textContent = 'Biome not found.';
        }
    });

    clearHighlightBtn.addEventListener('click', () => {
        foundTiles = [];
        searchBiomeName = null;
        highlightStatus.textContent = '';
    });

    canvas.addEventListener('mousemove', (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        if (x >= 0 && x < WIDTH * 2 && y >= HEIGHT + 40 && y < HEIGHT * 2 + 40) {
            const mapX = x;
            const mapY = y - (HEIGHT + 40);

            const biomeId = maps.biome.get(mapX, mapY);
            const biomeName = BIOME_NAMES[biomeId] || 'Unknown';
            const land = maps.land.get(mapX, mapY).toFixed(2);
            const temp = maps.temp.get(mapX, mapY).toFixed(2);
            const humidity = maps.humidity.get(mapX, mapY).toFixed(2);
            const height = maps.height.get(mapX, mapY).toFixed(2);

            tooltip.style.opacity = 1;
            tooltip.style.left = `${event.pageX + 10}px`;
            tooltip.style.top = `${event.pageY + 10}px`;
            tooltip.textContent = `Biome: ${biomeName}\nLand: ${land}\nTemp: ${temp}\nHumidity: ${humidity}\nHeight: ${height}`;
        } else {
            tooltip.style.opacity = 0;
        }
    });

    canvas.addEventListener('mouseout', () => {
        tooltip.style.opacity = 0;
    });

    // Seedrandom is not a built-in library, you will need to add it to your HTML or use another seedable RNG.
    // For example: <script src="https://cdnjs.cloudflare.com/ajax/libs/seedrandom/3.0.5/seedrandom.min.js"></script>
}

init();