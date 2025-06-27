let BIOME_IDS = {};
let BIOME_NAMES = {};
let BIOME_COLORS = [];
let WATER_BIOME_IDS = new Set();
let NO_COAST_BIOME_IDS = new Set();
let WATER_BIOME_IDS_WITH_COAST = new Set();
let base_biomes = [];
let variant_biomes = [];

const BIOME_CONSTANTS = {};

/**
 * Fetches and parses biome data from a JSON file.
 * @returns {Promise<void>}
 */
async function loadBiomeData() {
    const response = await fetch('biomes.json');
    const data = await response.json();

    BIOME_IDS = {};
    BIOME_NAMES = {};
    for (const b of data.biomes) {
        BIOME_IDS[b.name] = b.id;
        BIOME_NAMES[b.id] = b.name;
        // Auto create constants (like in Python)
        BIOME_CONSTANTS[b.name.toUpperCase().replace(/#|-/g, '_')] = b.id;
    }
    
    // Set a global object for constants, so they can be accessed easily
    Object.assign(window, BIOME_CONSTANTS);
    
    // Get max ID to initialize color array
    const maxId = Math.max(...Object.values(BIOME_IDS));
    BIOME_COLORS = new Array(maxId + 1);
    for (const b of data.biomes) {
        BIOME_COLORS[b.id] = b.color;
    }
    
    base_biomes = [];
    variant_biomes = [];
    WATER_BIOME_IDS.clear();
    
    for (const b of data.biomes) {
        const rule_funcs = [];
        for (const rule of b.rules || []) {
            for (const key in rule) {
                rule_funcs.push({ key, func: parseCondition(rule[key]) });
            }
        }
        const record = {
            id: b.id,
            name: b.name,
            rules: rule_funcs,
            random_chance: b.random_chance || 0,
            ...b // Copy other properties
        };
        
        if (b.base) {
            variant_biomes.push(record);
        } else {
            base_biomes.push(record);
        }

        if (b.water) {
            WATER_BIOME_IDS.add(b.id);
        }
    }
    
    NO_COAST_BIOME_IDS = new Set([
        BIOME_IDS.deep_ocean,
        BIOME_IDS.frozen_ocean,
        BIOME_IDS.swamp_ocean,
    ].filter(id => id !== undefined));

    WATER_BIOME_IDS_WITH_COAST = new Set([...WATER_BIOME_IDS].filter(id => !NO_COAST_BIOME_IDS.has(id)));

    console.log("Biome data loaded successfully.");
}

/**
 * Parses a string condition (e.g., "> 0.5", "0.3..0.7") into a function.
 * @param {string} expr
 * @returns {Function}
 */
function parseCondition(expr) {
    expr = expr.trim();
    if (expr.includes("..")) {
        const [lo, hi] = expr.split("..").map(Number);
        return v => v >= lo && v <= hi;
    } else if (expr.startsWith(">=")) {
        const val = parseFloat(expr.slice(2));
        return v => v >= val;
    } else if (expr.startsWith("<=")) {
        const val = parseFloat(expr.slice(2));
        return v => v <= val;
    } else if (expr.startsWith(">")) {
        const val = parseFloat(expr.slice(1));
        return v => v > val;
    } else if (expr.startsWith("<")) {
        const val = parseFloat(expr.slice(1));
        return v => v < val;
    } else if (expr.startsWith("==")) {
        const val = parseFloat(expr.slice(2));
        return v => v === val;
    } else {
        const val = parseFloat(expr);
        return v => v === val;
    }
}

/**
 * Classifies a point into a base biome based on environmental values.
 * @param {number} land
 * @param {number} temp
 * @param {number} humidity
 * @param {number} height
 * @returns {number} The biome ID.
 */
function classifyBiomeFast(land, temp, humidity, height) {
    const finalHeight = (land + height * 2) / 2.72;
    const finalLand = (land * 2 + finalHeight) / 2.72;

    const env = {
        "land": finalLand,
        "temp": temp,
        "humidity": humidity,
        "height": finalHeight
    };

    for (const b of base_biomes) {
        let rulesMatch = true;
        for (const { key, func } of b.rules) {
            if (!func(env[key])) {
                rulesMatch = false;
                break;
            }
        }
        if (rulesMatch) {
            if (b.random_chance === 0 || Math.random() < b.random_chance) {
                return b.id;
            }
        }
    }
    
    return BIOME_IDS.plains;
}

/**
 * Calculates the Euclidean distance transform for a given land map.
 * This is a simplified BFS-based implementation to replace scipy.ndimage.distance_transform_edt.
 * @param {boolean[][]} landMap
 * @returns {Float32Array}
 */
function calculateDistanceFromLand(landMap, width, height) {
    const distMap = new Float32Array(width * height).fill(Infinity);
    const queue = [];

    // Initialize queue with all water pixels
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!landMap[y][x]) { // water
                distMap[y * width + x] = 0;
                queue.push({ x, y });
            }
        }
    }
    
    let head = 0;
    while (head < queue.length) {
        const { x, y } = queue[head++];
        const currentDist = distMap[y * width + x];

        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const newDist = currentDist + 1;
                if (newDist < distMap[ny * width + nx]) {
                    distMap[ny * width + nx] = newDist;
                    queue.push({ x: nx, y: ny });
                }
            }
        }
    }

    return distMap;
}

/**
 * Checks if there's a water biome within a given distance.
 * @param {number[][]} biomeMap
 * @param {number} x
 * @param {number} y
 * @param {number} maxDist
 * @param {number} width
 * @param {number} height
 * @returns {boolean}
 */
function isWaterWithinDistance(biomeMap, x, y, maxDist, width, height) {
    for (let dy = -maxDist; dy <= maxDist; dy++) {
        for (let dx = -maxDist; dx <= maxDist; dx++) {
            if (dx * dx + dy * dy > maxDist * maxDist) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                if (WATER_BIOME_IDS.has(biomeMap[ny][nx])) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Applies biome variants (e.g., oasis, blue ice) to the biome map.
 * @param {number[][]} biomeMap
 * @param {number[]} temp
 * @param {number[]} humidity
 * @param {number[]} height
 * @param {number[]} land
 * @param {Float32Array} distMap - Distance from land map.
 * @param {number} width
 * @param {number} height
 * @returns {number[][]}
 */
function applyBiomeVariants(biomeMap, temp, humidity, height, land, distMap, width, height) {
    const newMap = biomeMap.map(row => [...row]); // Deep copy

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const baseId = biomeMap[y][x];
            const baseName = BIOME_NAMES[baseId];
            if (!baseName) continue;

            for (const variant of variant_biomes) {
                if (variant.base !== baseName) continue;

                // Check environmental rules
                let rulesMatch = true;
                const env = {
                    "temp": temp[y * width + x],
                    "humidity": humidity[y * width + x],
                    "height": height[y * width + x],
                    "land": land[y * width + x]
                };

                for (const { key, func } of variant.rules || []) {
                    if (!func(env[key])) {
                        rulesMatch = false;
                        break;
                    }
                }
                if (!rulesMatch) continue;

                // Check water proximity
                if (variant.max_distance_from_water !== undefined) {
                    if (!isWaterWithinDistance(biomeMap, x, y, variant.max_distance_from_water, width, height)) {
                        continue;
                    }
                }

                // Check min distance from land
                if (variant.min_distance_from_land !== undefined && distMap) {
                    if (distMap[y * width + x] < variant.min_distance_from_land) {
                        continue;
                    }
                }

                // Random chance
                if (variant.random_chance > 0 && Math.random() >= variant.random_chance) {
                    continue;
                }

                newMap[y][x] = variant.id;
                break; // Apply the first matched variant
            }
        }
    }

    return newMap;
}

/**
 * Spreads jungle and mangrove biomes into adjacent suitable areas.
 * @param {number[][]} biomeMap
 * @param {Float32Array} temp
 * @param {Float32Array} humidity
 * @param {Float32Array} height
 * @param {number} width
 * @param {number} height
 * @returns {number[][]}
 */
function spreadJungleAndMangrove(biomeMap, temp, humidity, height, width, height) {
    const newMap = biomeMap.map(row => [...row]);
    const JUNGLE = BIOME_IDS.jungle;
    const MANGROVE_SWAMP = BIOME_IDS.mangrove_swamp;

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    const neighborBiome = biomeMap[ny][nx];

                    if (neighborBiome === JUNGLE || neighborBiome === MANGROVE_SWAMP) {
                        const idx = y * width + x;
                        if (temp[idx] > 0.5 && humidity[idx] > 0.6 && height[idx] < 0.55) {
                            newMap[y][x] = neighborBiome;
                        }
                    }
                }
            }
        }
    }
    return newMap;
}

/**
 * Spreads the corrupted land biome.
 * @param {number[][]} biomeMap
 * @param {number} width
 * @param {number} height
 * @param {number} iterations
 * @returns {number[][]}
 */
function spreadCorruptedLand(biomeMap, width, height, iterations = 4) {
    let currentMap = biomeMap.map(row => [...row]);
    const CORRUPTED_LAND = BIOME_IDS.corrupted_land;

    for (let i = 0; i < iterations; i++) {
        const nextMap = currentMap.map(row => [...row]);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (currentMap[y][x] === CORRUPTED_LAND) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height && (dx !== 0 || dy !== 0)) {
                                nextMap[ny][nx] = CORRUPTED_LAND;
                            }
                        }
                    }
                }
            }
        }
        currentMap = nextMap;
    }
    return currentMap;
}

/**
 * The main function to generate the biome map from noise data.
 * @param {Float32Array} land - 1D array
 * @param {Float32Array} temp - 1D array
 * @param {Float32Array} humidity - 1D array
 * @param {Float32Array} height - 1D array
 * @param {number} width
 * @param {number} height
 * @returns {number[][]}
 */
function generateBiomeMapFast(land, temp, humidity, height, width, height_map_h) {
    // biomeMap as a 2D array for easier neighbor access
    let biomeMap = Array.from({ length: height }, () => Array(width).fill(0));

    // Step 1: Base biome classification
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            biomeMap[y][x] = classifyBiomeFast(
                land[idx], temp[idx], humidity[idx], height[idx]
            );
        }
    }
    
    // Step 2: Coastlines
    const COAST_ID = BIOME_IDS.coast;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (WATER_BIOME_IDS.has(biomeMap[y][x])) continue;

            let hasWaterNeighbor = false;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        if (WATER_BIOME_IDS_WITH_COAST.has(biomeMap[ny][nx])) {
                            hasWaterNeighbor = true;
                            break;
                        }
                    }
                }
                if (hasWaterNeighbor) break;
            }

            if (hasWaterNeighbor) {
                biomeMap[y][x] = COAST_ID;
            }
        }
    }

    // Step 3: Spreads (jungle, mangrove, corrupted)
    biomeMap = spreadJungleAndMangrove(biomeMap, temp, humidity, height, width, height);
    biomeMap = spreadCorruptedLand(biomeMap, width, height);

    // Step 4: Apply variants
    const landMapBool = Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => land[y * width + x] >= 0.56) // >= 0.56 is land
    );
    const distMap = calculateDistanceFromLand(landMapBool, width, height);

    biomeMap = applyBiomeVariants(biomeMap, temp, humidity, height, land, distMap, width, height);

    // Step 5: Spread oasis
    // The Python code has `spread_oasis` but it's not called in `generate_biome_map_fast`.
    // We can add it here if needed.
    // biomeMap = spread_oasis(biomeMap, width, height);

    return biomeMap;
}
